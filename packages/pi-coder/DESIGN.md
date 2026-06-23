# pi-coder — Connect a pi session to a Propeller Coder workspace

> Status: **Discovery, architecture chosen, awaiting spike**.
> Provisional package name: `pi-coder`. Architecture: **A** (host pi,
> tool-routing into workspace). The remaining gating question is transport
> latency — see §7.

## 1. Context

Propeller has set up "Coder" (https://coder.com) cloud development environments
internally — see the Notion doc
[BETA Cloud dev environments](https://app.notion.com/p/propeller-aero/BETA-Cloud-dev-environments-379cd936080080f6b363c2466babfc9c).

### Why Propeller built this (paraphrased from the Notion doc)

> *Models powering Claude Code / Codex / pi can run autonomously on chunks of
> work for hours. In practice we babysit them — approving changes, testing for
> them, tweaking as they go. The solution is to give these agents their own
> computer, where they can run independently and we can remote-in to steer.*

That framing matters: Propeller's stated value prop is **agent-in-workspace**.
This package deliberately picks a different shape — host pi driving the
workspace as a remote execution backend — because the user wants to keep all
pi settings local and not refill them in every workspace. See §5.1.

### What the Notion doc actually says (factual extract)

- Deployment URL: **https://coder.devops.propelleraero.com/**
- **Auth: GitHub login.** If it fails, an admin (or `#agent-lab` in Slack)
  has to add your GitHub user to Coder.
- The workflow is built around the Coder **"Tasks"** tab, with two pre-baked
  templates: **"Claude Agent"** (16 GB / 4 vCPU) and **"Claude Agent (extra
  large)"** (32 GB / 8 vCPU). Both are designed to host an agent.
- A workspace is created by writing an initial **task prompt** that tells the
  agent to set up the environment (clone repos, start servers, etc.).
- Workspace startup is asynchronous; users get pinged in Slack when ready.
- Documented remote-in options: Task UI (web, embedded VS Code + Chrome +
  Claude), `coder` CLI SSH, local IDE.

Nothing in the Notion doc commits Propeller to a particular pi integration
shape; it's framed around Claude Code today. So we have latitude to choose
how pi fits in.

### What this package wants to do

Let a developer using pi locally tie their session to a Coder workspace so
that the agent's filesystem and shell work happens in the workspace, while
pi's UI, settings, model auth, and session storage stay on the host.

## 2. What we know

### 2.1 About Coder, as deployed at Propeller

Confirmed from the Notion doc:

- Deployment lives at `https://coder.devops.propelleraero.com/`.
- Auth is GitHub OAuth/SSO; access is gated on an admin allow-listing your
  GitHub user.
- Two stock templates exist ("Claude Agent", "Claude Agent (extra large)");
  both are agent-hosting templates, not bare dev VMs.
- Workspaces are created via a "Tasks" UI that takes an initial agent prompt.
  This is a non-trivial deviation from a generic Coder install: the workspace
  *expects* an agent to be its first user.
- Three documented remote-in paths: Task UI (web), `coder` CLI SSH, local IDE.

Generic Coder facts that should still hold (to verify against this deployment):

- Workspaces are defined by Terraform templates, run on Kubernetes / cloud VMs
  / Docker depending on the install.
- The `coder` CLI provides `coder login <url>`, `coder ssh <workspace>`,
  `coder config-ssh` (writes SSH config entries), and `coder port-forward`.
- Workspaces have a start / stop / auto-stop lifecycle and can be cold.
- A workspace agent runs inside each workspace and brokers the SSH / port /
  RPTY connections.

### 2.2 About pi extension surface (verified in `docs/extensions.md`)

Three relevant primitives for this package:

1. **Built-in tool factories** (`createBashTool`, `createReadTool`,
   `createWriteTool`, `createEditTool`, `createGrepTool`, `createFindTool`,
   `createLsTool`) accept `*Operations` interfaces. Replacing those operations
   redirects all built-in tool work without changing the tools the LLM sees.
   This is exactly what `gondolin/index.ts` does.
2. **`user_bash` event** — intercepts the user's `!` / `!!` commands and lets
   us return alternative `BashOperations` (or a fully synthesized result),
   so manual shell escapes also run in the workspace.
3. **`pi.registerTool`** — for any Coder-specific tool the LLM should be
   able to call (e.g. `coder_workspace_status`, `coder_port_forward`).

`tool_call` (input mutation) and `before_agent_start` (system prompt
injection) are also available if we need to advertise the routing or rewrite
paths in arguments.

### 2.3 About this repo

- Domain packages live under `packages/<domain>/` with their own `package.json`
  and `pi` manifest. There is no `docs/` convention; design docs are
  unprecedented here. See `README.md` and
  `packages/pi-packages-repo-tools/skills/package-creator/SKILL.md`.
- Existing packages we may share idioms with: `pi-cockpit` (footer/UI),
  `pi-personas` (declarative pluggable presets), `pi-plan` (skills + prompt
  templates).

## 3. Goal

A pi package that lets a developer tie a pi session to a Coder workspace at
`coder.devops.propelleraero.com`, so agent work happens in the workspace
rather than the laptop — while the pi process, UI, settings, model auth,
and session storage all stay on the host.

This is **architecture A** (see §5). Functionally the package behaves like an
SSH-style adapter: built-in tools (`bash`, `read`, `write`, `edit`, `grep`,
`find`, `ls`) and `!` / `!!` shell escapes execute in the workspace;
everything else stays local.

What "tied to a workspace" means concretely:

- The user can, with minimal ceremony, point a pi session at a named
  Coder workspace (probably `/coder connect <workspace>`).
- Once connected, the agent's filesystem and shell tools operate inside
  the workspace.
- The pi UI surfaces enough Coder-specific state (workspace name, running
  state, link to the Task UI) for the user to know what's going on.
- Disconnecting (or starting a new pi session without connecting) returns
  pi to ordinary local behaviour. No half-states.

Explicitly **not** in scope (yet):

- Replacing the developer's IDE workflow or the Coder Task UI.
- Acting as a Coder template author / admin tool, or modifying the
  "Claude Agent" templates.
- Sandboxing pi itself (that is what Docker / OpenShell are for).
- Long-running autonomous work that survives the laptop closing. If the
  user wants that, the answer is `tmux`/`nohup` inside the workspace,
  not architecture C.

## 4. Constraints and invariants any solution must respect

- **All pi-side settings stay on the host.** This is the user's stated
  reason for picking host-pi-with-tool-routing over the alternatives.
  Nothing about the design should require state on the workspace side
  beyond what the workspace already has.
- **Auth model is GitHub-SSO, not API token.** `coder login` is interactive
  via GitHub. We need an answer for how a long-running pi session keeps a
  usable Coder session token, or whether we always rely on the host's
  `coder` CLI being already-authenticated.
- **Workspace access is per-user, allow-listed.** The package can't
  bootstrap a user into Coder; it rides on an existing account. Failure
  mode for "user not in Coder" must point at `#agent-lab`.
- **Workspaces are agent-shaped, not blank dev VMs.** Stock templates
  expect to host an agent and have already been spun up via a task
  prompt. We assume there is *already* state in the workspace (cloned
  repos, running servers) and don't stomp on it.
- **Built-in tool contracts are unchanged.** The LLM keeps calling `bash`,
  `read`, `write`, `edit`, etc. — we substitute backends, not the schema.
  This is what the `*Operations` factories in pi-coding-agent are for and
  what `examples/extensions/gondolin` already demonstrates.
- **Path semantics need a single rule.** Paths the user types and the
  agent generates need a clear answer for "is this a host path or a
  workspace path?". Gondolin's rule (cwd → `/workspace` in guest, rest
  is guest-absolute) is a reasonable starting point but the actual repo
  checkout location inside the Claude Agent template may want a
  different rule.
