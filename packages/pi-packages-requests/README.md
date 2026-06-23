# pi-packages-requests

File change requests against this `pi-packages` repo from any pi session anywhere on your machine. `/pi-req` writes the request to disk under `requests/` and dispatches a detached headless `pi -p` run inside the repo to actually make the change on a fresh `req/<id>` branch.

## Install

Global install so the command is available from every pi session:

```bash
pi install /Users/aaron/src/pi-packages/packages/pi-packages-requests
```

Configure the repo path once in `~/.pi/agent/settings.json` so the extension knows where the repo lives regardless of cwd:

```json
{
  "piPackagesRoot": "/Users/aaron/src/pi-packages"
}
```

If unset, the extension will walk up from the current directory looking for `packages/pi-packages-repo-tools`, and finally fall back to `~/src/pi-packages`.

## Commands

| Command | What it does |
| --- | --- |
| `/pi-req [target] <body...>` | Write a request and dispatch a headless run on `req/<id>`. `target` is an optional package name (autocompletes from `packages/*`). |
| `/pi-req list [status]` | List requests, newest first. Optional status filter (`pending`, `running`, `done`, `failed`). |
| `/pi-req show <id>` | Show the request body and current status. |
| `/pi-req log <id>` | Print the dispatch log so far. |
| `/pi-req tail <id>` | Open `tail -f` on the log. |
| `/pi-req done <id>` | Manually mark a request as done (for cases where the wrapper couldn't). |
| `/pi-req reap` | Reconcile `running` requests whose pid is no longer alive and free a stale lock. |

`<id>` accepts a unique prefix.

## On-disk layout

Inside the repo:

```text
requests/
  <id>.md            # immutable: frontmatter (id, created, target, origin_cwd) + body
  <id>.status.json   # mutable: status, pid, branch, started_at, finished_at, exit_code, commit
  <id>.log           # captured stdout+stderr of the dispatched pi run
  .lock              # present while a request is running (contains the running id)
```

`<id>` is `YYYY-MM-DD-HHMM-<slug>`, where the slug is derived from the target (if any) and the first words of the body.

## Dispatch lifecycle

1. `/pi-req` writes `<id>.md` and `<id>.status.json` with `status: pending`.
2. It acquires `requests/.lock` atomically. If the lock is held, the request stays `pending` and you can dispatch it later (planned: `/pi-req run <id>`).
3. It spawns `node dispatch/run.mjs <id> <repoRoot> <preamblePath>` detached, with stdout/stderr ignored. The runner cuts `req/<id>` from current `HEAD`, runs `pi -p --append-system-prompt @execution-preamble.md "<body>"` with cwd set to the repo, captures all output to `<id>.log`, then commits any changes on the branch and writes the final status.
4. You check on the run from anywhere with `/pi-req list`, `/pi-req log`, or `/pi-req tail`.

The dispatched pi inherits this repo's `.pi/settings.json`, so it automatically loads `pi-packages-repo-tools` (with its `repo-maintenance` and `package-creator` skills). The execution preamble in `dispatch/execution-preamble.md` adds non-interactive-run-specific guidance.

## Safety notes

- Requests are serialised by `requests/.lock`. Two `/pi-req` calls in quick succession will not stomp on each other's working tree.
- Each run gets its own branch `req/<id>`; your default branch is untouched.
- No automatic push, no automatic PR. Review the branch and merge yourself.
- If a wrapper dies and a lock or `running` status gets stuck, run `/pi-req reap`.
