# pi-coder spike — Phase 1: transport latency runbook

> Companion to [`DESIGN.md`](./DESIGN.md). This is a runbook to execute the
> spike described in §7 of the design doc and turn the open questions in
> §6.1 into hard data. **It is read-and-do.** Each step has expected output
> so you can tell if something has gone wrong before you've sunk an hour
> into the wrong path.

## Purpose

We've committed to architecture A (host pi, tool-routing into a Coder
workspace over SSH-style transport). One question gates the v0 design:
**is per-tool-call latency low enough on a multiplexed SSH transport, or
does v0 need a workspace-side helper daemon?**

Three secondary questions ride along, because we'll have a workspace open
anyway:
- What does the Claude Agent template actually look like (user, paths,
  installed tools)? — drives the path-mapping rule.
- How long does a `coder login` session last and how does it fail? —
  drives auth handling.
- Does `coder ssh` behave like a thin SSH wrapper or wrap things in ways
  that break `ControlMaster` / `ssh2`? — kills options if it does.

## Exit criteria — when this spike is done

You should walk away with:

1. A **filled-in results table** (§9) showing p50/p95 latency for nine
   measurements (3 transports × 3 workloads).
2. A **transport recommendation** for §5.3 of the design doc, with the
   evidence to back it.
3. A **template environment dump** (§6) capturing user, paths, installed
   tools, and Claude's state inside a Claude Agent workspace.
4. An **auth durability note** (§7) describing how `coder login` sessions
   persist and fail.
5. A list of **surprises** — anything that contradicts an assumption in
   `DESIGN.md`.

If any of these is missing at the end, the spike is incomplete.

**Time budget:** 2–4 hours of focused work, plus 4+ hours elapsed for
the auth durability check (which runs in the background).

---

## 1. Pre-flight

Before starting, confirm each of these. If anything fails, stop and fix
it; don't skip ahead.

### 1.1 Tools on your laptop

```sh
which coder ssh hyperfine python3 node
coder version
ssh -V
```

Required:
- `coder` CLI — install with `brew install coder/coder/coder` if missing.
  Note the version; some behaviour below is version-dependent.
- OpenSSH (built into macOS).
- Python 3 (for timing fallbacks if `hyperfine` is unavailable).
- Node.js ≥ 18 (for the `ssh2` measurement in step 4.3).

Strongly recommended:
- `hyperfine` — `brew install hyperfine`. Does the timing statistics
  cleanly so you don't have to roll your own. Falls back to a Python
  loop if you'd rather not install it.

### 1.2 Coder access

Open https://coder.devops.propelleraero.com/ in a browser. Sign in with
GitHub. **If sign-in fails:**
- Per the Notion doc, message `#agent-lab` on Slack to get your GitHub
  user added.
- Stop here. There is no point running the spike without access; come
  back when access is sorted.

### 1.3 Working directory

Pick a place for spike artefacts so we can capture results without
polluting the repo:

```sh
mkdir -p ~/scratch/pi-coder-spike
cd ~/scratch/pi-coder-spike
```

Everything else assumes you're in this directory.

---

## 2. Step 1 — Auth and reachability (≈10 minutes)

### 2.1 Log in from the CLI

```sh
coder login https://coder.devops.propelleraero.com/
```

This opens a browser, runs the GitHub OAuth flow, and writes a session
token locally. Capture where:

```sh
ls -la ~/.config/coderv2/ 2>/dev/null || ls -la ~/Library/Application\ Support/coderv2/ 2>/dev/null
cat ~/.config/coderv2/url 2>/dev/null
```

Note the path of the session file. **This is the answer to "where does
the token live?" — write it down.** pi-coder will need to either read
it directly or shell out to `coder` to use it.

### 2.2 Confirm the CLI works

```sh
coder version
coder list
coder users show me
```