- **Latency and connection failure must be visible.** A Coder workspace
  is remote, cold-startable, and stoppable. Tool calls cannot just hang;
  the UI must show workspace state. A single dropped SSH connection
  must not poison the rest of the session — reconnect and retry.
- **Performance budget for chatty tools.** `read` / `grep` / `find` can
  fire many times per turn. A naive `ssh <host> <cmd>` per call has
  hundreds of milliseconds of handshake overhead and will be miserable
  on a real repo. Mitigations: SSH `ControlMaster` multiplexing, a
  long-lived connection via a Node SSH library, or a small helper
  daemon in the workspace that pi pipes to. The spike (§7) has to
  measure this and pick one.
- **Blast radius.** Misconfiguration must not cause writes to land on
  the wrong filesystem. A clear active/inactive indicator matters.
  Connecting and disconnecting must be explicit user actions.
- **Coexistence with the on-workspace agent.** Stock templates already
  host Claude. If pi is also driving the same workspace, two agents may
  share a checkout. The package should at minimum surface that the
  workspace is occupied; §6.3 has the open question.
- **Don't reinvent the Task UI.** Propeller already has a web view that
  shows VS Code + Chrome + Claude. Anything we build is for users who
  prefer their local pi UX over the web view; we should not try to
  replicate it.

