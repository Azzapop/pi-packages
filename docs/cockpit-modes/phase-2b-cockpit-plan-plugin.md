# Phase 2B: Cockpit Plan Mode Plugin

## Goal

Create a Cockpit plugin that registers a `plan` mode and layers UI/mode ergonomics on top of the reusable planning resources from [Phase 2A](phase-2a-plan-skills.md).

This plugin should enhance the planning experience when `pi-cockpit` is installed, but the underlying skills/prompts should remain usable without it.

## Package

Recommended package:

```text
packages/pi-mode-plan/
  package.json
  extensions/
    plan-mode.ts
```

The package registers a `plan` mode with Cockpit via `pi.events`.

## Responsibilities

- Register `plan` mode with Cockpit.
- Prevent file edits while planning.
- Restrict tools to read-only exploration while planning.
- Block unsafe bash commands while planning.
- Require explicit plan approval before implementation.
- Clear or reset implementation context only after approval.
- Auto-enter plan mode when planning intent phrases are detected in normal user input.
- Route plan-mode agent instructions through the Cockpit mode callback.
- Optionally call or reference the reusable `pi-plan` skills/prompts.
- Parse numbered `Plan:` output into todos.
- Save/load plan documents using a configurable destination.
- Allow refine/approve/execute decisions.
- Track execution progress with `[DONE:n]` markers.
- Render plan todo widget/status while Cockpit UI is active.

## Registration Shape

```ts
pi.events.emit("cockpit:mode:register", {
  id: "plan",
  label: "Plan",
  description: "Interview, explore safely, and build an implementation plan",
  order: 20,
  onEnter(ctx) {
    // enable plan behavior
  },
  onExit(ctx) {
    // restore previous tools/widgets/status
  },
  beforeAgentStart(event, ctx) {
    // inject plan instructions
  },
});
```

Note: Cockpit mode labels intentionally do not need icons. Cockpit renders mode names in its own footer/title style.

## Plan Mode Behavior

### Auto-Enter Triggers

Plan mode should become easier to use by detecting planning intent in normal prompts. If the user is not already in plan mode and sends a prompt containing phrases like these, the plugin should enter plan mode before the agent starts:

- "help me plan"
- "let's plan"
- "make a plan"
- "draft a plan"
- "implementation plan"
- "think this through"
- "before implementing"
- "don't edit"
- "read-only"
- "plan workflow"
- "approval flow"
- prompts containing both "plan" and "approve"/"approval"

`/plan` should also enter plan mode before expanding the reusable prompt template. Other slash commands, bash commands, extension-injected messages, and already-approved execution should not auto-enter plan mode.

### On Enter

- Snapshot current active tools.
- Restrict tools to read-only planning tools:

```ts
["read", "bash", "grep", "find", "ls"]
```

- Set plan state to planning mode. This must happen any time Cockpit enters `plan`, regardless of whether entry came from `/mode plan`, Shift+Tab cycling, auto-detected input, `/plan`, session restore, or a Cockpit mode event.
- Optionally prefill or send a planning prompt that references the reusable `plan-interview` / `plan-draft` skills.

### During Planning

Plan mode is strictly non-implementation-editing.

- Inject plan-mode prompt instructions through `beforeAgentStart`.
- Resolve the effective configured `planPath` on entering plan mode and create that directory if it does not exist.
- Allow `edit` and `write` only under the effective configured `planPath` while planning.
- If `planPath` is session-only or not configured, block all `edit` and `write` calls while planning.
- Block `edit` and `write` for source files while planning.
- Use a strict bash allowlist in `tool_call`: only simple read-only commands are allowed while planning.
- Block shell metacharacters, redirection, command chaining, heredocs, and arbitrary interpreters while planning.
- Block or reject any attempted source file mutation even if a mutating tool is accidentally active.
- Encourage read-only exploration.
- Encourage interview before drafting if requirements are unclear.
- Require a numbered `Plan:` section.

Prompt addon:

```text
[PLAN MODE ACTIVE]

You are in interactive planning mode.
Use the reusable planning workflow: interview, read-only exploration, draft, review, approval.
Do not modify source files.
Only edit plan documentation under the effective configured `planPath` while planning. If `planPath` is session-only or not configured, do not write plan files.
Use read-only investigation for code.
Produce a concrete numbered plan under a `Plan:` header.
Wait for explicit user approval before implementation.
```

### After Draft Plan