Expected:
- `coder list` returns at least your existing workspaces (or an empty
  list if you have none yet — that's fine).
- `coder users show me` returns your username.

### 2.3 Note the deployment shape

```sh
coder list --output=json | head -50
```

This is just for your own reference — gives you the JSON shape of a
workspace, useful for thinking about how pi-coder might enumerate
workspaces later. Don't overthink it; we just want to see the
`name`, `id`, `status`, and `template_name` fields.

---

## 3. Step 2 — Create a clean test workspace (≈10–30 minutes elapsed)

### 3.1 Create via the Tasks UI

In the browser:

1. Click the **Tasks** tab.
2. Click "Create task" (or equivalent).
3. Choose the **Claude Agent** template (the smaller one, 16 GB /
   4 vCPU — we don't need extra-large for a transport spike).
4. **Use this exact initial task prompt:**

   > Clone https://github.com/PropellerAero/prp-custom-tools into
   > the default location. Do not start any servers. Do not modify
   > or build anything. Once the clone is finished, stop and wait.
   > Do not perform any further actions until I give you a new
   > instruction.

   The phrasing is deliberate: we want a workspace that has *real
   repo content* (so `rg` measurements are meaningful) but isn't
   actively running an agent that will fight us for the filesystem
   or burn CPU.

5. Submit. Wait for the Slack ping that says it's ready.

### 3.2 Capture the workspace name

```sh
coder list
```

Note the workspace **name** (slug). It will be something like
`<username>-<random>` or similar. Set a shell variable for the rest of
the runbook:

```sh
export WS=<workspace-name>   # e.g. WS=aaron-cleverpenguin
echo "Spike workspace: $WS"
```

### 3.3 Confirm SSH reachability

```sh
coder ssh "$WS" -- echo ok
```

Expected output: `ok`. If you see anything else (auth error, "workspace
not running", connection refused), stop and resolve before continuing.
Common fixes:
- Workspace not yet started → wait, retry.
- Stale auth → `coder login` again.

---

## 4. Step 3 — Environment inspection (≈10 minutes)

This is the cheapest, highest-information step. Everything we capture
here informs the path-mapping decision and the implementation later.

### 4.1 Run the environment dump

```sh
coder ssh "$WS" -- bash -lc '
echo "=== identity ==="
echo "whoami: $(whoami)"
echo "home:   $HOME"
echo "shell:  $SHELL"
echo "pwd:    $(pwd)"
echo
echo "=== uname ==="
uname -a
echo
echo "=== locale ==="
locale | head -5
echo
echo "=== PATH ==="
echo "$PATH" | tr ":" "\n"
echo
echo "=== tool inventory ==="
for t in bash node npm pnpm yarn rg fd ag git python3 jq fzf coder claude tmux; do
  if command -v "$t" >/dev/null 2>&1; then
    printf "%-10s %s\n" "$t" "$(command -v $t)"
    "$t" --version 2>/dev/null | head -1 | sed "s/^/           /"
  fi
done
echo
echo "=== home contents ==="
ls -la "$HOME" | head -30
echo
echo "=== plausible repo locations ==="
for d in "$HOME/prp-custom-tools" "$HOME/projects" "$HOME/code" "$HOME/workspace" /workspace /code /home/coder; do
  if [ -e "$d" ]; then
    echo "--- $d ---"
    ls -la "$d" 2>&1 | head -10
  fi
done
echo
echo "=== git remotes (if a repo was cloned) ==="
find "$HOME" -maxdepth 3 -name ".git" -type d 2>/dev/null | while read -r g; do
  echo "--- $(dirname $g) ---"
  git -C "$(dirname $g)" remote -v 2>/dev/null
  git -C "$(dirname $g)" log -1 --oneline 2>/dev/null
done
echo
echo "=== running processes ==="
ps -ef | head -40
echo
echo "=== claude footprint ==="
ps -ef | grep -i claude | grep -v grep
ls -la "$HOME"/.claude* 2>/dev/null
ls -la "$HOME"/.config/claude* 2>/dev/null
echo
echo "=== disk ==="
df -h "$HOME" 2>/dev/null
echo
echo "=== /proc/1 (is this a container?) ==="
cat /proc/1/cgroup 2>/dev/null | head -5
' | tee env-dump.txt
```

This writes the result to `env-dump.txt` so you can attach it (or paste
the relevant bits) to the design doc later.

### 4.2 What to look for in the output

- **Which user pi will be running as** (likely `coder` based on the
  template name, but confirm).
- **Where the repo got cloned to.** This is the most important piece —
  it determines the path-mapping decision in §5.4 of `DESIGN.md`.
- **Whether `rg` is installed.** If not, our `read`/`grep` operations
  may need to fall back to plain `grep`, which is slower and changes
  the perf picture.
- **Whether Node is installed.** The helper-daemon transport (§5.3
  option 3) assumes Node; if it isn't there we'd need to build a
  static binary or use a different language.
- **What Claude is doing.** If you see active Claude processes or
  recent activity, the "stop after clone" instruction was ignored —
  that's a finding worth noting because real workspaces will probably
  have Claude active.
- **Container vs. VM.** Affects how aggressive we can be about
  long-lived connections, file watchers, etc.

### 4.3 Capture the size of the repo

We need a realistic `rg` workload, so:

```sh
coder ssh "$WS" -- bash -lc '
REPO=$(find "$HOME" -maxdepth 3 -name ".git" -type d 2>/dev/null | head -1 | xargs dirname)
echo "Repo: $REPO"
cd "$REPO"
echo "files: $(git ls-files | wc -l)"
echo "size:  $(du -sh . 2>/dev/null | cut -f1)"
echo "first level:"
ls -la | head
' | tee repo-size.txt
```

Set another shell variable for later:

```sh
# Set this based on the output above.
export REMOTE_REPO=/home/coder/prp-custom-tools   # or wherever it actually is
```

---

## 5. Step 4 — Transport measurements (≈30–60 minutes)

Three transports, three workloads, 20 runs each. We want **p50** (typical
case) and **p95** (worst-realistic case) for each cell of the matrix.

The three workloads, picked to reflect what the agent actually does:

- **`ls`** — small, no output to speak of. Pure round-trip cost.
- **`cat <medium-file>`** — exercises bulk transfer of a small-ish
  payload. Use a source file in the repo that's a few KB.
- **`rg <pattern>`** — exercises actual computation in the workspace,
  including file traversal. Use a pattern that returns a handful of
  matches, not thousands.

Define the three commands once, in shell variables, so each transport
runs against identical workloads:

```sh
# Replace MEDIUM_FILE with a real path you found in step 4.
export REMOTE_LS_DIR="$REMOTE_REPO"
export REMOTE_CAT_FILE="$REMOTE_REPO/README.md"   # or any 2–10 KB file
export REMOTE_RG_PATTERN="TODO"                   # or another short word
```

### 5.1 Transport A — Per-call `coder ssh` (baseline)

This is what a naive implementation would do. Almost certainly slow.

```sh
hyperfine --warmup 1 --runs 20 \
  --export-markdown transport-a.md \
  --command-name "A: ls"  "coder ssh $WS -- ls $REMOTE_LS_DIR" \
  --command-name "A: cat" "coder ssh $WS -- cat $REMOTE_CAT_FILE" \
  --command-name "A: rg"  "coder ssh $WS -- rg --no-heading $REMOTE_RG_PATTERN $REMOTE_REPO"
```

If you don't have `hyperfine`:

```sh
measure() {
  local label="$1"; shift
  python3 - "$label" "$@" <<'PY'
import subprocess, sys, time, statistics
label, *cmd = sys.argv[1:]
times=[]
for _ in range(20):
    t0=time.time()
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    times.append((time.time()-t0)*1000)
times.sort()
print(f"{label}: p50={times[10]:.0f}ms p95={times[18]:.0f}ms min={times[0]:.0f}ms max={times[-1]:.0f}ms")
PY
}

measure "A: ls"  coder ssh "$WS" -- ls "$REMOTE_LS_DIR"
measure "A: cat" coder ssh "$WS" -- cat "$REMOTE_CAT_FILE"
measure "A: rg"  coder ssh "$WS" -- rg --no-heading "$REMOTE_RG_PATTERN" "$REMOTE_REPO"
```

**Expected:** somewhere between 400 ms and 2 s per call. This is the
baseline transports B and C have to beat.

### 5.2 Transport B — Persistent SSH via `ControlMaster`

OpenSSH's connection multiplexing. The first call pays the handshake;
subsequent calls reuse the connection.

#### 5.2.1 Generate the SSH config

```sh
coder config-ssh --yes
```

This appends a section to `~/.ssh/config` that defines `coder.<workspace>`
hosts. After running it:

```sh
grep -A2 "Host coder\." ~/.ssh/config | head -30
ssh "coder.$WS" -- echo ok
```

Expected: `ok`. If this fails but `coder ssh "$WS" -- echo ok` works,
something about the SSH config wrapping is incomplete — note this and
fall back to invoking `coder ssh` directly for transport B. (That's
itself a finding: it would mean we can't use stock OpenSSH multiplexing.)

#### 5.2.2 Add ControlMaster

Append to `~/.ssh/config` (or create `~/.ssh/config.d/coder-spike` and
include it):

```
Host coder.*
  ControlMaster auto
  ControlPath ~/.ssh/cm-%r@%h:%p
  ControlPersist 10m
  ServerAliveInterval 30
```

#### 5.2.3 Establish the master connection, then measure warm runs

```sh
# Cold call — establishes the master connection
ssh "coder.$WS" -- echo cold-connect-ok

# Confirm the master is up
ssh -O check "coder.$WS"
# Expected: "Master running ... "

# Warm measurements
hyperfine --warmup 2 --runs 20 \
  --export-markdown transport-b.md \
  --command-name "B: ls"  "ssh coder.$WS -- ls $REMOTE_LS_DIR" \
  --command-name "B: cat" "ssh coder.$WS -- cat $REMOTE_CAT_FILE" \
  --command-name "B: rg"  "ssh coder.$WS -- rg --no-heading $REMOTE_RG_PATTERN $REMOTE_REPO"
```

**Expected:** p50 of tens of milliseconds for `ls` and `cat`, somewhere
between 50 and a few hundred ms for `rg` depending on repo size. If
this is the case, we've validated the v0 design.

If `ssh -O check` says "no master running" even after a successful
cold call, multiplexing isn't actually engaged — likely because Coder
is wrapping SSH in a way that breaks the control socket. **This is a
critical finding.** Note it, skip to 5.3 (transport C), and the design
implication is that the helper-daemon transport may need to come
sooner rather than later.

### 5.3 Transport C — Persistent connection via `ssh2` (Node)

This is the closest to what pi-coder will actually do. Write the
following to `transport-c.mjs` in your scratch directory:

```js
// transport-c.mjs
import { Client } from 'ssh2';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

const WS = process.env.WS;
const REPO = process.env.REMOTE_REPO;
const CAT_FILE = process.env.REMOTE_CAT_FILE;
const PATTERN = process.env.REMOTE_RG_PATTERN;
if (!WS || !REPO || !CAT_FILE || !PATTERN) {
  console.error('Set WS, REMOTE_REPO, REMOTE_CAT_FILE, REMOTE_RG_PATTERN.');
  process.exit(2);
}

// Naive: read SSH config to find HostName/User/IdentityFile for `coder.$WS`.
// In production pi-coder would do this properly; for the spike we hand-code.
const host = process.env.SSH_HOST ?? `coder.${WS}`;
const user = process.env.SSH_USER ?? 'coder';
const keyPath = process.env.SSH_KEY ?? join(homedir(), '.ssh', 'id_ed25519');

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let stdout = '', stderr = '';
      stream.on('data', d => { stdout += d; });
      stream.stderr.on('data', d => { stderr += d; });
      stream.on('close', () => resolve({ stdout, stderr }));
    });
  });
}

async function measure(label, conn, cmd, n = 20) {
  // warmup
  await exec(conn, cmd);
  const times = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await exec(conn, cmd);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(n * 0.5)].toFixed(0);
  const p95 = times[Math.floor(n * 0.95)].toFixed(0);
  console.log(`${label}: p50=${p50}ms p95=${p95}ms min=${times[0].toFixed(0)}ms max=${times[n-1].toFixed(0)}ms`);
}

const conn = new Client();
conn.on('ready', async () => {
  console.log('connected');
  await measure('C: ls',  conn, `ls ${REPO}`);
  await measure('C: cat', conn, `cat ${CAT_FILE}`);
  await measure('C: rg',  conn, `rg --no-heading ${PATTERN} ${REPO}`);
  conn.end();
}).on('error', err => {
  console.error('ssh2 error:', err.message);
  process.exit(1);
}).connect({
  host, port: 22, username: user, privateKey: readFileSync(keyPath),
});
```

Set up and run:

```sh
cd ~/scratch/pi-coder-spike
npm init -y
npm i ssh2

# Find the right SSH host/user/key from the config block coder generated.
# Look at the Host coder.$WS section in ~/.ssh/config:
grep -A10 "Host coder\.$WS" ~/.ssh/config

# Set SSH_HOST / SSH_USER / SSH_KEY based on what you see, then:
node transport-c.mjs
```

**Expected:** very similar numbers to transport B if multiplexing was
working in B. Often slightly faster because there's no fork/exec per
call.

If `ssh2` can't connect (auth errors, etc.) but `ssh coder.$WS` works,
that's another flavour of the "Coder wraps SSH" finding — it means
pi-coder will need to invoke `coder ssh --stdio` and pipe through it
rather than using a vanilla `ssh2` connection. Note it.

### 5.4 Bonus: `coder ssh --stdio` check

Some Coder versions support `coder ssh --stdio` as a `ProxyCommand`-style
transport, which is the cleanest way to bridge `ssh2` to a Coder
workspace. Quick check:

```sh
coder ssh --help 2>&1 | grep -i stdio
```

If it's documented, capture the exact flag. This is what the design
doc asks for in §6.2.

---

## 6. Step 5 — Auth durability (elapsed time, low effort)

This one needs wall-clock time, not work time.

### 6.1 At T+0 (now)

```sh
date
coder list
ls -la ~/.config/coderv2/session* 2>/dev/null
stat -f "%Sm" ~/.config/coderv2/session 2>/dev/null  # macOS
```

Note the session file mtime.

### 6.2 At T+4 hours and T+24 hours

Re-run the above. Specifically check:
- Does `coder list` still work without re-auth?
- Has the session file been refreshed automatically?
- Is the persistent SSH connection from transport B still alive
  (`ssh -O check coder.$WS`)?

### 6.3 At T+ a working day

Try opening a new shell (no inherited environment) and running
`coder ssh "$WS" -- echo ok`. If you have to re-auth, capture how:
- Browser redirect?
- "Visit this URL and paste a code"?
- API token re-issuance?

This determines pi-coder's failure-mode UX when a session expires
mid-pi-session.

---

## 7. Tear-down

When you're done measuring (and have captured numbers), be a good
neighbour:

```sh
# Stop the workspace via the web UI (Workspaces tab → ... → Stop) or:
coder stop "$WS"
```

You can leave the workspace existing — it's useful for the next
spike or for the implementation phase. Just don't leave it running.

If you're really done with it:

```sh
coder delete "$WS"
```

---

## 8. Capturing results

Fill this table in `~/scratch/pi-coder-spike/results.md` (or paste
directly into `DESIGN.md` §5.3 when you're done):

```md
## Spike results — <date>

Workspace: <name> (template: Claude Agent, 16/4)
Repo: prp-custom-tools, <N> files, <size>
Pattern: "<REMOTE_RG_PATTERN>"
Cat file: <REMOTE_CAT_FILE> (<size>)

| Transport          | ls p50 | ls p95 | cat p50 | cat p95 | rg p50 | rg p95 |
|--------------------|--------|--------|---------|---------|--------|--------|
| A: per-call coder  |        |        |         |         |        |        |
| B: ControlMaster   |        |        |         |         |        |        |
| C: ssh2 (Node)     |        |        |         |         |        |        |

Cold-connect costs:
- B first-call: <N> ms
- C connect:    <N> ms

Auth durability:
- Session file path: <path>
- Survives <N> hours: yes/no
- Re-auth UX: <description>

Surprises / contradictions to DESIGN.md:
- <bullet>
- <bullet>

Environment facts (drives §5.4 path mapping):
- User: <whoami>
- Home: <home>
- Repo location: <where>
- rg installed: yes/no, version <x>
- Node installed: yes/no, version <x>
- Claude footprint: <description>
```

---

## 9. Decision criteria

Translate the numbers into a transport recommendation for §5.3.

### 9.1 Latency thresholds

These are pragmatic, not theoretical — they reflect what feels OK in
an interactive agent loop.

| p50 across workloads on B or C | Verdict |
|---|---|
| < 50 ms | Excellent. Ship multiplexed SSH, no daemon needed. |
| 50–150 ms | Acceptable. Ship and revisit if users complain. |
| 150–400 ms | Marginal. Ship if implementation is otherwise simple, but plan the helper daemon as v1. |
| > 400 ms | Bad UX for chatty turns. Prototype the helper daemon before committing to v0. |

`rg` p95 specifically is the canary — it stresses the transport more
than `ls` or `cat`. If `rg` p95 is consistently > 1 s on a small repo,
that's a signal to think harder.

### 9.2 Transport recommendation logic

- B works (ControlMaster engages, latency is OK) **and** C works
  (ssh2 connects, similar latency) → **recommend C** (ssh2). It
  doesn't depend on the user's local SSH config and gives pi-coder
  programmatic control over the connection lifecycle.
- B works, C doesn't → **recommend B** (shell out to `ssh coder.$WS`
  with a user-managed config). Acceptable, slightly less robust.
- Neither B nor C work (Coder wraps SSH such that multiplexing
  fails) → **recommend `coder ssh --stdio` proxied to ssh2** if
  that flag exists, **otherwise** prototype the helper-daemon
  transport before writing the v0 design.
- Latency on B/C is bad even though they "work" → same as above:
  prototype the daemon.

### 9.3 Path-mapping recommendation logic

Look at the environment dump:
- Repo at a fixed canonical location (e.g. `/home/coder/<repo-name>`):
  recommend the **workspace-native** rule (no host↔guest mapping;
  agent operates entirely in workspace paths).
- No canonical location, repo cloned wherever: recommend the
  **Gondolin-style** rule (host cwd ↔ a known guest path).
- Multiple repos in the workspace: workspace-native is honest;
  Gondolin-style implies a single mount.

The design doc (§5.4) already calls this a spike-decided question,
so just pick based on what you see and write it up.

---

## 10. Common failure modes

Things that genuinely tend to go wrong, with fixes:

| Symptom | Likely cause | Fix |
|---|---|---|
| `coder login` opens a browser but never returns | Browser hung on GitHub OAuth, or you closed it | Re-run; do the GitHub flow promptly |
| `coder ssh` works but `ssh coder.$WS` doesn't | `coder config-ssh` not run, or it ran but the file isn't sourced | Re-run `coder config-ssh --yes`; check `~/.ssh/config` for the block |
| `ssh -O check` says no master running | ControlPath in a non-writable directory, or Coder wraps SSH such that multiplexing breaks | Try a writable `ControlPath`; if still failing, that's the finding |
| `ssh2` "all configured authentication methods failed" | Wrong key or wrong user; Coder may not use `~/.ssh/id_*` | Inspect the `Host coder.$WS` block, find the IdentityFile and User Coder generated |
| Workspace stops mid-spike | Auto-stop policy kicked in | Re-start (`coder start "$WS"`), re-time, note the timeout in your results |
| Tool calls hang forever instead of timing out | No SSH `ServerAliveInterval`/`ConnectTimeout` set | Add to the config block; this is a real concern for v0 too |
| `rg` not installed | Template didn't bake it in | Note as a finding; pi-coder may need to install it on first connect, or fall back to `grep -r` |
| Numbers wildly inconsistent run-to-run | Network jitter, or the workspace is loaded by Claude doing something | Re-run with Claude verifiably idle; spike at a quiet time of day |

If you hit something not on this list, write it down — it's the kind
of thing that derails implementation.

---

## 11. What to fold back into `DESIGN.md`

When the spike is done:

1. Add a **§5.5 Spike results** subsection to `DESIGN.md` containing
   the table from §8 above.
2. Resolve the three checkboxes in `DESIGN.md` §6.1:
   - Latency budget → reference the table.
   - Auth durability → write the actual behaviour observed.
   - Path mapping rule → state the chosen rule and why.
3. Update `DESIGN.md` §5.3 with the chosen transport, removing the
   alternatives or relegating them to a v1 backlog.
4. If anything in your "surprises" section contradicts `DESIGN.md`,
   **stop and re-survey** before promoting the doc — the architect
   persona should re-engage at this point. Surprising data is
   exactly when going straight to implementation hurts you most.

---

## 12. Stop conditions — when to bail and re-think

The spike is cheap; bailing is cheaper than building the wrong thing.
Stop and bring me (or another architect-shaped review) back in if:

- You can't get `coder ssh` working at all after the obvious fixes —
  there's an environmental blocker we don't understand.
- Both transports B and C fail to multiplex, *and* `coder ssh --stdio`
  doesn't exist — the v0 design as written can't ship; we need to
  pick between "per-call SSH and live with the latency" or "build
  the daemon up front", and that's an architecture-shaped call.
- The workspace doesn't actually have the repo cloned (the agent
  ignored the "clone and stop" instruction, or the template doesn't
  give the agent network access to GitHub) — surfaces a constraint
  we missed.
- Latency is fine on small workloads but disastrous on `rg` — the
  agent uses `rg` constantly, and this changes the v0 calculation.
- Anything in the environment dump contradicts a constraint in
  `DESIGN.md` §4 (e.g. workspaces are ephemeral in a way we didn't
  account for, multiple users share workspaces, etc.).

If none of these triggers, you're clear to fold results back into
`DESIGN.md`, run Phase 2 (promote the doc), and switch personas
for implementation.