## 5. Design surface

### 5.1 Why architecture A

The user requirement "maintain my own settings locally without refilling
them in new Coder sessions" rules out **B** (pi-in-workspace; settings
follow the workspace) outright. It also rules out **C** (host pi bridges
to remote pi over RPC) on the same grounds: C still requires a pi
process in the workspace with at least model API auth, and adds two
session files, an RPC protocol, and reconnection semantics for benefits
(no path mapping, no per-call SSH latency, work-survives-laptop-closing)
that are either solvable in A or recoverable via `tmux` inside the
workspace.

A is also the architecture with the closest existing prior art in pi:
`examples/extensions/gondolin/index.ts` already demonstrates swapping
out `BashOperations`, `ReadOperations`, `WriteOperations`,
`EditOperations`, `GrepOperations`, `FindOperations`, `LsOperations`
and intercepting `user_bash`, redirecting all of it into a remote
execution environment. Coder-vs-Gondolin is a transport swap, not a
structural rethink.

### 5.2 Shape of architecture A

A pi extension that, when the user runs `/coder connect <workspace>`:

1. Resolves the workspace via the host's already-authenticated `coder`
   CLI (`coder list`, `coder ssh --stdio`, etc.).
2. Establishes a long-lived transport to the workspace (see §5.3).
3. Re-registers the built-in tools using the public factories
   (`createBashTool`, `createReadTool`, ...) backed by
   workspace-flavoured `*Operations` implementations.
4. Hooks `user_bash` so `!` / `!!` runs in the workspace.
5. Sets a status indicator (workspace name + connection state) and
   stores the binding in a session entry so `/resume` keeps it.
6. On `/coder disconnect` (or session end), tears the transport down
   and reverts to the default tools.

The agent loop, model calls, session JSONL, settings, themes, personas,
cockpit, etc. all stay exactly where they are now.

### 5.3 Transport — the one decision the spike needs to make

Three candidates, in increasing order of complexity:

- **`coder ssh` per call.** Simplest, most fragile. Pay the SSH
  handshake every tool call. Probably unworkable for `read`/`grep`/`find`
  on a real repo, but useful as a baseline measurement.
- **One persistent SSH session, multiplexed.** Either OpenSSH
  `ControlMaster` against `coder config-ssh`-generated entries, or a
  Node SSH library (`ssh2`, `node-ssh`) holding one connection and
  spawning channels per tool call. This is almost certainly where we
  land.
- **Workspace-side helper daemon.** A tiny Node script (or even a
  shell server) running in the workspace that pi connects to once and
  speaks a small JSON protocol with for read/write/grep/etc. Removes
  per-call process spawn entirely. Most code; best perf.

Option 2 is probably the v0 target; option 3 stays as an upgrade path
if perf measurements demand it.

### 5.4 Cross-cutting design questions

- **Workspace selection.** Session-bound, stored as a custom session
  entry so `/resume` keeps the same workspace. `/coder connect` rebinds.
- **Path mapping.** Two reasonable rules:
  - *Gondolin-style:* host cwd → a fixed mount in the workspace (e.g.
    `/workspace`), other paths treated as workspace-absolute.
  - *Workspace-native:* drop the mapping; the agent operates entirely
    in workspace paths. Host cwd is irrelevant once connected.
  The Claude Agent template already has cloned repos at known paths,
  so workspace-native may be the honest answer. Spike will tell us.
- **Lifecycle handling.** v0: refuse to connect if the workspace is
  stopped, with a message telling the user to start it via the Coder
  UI. "Auto-start" is a v1 nicety that needs UX for cold-start delay.
- **Activation model.** Opt-in via `/coder connect`. Never automatic.
- **UX surface.** Cockpit-style status item with workspace + state;
  `/coder` command tree (`connect`, `disconnect`, `status`, `list`,
  `open` to launch the Task UI in a browser).
- **Coexistence with on-workspace Claude.** Surface a warning at
  connect time if we can detect Claude is active in the workspace.
  Long term may need explicit checkout-isolation rules; out of scope
  for v0.

## 6. Open questions — what we still need to find out

### 6.1 Spike-blocking (must answer before we commit to a v0 design)