- Parse numbered plan items.
- Save or offer to save the plan document to the configured destination.
- Display todos in a widget.
- Immediately prompt the user for approval/refinement choices:
  - Execute plan
  - Refine plan
  - Stay in plan mode
  - Exit to edit mode

## Plan Document Storage

The Cockpit plugin should expose an ergonomic way to configure where plan docs are saved, while reusing the storage behavior from `pi-plan`.

### Destinations

Supported destination types:

```text
session-only        no file write; keep plan in session state
settings plan path
```

### Settings

Use Pi settings as the source of truth. The setting name should be `planPath`:

```json
{
  "planPath": "docs/plans"
}
```

Resolution rules:

- repo/project `.pi/settings.json` configures the current repo by default
- global Pi settings configure the fallback for all repos
- repo/project settings override global settings
- relative paths resolve against the current repo/root working directory
- absolute paths and `~` paths can point to shared personal/team locations
- `null`, `false`, or `"session"` means session-only/no file write

Examples:

```json
{ "planPath": "docs/plans" }
{ "planPath": ".pi/plans" }
{ "planPath": "~/plans/pi" }
{ "planPath": null }
```

### Commands

Potential command:

```text
/plan-path                 Show the effective plan document destination and whether it came from repo or global settings
```

This command should be informational. Persistent changes should be made by editing Pi settings.

### Behavior

- Planning can write plan documents to the configured plan-doc location before implementation approval.
- Plan document writes are documentation output and should not count as implementation edits.
- Source edits remain blocked until the plan is explicitly approved.
- If no `planPath` is configured, default to `session-only`.
- The approved plan path should be included when seeding the implementation context.

### Confirm and Execute Plan

Implementation must not start automatically. After a draft plan is available, require explicit user confirmation.

Confirmation UI should summarize:

- the numbered plan
- whether implementation will start in a fresh/cleared context
- what context will be preserved for implementation
- whether normal editing tools will be restored

On approval:

1. Persist the approved plan in session state and, if configured, as a plan document.
2. Exit plan mode and restore edit mode/tool access.
3. Clear/reset implementation context, or create a new session, so implementation starts from the approved plan rather than the full planning conversation.
3. Seed the new/cleared context with:
   - the approved plan
   - the plan document path, if any
   - relevant interview summary
   - critical constraints/acceptance criteria
   - any important exploration findings
4. Restore previous tools or switch to normal edit tools.
5. Keep plan todos visible.
6. Ask agent to execute steps in order.
7. Require `[DONE:n]` markers.
8. Update progress as markers appear.

If the user does not approve, stay in plan mode and keep editing disabled.

## Persistence

Persist plan plugin state separately from Cockpit's active mode:

```ts
pi.appendEntry("plan-mode", {
  todos,
  approvedPlan,
  executionMode,
  previousTools,
  implementationSession,
  planPath,
  planStorage,
});
```

Restore on `session_start` by reading the latest `plan-mode` custom entry.

## Relationship to Reusable Skills

The plugin should not duplicate planning methodology if the skills exist.

Preferred behavior:

- The plugin's prompt addon references the same workflow from `pi-plan`.
- The standalone `/plan` prompt and the Cockpit `plan` mode produce compatible `Plan:` output.
- The plugin parses the same numbered output that `plan-draft` produces.
- `plan-execute` and the plugin both use `[DONE:n]` markers.

## Non-Goals

This sub-phase should not:

- define the canonical planning methodology from scratch
- make planning resources unusable without Cockpit
- require Cockpit for `/plan` prompt usage
- own global planning skills

## Acceptance Criteria

- `/mode plan` switches to plan mode after the package is loaded.
- Plan mode appears in Cockpit footer/title.
- Agent receives plan-mode instructions before turns.
- Mutating tools are unavailable or blocked while planning.
- `edit` and `write` can only modify files under the effective configured `planPath` while planning.
- If `planPath` is session-only or not configured, all `edit` and `write` calls are blocked while planning.
- Source files cannot be modified in plan mode.
- Bash is restricted to simple read-only allowlisted commands while planning.
- Unsafe bash commands are blocked while planning.
- Numbered `Plan:` output from reusable skills/prompts is parsed into todos.
- Plan docs can be saved to session-only, repo-local, repo-private, or shared destinations based on the effective `planPath` setting.
- User can choose execute/refine/stay/exit after draft plan.
- Implementation cannot begin without explicit approval of the plan.
- After approval, implementation starts from a cleared/new context seeded with the approved plan and essential planning artifacts.
- Execution tracking widget updates when `[DONE:n]` markers appear.
- `pi-plan` resources remain usable without installing this plugin.
