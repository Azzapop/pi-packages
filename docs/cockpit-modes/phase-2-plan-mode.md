# Phase 2: Plan Mode

## Goal

Build plan-mode capability in two layers:

1. **Reusable planning resources** — skills, prompts, and helpers that work anywhere in Pi, even without `pi-cockpit`.
2. **Cockpit integration plugin** — a mode package that registers `plan` with Cockpit and adds mode switching, read-only enforcement, UI state, and progress tracking.

This preserves the important separation: the planning workflow should be useful regardless of whether the cockpit mode plugin is installed.

## Sub-Phase Documents

1. [Phase 2A: Reusable Plan Skills and Resources](phase-2a-plan-skills.md)
2. [Phase 2B: Cockpit Plan Mode Plugin](phase-2b-cockpit-plan-plugin.md)

## Intended Package Split

Recommended package layout:

```text
packages/
  pi-plan/
    package.json
    skills/
      plan-interview/SKILL.md
      plan-draft/SKILL.md
      plan-review/SKILL.md
      plan-execute/SKILL.md
    prompts/
      plan.md
      plan-review.md
    extensions/
      plan-tools.ts          # optional reusable non-cockpit helpers

  pi-mode-plan/
    package.json
    extensions/
      plan-mode.ts           # cockpit mode integration
```

## Dependency Direction

```text
pi-plan               # reusable; no cockpit dependency
  skills/prompts/tools

pi-mode-plan          # cockpit integration
  depends on concepts/resources from pi-plan
  registers cockpit mode via pi.events
```

Rules:

- `pi-plan` must not require `pi-cockpit`.
- Skills and prompts must work through normal Pi slash commands.
- `pi-mode-plan` may enhance the experience when Cockpit is installed.
- If Cockpit is missing, reusable planning commands should still be available.

## High-Level Workflow

Reusable resources provide the planning method:

1. Interview the user.
2. Explore/research safely.
3. Draft a structured plan without editing files.
4. Save plan documents to a configurable location.
5. Review/refine the plan.
6. Require explicit approval.
7. Start implementation from a cleared/new context seeded with the approved plan.
8. Execute with explicit step tracking.

Cockpit plugin provides mode ergonomics:

1. `/mode plan` enters plan mode.
2. `Shift+Tab` can cycle into plan mode.
3. Tools are restricted during planning.
4. Editing is prevented during planning.
5. Unsafe bash commands are blocked.
6. Plan approval is required before implementation.
7. Implementation starts from a cleared/new context seeded with the approved plan.
8. Plan state appears in cockpit UI.
9. Execution progress is tracked in widgets/status.

## Plan Document Storage

Planning resources and mode plugins should support configurable plan document storage.

Use cases:

- Save plans inside the local repository, for example `docs/plans/` or `.pi/plans/`.
- Save plans outside the repo in a shared personal/team location.
- Save transient plans only in the Pi session when no persistent file is desired.

Configuration should be driven by Pi settings, not ad hoc prompt arguments. Use a `planPath` setting:

```json
{
  "planPath": "docs/plans"
}
```

Resolution rules:

- repo/project settings configure the current repo by default
- global Pi settings configure the default for all repos
- repo/project settings override global settings
- relative paths resolve against the current repo/root working directory
- absolute or `~` paths can point to shared personal/team locations
- `null`, `false`, or `"session"` can mean session-only/no file write

Examples:

```json
{ "planPath": "docs/plans" }
{ "planPath": ".pi/plans" }
{ "planPath": "~/plans/pi" }
{ "planPath": null }
```

The reusable `pi-plan` resources should describe the expected file format and naming scheme. The Cockpit plugin can provide a command for showing the effective `planPath`, but persistent configuration should live in Pi settings.

## Phase 2 Acceptance Criteria

Phase 2 is complete when:

- Planning skills/prompts can be invoked without Cockpit.
- `pi-mode-plan` registers a `plan` mode when Cockpit is present.
- `/mode plan` switches into plan mode.
- The same planning method is used by both the standalone resources and the Cockpit mode.
- Plan mode can restrict tools and block unsafe bash commands.
- Plan mode prevents file edits before approval.
- Numbered plans can be parsed into todos.
- Plan documents can be saved to a configurable destination or kept session-only.
- Implementation cannot begin until the user explicitly approves the plan.
- Implementation can start from a cleared/new context seeded with the approved plan and essential planning artifacts.
- Execution progress can be tracked with `[DONE:n]` markers.
