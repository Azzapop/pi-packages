---
name: requests-inbox
description: Triage and fulfil queued change requests in this pi-packages repo. Use when opening pi inside the repo and `requests/` contains files with status `pending`, `running`, or `failed`, or when the user asks you to pick up incoming requests.
---

# Requests Inbox

The `pi-packages-requests` package lets the user file change requests against this repo from any pi session anywhere on their machine via `/pi-req`. Each request lands on disk under `requests/`.

Use this skill when:

- You start a session inside this repo and `requests/` contains entries with `status: pending`, `running`, or `failed`.
- The user explicitly asks you to triage incoming requests or to pick up a specific request id.

## Layout

```text
requests/
  <id>.md            # frontmatter (id, created, target, origin_cwd) + body
  <id>.status.json   # status, pid, branch, started_at, finished_at, exit_code, commit
  <id>.log           # captured stdout+stderr of the dispatched headless pi run
  .lock              # present while a request is being dispatched
```

`<id>` is `YYYY-MM-DD-HHMM-<slug>`.

## Triage workflow

1. List the inbox sorted by newest first:

   ```bash
   ls -1 requests/*.md 2>/dev/null | sort -r
   ```

2. For each candidate request, read `requests/<id>.md` and `requests/<id>.status.json` together. Classify:

   - **`pending`** — captured but never dispatched (e.g. the lock was held at the time). Treat it as work to be done by you in this session if the user asks.
   - **`running`** — a detached runner is supposedly working on it. Check `pid` and `pi_pid` liveness before assuming it is alive. If both are dead the request is stale; the user should run `/pi-req reap`, do not silently overwrite.
   - **`failed`** — read `requests/<id>.log` for the cause. Common causes: branch creation conflict, empty body, `pi` not on PATH, the dispatched pi exiting non-zero. Summarise the failure to the user and propose a next step.
   - **`done`** — fulfilled; the work landed on branch `req/<id>`. Verify the branch exists with `git branch --list "req/<id>"` and surface the commit hash from `commit` in the status file.

3. Never spawn a parallel `pi -p` from inside this skill. Dispatch is the wrapper's job; you are the human-facing triage agent.

4. When fulfilling a `pending` request manually:

   - Switch to a fresh branch `req/<id>` from current `HEAD` (the convention used by the dispatcher), unless the user wants a different branch.
   - Implement the request using the `repo-maintenance` and `package-creator` skills as canonical guides.
   - After landing the change, update `requests/<id>.status.json` to `{ "status": "done", "finished_at": "<iso>", "commit": "<sha>" }`.

5. When a `failed` request needs another attempt, do not rewrite the original `<id>.md` body — copy the salient parts into a new request (or just implement it manually in-session) so the original audit trail is preserved.

## Safety

- Treat the original `<id>.md` frontmatter and body as immutable. Status, log, and lock files are the only mutable surface.
- Never push branches or open PRs automatically. The repo owner reviews and merges manually.
- If `requests/.lock` exists but the holder pid is dead, recommend `/pi-req reap` rather than deleting the lock yourself.
- If a request body is ambiguous, ask the user before guessing — this skill is interactive, not headless.

## Quick commands

The user can also drive the inbox without your help. Surface these in your reply when relevant:

- `/pi-req list` — table of all requests with status and age.
- `/pi-req show <id>` — body + status + branch.
- `/pi-req log <id>` — dispatch log.
- `/pi-req tail <id>` — last 100 lines of the log plus the `tail -f` command.
- `/pi-req done <id>` — manual completion mark.
- `/pi-req reap` — reconcile stale running requests and free a stale lock.
