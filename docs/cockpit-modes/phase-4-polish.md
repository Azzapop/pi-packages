# Phase 4: Polish, Docs, and Hardening

## Goal

After cockpit mode hosting, plan mode, and terminal mode are working, harden the mode system for daily use and document it as a stable plugin API.

This phase depends on the core work in:

- [Phase 1: Cockpit Mode Host](phase-1-cockpit-mode-host.md)
- [Phase 2: Plan Mode](phase-2-plan-mode.md)
- [Phase 3: Terminal Mode Plugin](phase-3-terminal-mode-plugin.md)

## Documentation

Add cockpit mode API documentation to `packages/pi-cockpit/README.md`.

Include:

- How to register a mode.
- Mode object fields.
- Event names.
- Lifecycle order.
- How mode switching works.
- How to contribute footer/title/status segments.
- How input and `before_agent_start` routing works.
- How mode persistence works.

Example docs snippet:

```ts
pi.events.emit("cockpit:mode:register", {
  id: "review",
  label: "Review",
  icon: "🔎",
  order: 40,
  beforeAgentStart(event, ctx) {
    return {
      systemPrompt: event.systemPrompt + "\n\nYou are in code review mode.",
    };
  },
});
```

## Flags and Configuration

Consider adding cockpit flags:

```text
--cockpit-mode-start edit|plan|terminal
--cockpit-mode-shortcut shift+tab|none
--cockpit-terminal-mode handoff|commands|pty
```

Potential behavior:

- `--cockpit-mode-start` overrides restored mode for the current run.
- `--cockpit-mode-shortcut none` disables Cockpit's mode cycle shortcut.
- `--cockpit-terminal-mode` selects terminal implementation if terminal package supports multiple backends.

## Keybinding Documentation

Because Pi currently uses `Shift+Tab` for thinking-level cycling, document the recommended keybinding change:

```json
{
  "app.thinking.cycle": ["ctrl+shift+t"]
}
```

If Cockpit eventually supports configurable mode shortcut, document that too.

## Load Order Hardening

Mode package load order can matter. Harden behavior for these cases:

1. Cockpit loads before mode packages.
2. Mode package emits registration before Cockpit listener is ready.
3. `/reload` reloads Cockpit and mode packages.
4. Session resume restores a mode before that mode is registered.

Potential solutions:

- Mode packages re-emit registration on `session_start`.
- Cockpit falls back to `edit` until the persisted mode is registered.
- Cockpit emits a `cockpit:ready` event mode packages can respond to.
- Cockpit accepts late registration and restores pending mode when it appears.

## Error Handling

Mode switching should be resilient.

Rules:

- If current mode `onExit` fails, log/notify but continue unless failure is fatal.
- If next mode `onEnter` fails, restore previous mode if possible.
- Unknown modes should never crash; show available mode IDs.
- Bad mode registrations should be ignored with a warning.

Validate mode registration fields:

- `id` must be non-empty and stable.
- `label` must be non-empty.
- `order` should default to a large number or registration order.
- Duplicate IDs should replace or reject consistently. Prefer replacing with a warning during development.

## Session and Reload Behavior

Validate:

- Active mode survives `/reload`.
- Active mode survives `/resume` if package is installed.
- Missing mode restores to `edit`.
- Mode-specific widgets/status are cleaned up on exit and shutdown.
- Terminal handoff does not leave TUI stopped on errors.
- Plan mode does not leave read-only tool restrictions active after exit.

## Package Polish

Each mode package should have:

- `package.json` with `pi.extensions` manifest.
- `peerDependencies` for Pi packages it imports.
- Short README explaining usage.
- Clear command list.
- Clear failure modes and limitations.

Potential packages:

```text
packages/pi-plan/
packages/pi-mode-plan/
packages/pi-mode-terminal/
```

## Validation Checklist

Repository checks:

```bash
git status --short
find packages -maxdepth 4 -type f | sort
python3 -m json.tool package.json >/dev/null
python3 -m json.tool .pi/settings.json >/dev/null
find packages -name package.json -print0 | xargs -0 -n1 python3 -m json.tool >/dev/null
```

Manual Pi checks:

```text
/reload
/mode list
/mode edit
/mode plan
/mode terminal
Shift+Tab mode cycle
```

Plan mode checks:

- unsafe commands are blocked
- plan extraction works
- todo widget updates
- exiting plan restores tools

Terminal mode checks:

- shell starts/stops correctly
- interactive commands work if using handoff
- `exit` returns to Pi cleanly

## Phase 4 Acceptance Criteria

- Mode plugin API is documented.
- Mode behavior is stable across `/reload` and session resume.
- Missing/failed modes degrade to `edit` safely.
- Keybinding conflict with thinking-level cycling is documented or configurable.
- Plan and terminal packages have READMEs and package manifests.
- Repository validation commands pass.
