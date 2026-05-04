# Phase 2A: Reusable Plan Skills and Resources

## Goal

Create planning skills, prompts, and optional helper tools that can be used in normal Pi without installing or enabling the Cockpit mode plugin.

This sub-phase is about the planning methodology, not Cockpit UI integration.

## Package

Recommended package:

```text
packages/pi-plan/
  package.json
  skills/
    plan-interview/
      SKILL.md
    plan-draft/
      SKILL.md
    plan-review/
      SKILL.md
    plan-execute/
      SKILL.md
  prompts/
    plan.md
    plan-review.md
  extensions/
    plan-tools.ts          # optional
```

The package should expose skills and prompts through its `pi` manifest.

## Resources

### Skill: `plan-interview`

Purpose: clarify the user's request before any implementation.

Should capture:

- desired outcome
- context/background
- constraints
- files/subsystems in scope
- files/subsystems out of scope
- acceptance criteria
- risk tolerance
- expected level of detail
- whether the user wants implementation after planning

Expected output:

```md
## Interview Summary

Goal:
...

Scope:
...

Constraints:
...

Acceptance Criteria:
...

Open Questions:
...
```

### Skill: `plan-draft`

Purpose: produce a concrete, numbered implementation plan.

Expected behavior:

- Use read-only investigation where needed.
- Avoid edits while drafting.
- Do not call edit/write tools while drafting.
- Include assumptions and risks.
- Produce a numbered `Plan:` section that downstream tools/extensions can parse.
- End by asking for explicit approval before implementation.

Expected output:

```md
## Planning Context
...

## Assumptions
...

## Risks
...

Plan:
1. First step
2. Second step
3. Third step

## Validation
...
```

### Skill: `plan-review`

Purpose: critique/refine an existing plan before execution.

Should check:

- missing steps
- risky sequencing
- unclear validation
- over-broad scope
- likely failure points
- whether steps are independently verifiable

Expected output:

```md
## Plan Review

Strengths:
...

Concerns:
...

Recommended Changes:
...

Revised Plan:
1. ...
2. ...
```

### Skill: `plan-execute`

Purpose: execute an approved numbered plan in order.

This skill should only be used after the user explicitly approves the plan. If possible, execution should start from a fresh or cleared implementation context seeded with the approved plan, interview summary, constraints, and critical findings.

Should instruct the agent to:

- verify the plan was approved before editing
- execute steps sequentially
- avoid skipping steps silently
- validate after meaningful changes
- emit `[DONE:n]` after completing step `n`
- pause and ask if the plan becomes invalid

Expected behavior:

```text
After completing step 1, include [DONE:1].
After completing step 2, include [DONE:2].
```

## Prompt Templates

### `/plan`

A prompt template that runs the whole planning workflow in normal Pi:

1. Interview if needed.
2. Explore read-only.
3. Draft plan.
4. Ask for approval before edits.

### `/plan-review`

A prompt template for reviewing an existing plan.

## Plan Document Storage

Reusable planning resources should support saving plan documents without depending on Cockpit.

### Storage Destinations

Supported destination types:

```text
session-only        Store only in Pi session state; do not write a file.
repo-relative       Save under the current repository, e.g. docs/plans/ or .pi/plans/.
absolute/shared     Save to an absolute or expanded path, e.g. ~/plans/pi or /Volumes/team/plans.
```

### Configuration

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
- if the path does not exist, it should safely create it

Examples:

```json
{ "planPath": "docs/plans" }
{ "planPath": ".pi/plans" }
{ "planPath": "~/plans/pi" }
{ "planPath": null }
```

A helper command may show the effective path, but should not be the primary persistence mechanism.

The reusable package should not require Cockpit to choose or use a path.

### Naming Scheme

Plan files should use stable, sortable names:

```text
YYYY-MM-DD-slug.plan.md
YYYY-MM-DD-HHMM-slug.plan.md
```

Recommended contents:

```md
# Plan: Short Title

Status: draft | approved | executing | complete
Created: ISO timestamp
Project: repo name or cwd
Source Session: optional session id/path

## Interview Summary
...

## Constraints and Acceptance Criteria
...

## Exploration Findings
...

## Approved Plan
1. ...
2. ...

## Execution Progress
- [ ] 1. ...
- [ ] 2. ...
```

### Safety

Writing a plan document is allowed during planning only if the user/config has selected a plan-doc destination. It should be treated as documentation output, not implementation. The agent must still avoid editing project source files before approval.

## Optional Helper Extension

A reusable `plan-tools.ts` extension may provide non-Cockpit helpers, for example:

- extracting numbered plan steps
- storing plan todos in session state
- saving/loading plan documents from the configured destination
- rendering plan todos as a generic widget
- command `/plan-todos`
- command `/plan-clear`

Important: this extension must not require Cockpit events.

## Non-Goals

This sub-phase should not:

- register a Cockpit mode
- depend on `pi-cockpit`
- own `Shift+Tab`
- require cockpit footer/editor APIs
- assume the user is in a special mode

## Acceptance Criteria

- `pi-plan` can be installed without `pi-cockpit`.
- Skills are available via normal Pi skill commands.
- Prompt templates are available as slash commands.
- `/plan` can guide a planning workflow in normal Pi.
- Plan documents can be saved to repo-local, repo-private, shared, or session-only destinations.
- Planning resources instruct the agent not to edit source files before approval.
- `plan-execute` requires an approved plan before implementation.
- `plan-execute` instructions use `[DONE:n]` markers.
- No Cockpit event API is required for the reusable resources to work.
