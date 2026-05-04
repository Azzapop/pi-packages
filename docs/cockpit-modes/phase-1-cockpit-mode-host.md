# Phase 1: Cockpit Mode Host

## Goal

Modify `pi-cockpit` so it becomes a pluggable mode host. This phase should not implement plan or terminal behavior yet. It only provides the registry, switching, UI integration, persistence, and event contract that later mode packages will use.

## Deliverables

- Built-in `edit` mode.
- External mode registration via `pi.events`.
- `/mode` command.
- `Shift+Tab` mode cycling.
- Footer/editor mode indicator.
- Session persistence.
- Event routing hooks for active mode behavior.

## Cockpit Mode Registry

Cockpit should maintain an in-memory registry:

```ts
type CockpitModeId = string;

type CockpitMode = {
  id: CockpitModeId;
  label: string;
  icon?: string;
  description?: string;
  order?: number;

  onEnter?: (ctx: ExtensionContext) => void | Promise<void>;
  onExit?: (ctx: ExtensionContext) => void | Promise<void>;

  getTitlePrefix?: (ctx: ExtensionContext) => string | undefined;
  getFooterSegments?: (ctx: ExtensionContext) => string[];
  getStatusText?: (ctx: ExtensionContext) => string | undefined;

  onInput?: (event: InputEvent, ctx: ExtensionContext) => InputEventResult | Promise<InputEventResult>;
  beforeAgentStart?: (event: BeforeAgentStartEvent, ctx: ExtensionContext) => BeforeAgentStartResult | Promise<BeforeAgentStartResult>;
};
```

Cockpit state:

```ts
const modes = new Map<string, CockpitMode>();
let activeMode = "edit";
```

Built-in default mode:

```ts
{
  id: "edit",
  label: "Edit",
  icon: "✎",
  description: "Normal Pi editing mode",
  order: 0,
}
```

## Event Bus API

Use Pi's shared event bus as the public plugin API.

### Register a mode

Mode packages emit:

```ts
pi.events.emit("cockpit:mode:register", {
  id: "plan",
  label: "Plan",
  icon: "📋",
  description: "Interview, explore safely, and build an implementation plan",
  order: 20,
  onEnter(ctx) {},
  onExit(ctx) {},
  beforeAgentStart(event, ctx) {},
});
```

Cockpit listens:

```ts
pi.events.on("cockpit:mode:register", (mode: CockpitMode) => {
  registerMode(mode);
});
```

### Switch modes

Optional event API:

```ts
pi.events.emit("cockpit:mode:switch", { id: "plan" });
pi.events.emit("cockpit:mode:next");
```

Cockpit can emit notifications for other extensions:

```ts
pi.events.emit("cockpit:mode:changed", {
  previousMode: "edit",
  activeMode: "plan",
});
```

## Cockpit Commands

Add a `/mode` command owned by `pi-cockpit`:

```text
/mode              Open selector for registered modes
/mode list         Show registered modes
/mode status       Show current mode
/mode next         Cycle to next mode
/mode edit         Switch to edit mode
/mode plan         Switch to plan mode, if registered
/mode terminal     Switch to terminal mode, if registered
```

Behavior:

- Unknown mode should show a friendly error and available modes.
- Switching should call current mode `onExit`, then next mode `onEnter`.
- If `onEnter` fails, cockpit should restore the previous mode if possible.

## Keyboard Shortcut

Desired shortcut:

```ts
pi.registerShortcut("shift+tab", {
  description: "Cycle cockpit mode",
  handler: async (ctx) => switchToNextMode(ctx),
});
```

Pi currently binds `Shift+Tab` to thinking-level cycling (`app.thinking.cycle`). Move that binding in `~/.pi/agent/keybindings.json`:

```json
{
  "app.thinking.cycle": ["ctrl+shift+t"]
}
```

If application keybindings win over extension shortcuts, cockpit can instead intercept `Shift+Tab` in its `CustomEditor` wrapper.

## Persistence

Persist active mode in the session:

```ts
pi.appendEntry("cockpit-mode", {
  activeMode,
});
```

Restore on `session_start` by reading the last custom entry with `customType === "cockpit-mode"`.

Recommended behavior:

- Restore `edit` if the persisted mode is no longer registered.
- Restore mode UI on `/reload`.
- Do not run destructive mode `onEnter` behavior until UI/session is fully available.

## Cockpit UI Integration

### Footer

`pi-cockpit` footer should include the active mode near model/thinking info. It should be the first value in the footer. No icon is needed:

```text
plan | ...
edit | ...
terminal | ...
```

Modes may contribute extra footer segments via `getFooterSegments(ctx)`.

### Status

Cockpit may also set a status:

```ts
ctx.ui.setStatus("pi-cockpit-mode", "plan");
```

If the footer already displays mode clearly, status can be reserved for mode-specific transient information.

### Editor border

Current cockpit behavior:

- Bash input (`!`) uses Pi's bash-mode border color.
- Otherwise muted border.

Mode-aware enhancement:

- `terminal` mode can use bash-mode border always.
- `plan` mode can use warning/accent border.
- `edit` remains muted.

## Input and Agent Event Routing

Cockpit should route relevant Pi events to the active mode.

### Input event

```ts
pi.on("input", async (event, ctx) => {
  const mode = getActiveMode();
  return mode.onInput?.(event, ctx);
});
```

Use cases:

- Terminal mode intercepts typed input and runs it as shell.
- Plan mode may transform shorthand or block direct execution.

### before_agent_start event

```ts
pi.on("before_agent_start", async (event, ctx) => {
  const mode = getActiveMode();
  return mode.beforeAgentStart?.(event, ctx);
});
```

Use cases:

- Plan mode injects planning instructions.
- Terminal mode may block LLM turns if terminal input is shell-only.

## Phase 1 Acceptance Criteria

- `/mode list` shows at least `edit`.
- A test extension can register a fake mode over `cockpit:mode:register`.
- `/mode <fake>` switches to the fake mode and calls `onEnter`.
- `/mode edit` switches back and calls fake mode `onExit`.
- `Shift+Tab` cycles through registered modes after rebinding thinking cycle.
- Active mode appears in the cockpit footer or editor title.
- Current mode survives `/reload` and session resume when the mode is registered.
