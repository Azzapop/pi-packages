# Phase 3: Terminal Mode Plugin

## Goal

Create a terminal mode package that plugs into the cockpit mode host. Terminal mode should behave as much like a normal shell as possible while still fitting into Cockpit's mode system.

This phase depends on [Phase 1: Cockpit Mode Host](phase-1-cockpit-mode-host.md). It can be implemented independently of [Phase 2: Plan Mode](phase-2-plan-mode.md).

## Package

Create:

```text
packages/pi-mode-terminal/
  package.json
  extensions/
    terminal-mode.ts
```

The package registers a `terminal` mode with cockpit via `pi.events`.

## Registration Shape

```ts
pi.events.emit("cockpit:mode:register", {
  id: "terminal",
  label: "Terminal",
  icon: "$",
  description: "Run shell commands or enter a real shell",
  order: 30,
  onEnter(ctx) {
    // activate terminal behavior
  },
  onExit(ctx) {
    // clean up terminal behavior
  },
  onInput(event, ctx) {
    // optional command-mode implementation
  },
});
```

## Implementation Options

There are three possible implementation levels.

## Option A: Shell-command Mode

User input is treated as shell command instead of LLM prompt.

### Pros

- Easy to implement.
- Works inside Pi TUI.
- `Shift+Tab` can cycle out immediately.

### Cons

- Not literally a full shell.
- Must manually track `cd` / cwd.
- Full-screen interactive commands need special handling.

### Implementation

- Active mode `onInput` intercepts input.
- Run command via `pi.exec()` or local shell operation.
- Display output as a custom message.
- Handle `cd`, `pwd`, and `exit` specially.

Example behavior:

```text
/mode terminal
$ pwd
/Users/aaron/src/pi-packages
$ ls
README.md packages docs ...
$ exit
# returns to edit mode
```

## Option B: Real Shell Handoff

On entering terminal mode:

- Stop Pi TUI.
- Spawn `$SHELL` with inherited stdio.
- User works in a real shell.
- When shell exits, restart Pi TUI and return to edit mode.

### Pros

- Closest to “literally behaves the same as terminal shell.”
- Interactive programs work naturally.

### Cons

- `Shift+Tab` cannot cycle out while the shell owns the terminal.
- User exits with `exit` or `Ctrl-D`.

### Recommended V1

Use this as the first implementation if literal shell behavior is more important than staying inside the Pi TUI.

Potential behavior:

```text
edit --Shift+Tab--> plan --Shift+Tab--> terminal
terminal:
  Pi suspends TUI
  launches $SHELL in cwd
  user works normally
  user exits shell
  Pi resumes in edit mode
```

## Option C: Embedded PTY Shell

Use a PTY dependency and implement a terminal-like custom component.

### Pros

- Best integrated UX.
- `Shift+Tab` could cycle out.
- Persistent shell session inside cockpit.

### Cons

- Most complex.
- Needs resize handling, raw input, scrollback, ANSI behavior, process lifecycle, and dependency management.

### Recommendation

Defer until shell handoff or shell-command mode proves insufficient.

## Suggested V1 Decision

Implement **Option B: Real Shell Handoff** first if the priority is “literally behaves like the terminal shell.”

If immediate `Shift+Tab` cycling out of terminal is more important, implement **Option A: Shell-command Mode** first.

## UI Integration

Terminal mode should rely on cockpit for primary mode display.

Mode-specific UI suggestions:

- Use `$ terminal` in the footer/title.
- Use bash-mode border color while terminal mode is active.
- For shell-command mode, show command output as custom messages.
- For shell handoff mode, notify before entering the shell and after returning.

## Phase 3 Acceptance Criteria

For real shell handoff V1:

- `/mode terminal` enters a real shell.
- Pi TUI stops before the shell starts.
- Shell inherits stdio and behaves normally.
- Interactive programs like `vim`, `less`, or `htop` work.
- Exiting shell restarts Pi TUI.
- Cockpit returns to a safe mode, probably `edit`.

For shell-command V1:

- `/mode terminal` causes typed input to execute as shell commands.
- Output is rendered in Pi.
- `cd` affects subsequent commands.
- `exit` returns to `edit` mode.
- `Shift+Tab` cycles out of terminal mode.