- [ ] **Latency budget.** Round-trip time for `ls`, `cat`, and a small
      `grep` against a real Propeller repo via
      (a) `coder ssh <ws> <cmd>` per call,
      (b) one persistent multiplexed SSH session, and
      (c) a one-off helper-daemon prototype.
      The numbers decide §5.3.
- [ ] **Auth durability.** How long does a `coder login` session last?
      What does pi do if it expires mid-session — prompt the user, fail
      gracefully, fall back to host-side `coder` CLI?
- [ ] **Path mapping rule.** Look at where the Claude Agent template
      actually checks repos out, what user pi is running as in the
      workspace, and whether a Gondolin-style cwd map or workspace-native
      paths is the more honest rule.

### 6.2 Coder deployment specifics

- [ ] What does the Claude Agent template actually provision —
      preinstalled CLIs, default user/shell, repo checkout location,
      writable home, environment variables?
- [ ] Does this Coder version support `coder ssh --stdio`? (Useful as
      a transport.)
- [ ] How are workspaces named — slug, ID, both? Which is stable
      across template upgrades?
- [ ] Are there network egress / secret-injection guardrails we'd need
      to respect (or that would silently break our transport)?
- [ ] Is `coder` CLI considered the supported integration point, or is
      there a documented HTTP API surface Propeller endorses?

### 6.3 Pi-side behavioural choices

- [ ] Route **all** built-in tools, or selectively? (Probably all, but
      worth confirming — if `read` and `grep` were kept local against
      a synced checkout, latency stops mattering.)
- [ ] Replace `user_bash` immediately when the package loads, or only
      after `/coder connect`? (Recommend: only after connect.)
- [ ] Add `coder_*` LLM-callable tools (port forward, workspace logs,
      open Task UI), or keep everything behind `bash`? (Recommend:
      v0 = nothing extra; add later if it earns its keep.)
- [ ] Print / RPC / JSON modes — TUI-only at first, or all four from
      v0? (Recommend: TUI-only at first.)
- [ ] How do we want the package to react to a stopped or failed
      workspace mid-session? Hard fail vs. notify-and-disconnect.
- [ ] Do we surface a warning at connect time if Claude is already
      active in the workspace?

### 6.4 Repo / packaging

- [ ] Final package name. `pi-coder` is fine if generic; `pi-propeller-coder`
      if we want it obviously Propeller-specific.
- [ ] Cockpit footer / persona integration — out of scope for v0?

## 7. Next step — the spike

The one thing standing between this discovery doc and a real design is
latency. We need to know whether tool-routing over SSH into a Coder
workspace is acceptable for a real repo, and which transport from §5.3
to build on. Everything else can be settled with a short spec pass
once we have those numbers.

Proposed spike, run from a host shell against a freshly created
"Claude Agent" workspace:

1. **Setup.** `coder login https://coder.devops.propelleraero.com/`,
   create a workspace via the Tasks UI with a minimal task prompt
   ("clone `prp-custom-tools` and stop"), wait for it to start.
   `coder list`, `coder config-ssh`, confirm `ssh coder.<workspace>`
   works.
2. **Inspect the template.** Inside the workspace: which user are we?
   Where is the repo checked out? What's installed (`node`, `rg`, etc.)?
   Is there an obvious "don't touch" area Claude is using? Capture for
   the path-mapping decision.
3. **Measure baseline transport.** Time these against a real repo
   (e.g. `prp-custom-tools` or `visualiser`):
   - `ssh coder.<ws> ls -la <some-dir>` (small, p50 + p95 over 20 runs)
   - `ssh coder.<ws> cat <some-file>` (medium file)
   - `ssh coder.<ws> rg <pattern>` (representative grep)

   ...via three transports:
   - (a) plain `coder ssh` per call
   - (b) OpenSSH with `ControlMaster=auto` + `ControlPersist`
   - (c) one persistent `ssh2`/`node-ssh` connection, one channel per call
4. **Decide.** If (b) or (c) lands tool calls in roughly tens of
   milliseconds, we're done choosing. If even (c) is too slow on `rg`,
   we know v0 needs the helper-daemon transport from §5.3.
5. **Write the design doc.** With the spike numbers in hand, promote
   this doc into a real design (Context → Constraints → Options →
   Recommendation → Rollout). Implementation kicks off after that with
   an implementation-focused persona, not this one.

## 8. Out of scope for this doc

- Implementation. Nothing in this doc commits us to code. It is a
  scaffold for the conversations and spikes that come next.
- Final package name, ownership, or distribution path.
- Any migration of existing tooling onto Coder — this is purely about
  giving pi a way to drive an existing Coder workspace.
