# Phase 3: Terminal Mode Plugin

## Goal

Create a terminal mode package that plugs into the cockpit mode host. Terminal mode should let users run terminal commands while preserving the Cockpit UI.

This phase depends on [Phase 1: Cockpit Mode Host](phase-1-cockpit-mode-host.md). It can be implemented independently of [Phase 2: Plan Mode](phase-2-plan-mode.md).

## Chosen Path

Use a staged approach:

1. **Phase 3A: Cockpit shell-command mode** — simple, useful, keeps Cockpit visible.
2. **Phase 3B: Embedded PTY terminal** — persistent shell inside Cockpit, closer to a real terminal.
3. **Phase 3C: Optional shell handoff command** — fallback for full-screen interactive programs that need raw terminal ownership.

Do **not** make real shell handoff the default terminal mode, because it stops Cockpit rendering. The primary requirement is to keep Cockpit visible.

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
  description: "Run shell commands inside Cockpit",
  order: 30,
  onEnter(ctx) {
    // activate terminal behavior
  },
  onExit(ctx) {
    // clean up terminal behavior
  },
  onInput(event, ctx) {
    // intercept typed input and run it as a command
  },
});
```

Modes should not affect the Cockpit title. The title is its own thing.

## Phase 3A: Cockpit Shell-Command Mode

### Purpose

Provide a terminal-like command loop inside Pi/Cockpit without handing off the real terminal.

### Behavior

When active:

- user input is treated as shell command instead of LLM prompt
- commands execute from a terminal-mode cwd
- output is rendered inside Pi/Cockpit
- Cockpit remains visible
- `Shift+Tab` can cycle modes normally
- `exit` returns to `edit` mode

Example:

```text
/mode terminal
$ pwd
/Users/aaron/src/pi-packages
$ ls
README.md packages docs ...
$ cd packages
$ pwd
/Users/aaron/src/pi-packages/packages
$ exit
# returns to edit mode
```

### Implementation

- Register `terminal` cockpit mode.
- Maintain `terminalCwd`, initialized from `ctx.cwd`.
- In active mode `onInput`:
  - ignore empty input
  - handle `exit` by switching to `edit`
  - handle `pwd` without spawning if desired
  - handle `cd <path>` by resolving/updating `terminalCwd`
  - run all other commands through shell execution
  - return `{ action: "handled" }` so the prompt is not sent to the LLM
- Render command output as visible custom messages.
- Include command, cwd, stdout/stderr, and nonzero exit code.

### Interactive Commands

Phase 3A should detect obvious full-screen/interactive commands and not pretend to support them.

Examples:

- `vim`, `nvim`, `less`, `more`, `top`, `htop`, `btop`
- `ssh`, `tmux`, `screen`
- `lazygit`, `tig`

For V1, show a message like:

```text
Interactive command detected. Embedded PTY support is planned for Phase 3B. Use normal Pi bash escape or a future handoff command for now.
```

### Acceptance Criteria

- `/mode terminal` keeps Cockpit visible.
- Typing `ls` runs `ls`, not the LLM.
- `pwd` shows current terminal cwd.
- `cd packages` changes terminal cwd.
- command output appears in the Pi/Cockpit conversation.
- nonzero exit codes are visible.
- `exit` switches back to `edit` mode.
- `Shift+Tab` cycles out of terminal mode.
- Cockpit title remains unchanged.

## Phase 3B: Embedded PTY Terminal

### Purpose

Provide a persistent shell process inside Cockpit for a more terminal-like experience while keeping Cockpit visible.

This is the implementation that best matches “shell handoff while keeping Cockpit,” but it is more complex than command mode.

### Behavior

- Start a persistent shell process through a PTY.
- Render terminal output inside a Cockpit component or widget area.
- Forward keystrokes to the PTY while terminal mode is active.
- Preserve Cockpit footer/editor/mode UI around the terminal area.
- Support resize handling.
- Maintain scrollback.
- Allow `Shift+Tab` or another key to return focus/cycle mode.

### Likely Dependency

Use a PTY package such as `node-pty` if compatible with Pi package loading and local installation.

### Challenges

- raw input handling
- ANSI rendering
- scrollback
- terminal resize
- process lifecycle
- Ctrl-C/Ctrl-D behavior
- focus management with Cockpit editor
- avoiding conflicts with Pi global keybindings

### Acceptance Criteria

- terminal mode starts a persistent shell inside Cockpit
- `cd` persists naturally because the shell process is persistent
- basic interactive line editing works
- command output streams into the terminal area
- Cockpit footer remains visible
- mode cycling or a dedicated escape key returns to edit mode
- shell process is cleaned up on session shutdown/reload

## Phase 3C: Optional Shell Handoff Command

### Purpose

Offer a fallback for full-screen programs that need complete terminal ownership.

This should be optional and explicit, not the default terminal mode.

Potential commands:

```text
/terminal-handoff
/terminal-handoff htop
```

Behavior:

- stop Pi TUI
- spawn `$SHELL` or the requested command with inherited stdio
- restart Pi TUI after exit
- return to previous mode or `edit`

Use this only when Cockpit cannot realistically host the target interaction.

## UI Integration

Terminal mode should rely on Cockpit for primary mode display.

Rules:

- Do not alter the Cockpit title.
- Mode label appears only through Cockpit mode display.
- Terminal mode can use bash-mode editor border if Cockpit supports mode-aware borders.
- Command output should be rendered as custom messages or, later, a dedicated terminal component.

## Recommended Implementation Order

1. Implement Phase 3A shell-command mode.
2. Use it daily and identify gaps.
3. Design the embedded PTY component for Phase 3B.
4. Add optional shell handoff only for commands that cannot work inside Cockpit.

## Phase 3 Overall Acceptance Criteria

- Terminal mode keeps Cockpit visible by default.
- Terminal mode does not affect title.
- Basic shell commands can be run without invoking the LLM.
- There is a clear path to embedded PTY support for more terminal-like behavior.
- Optional shell handoff is treated as an escape hatch, not the default mode.
