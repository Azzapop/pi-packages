---
name: plan-execute
description: Execute an explicitly approved numbered plan in order, using DONE markers for progress tracking. Use only after the user has approved the plan.
---

# Plan Execute

Use this skill only after the user explicitly approves a numbered plan. If approval is missing or ambiguous, stop and ask for approval before editing.

## When to Use

- The user explicitly approves a plan and asks you to implement it.
- A plan-mode workflow has moved from planning into execution.
- You have an approved numbered `Plan:` section or approved plan document.
- Do not use this skill for draft, unapproved, or speculative plans.

## Preconditions

Before editing, verify:

- the plan was explicitly approved by the user
- the numbered steps are available
- constraints and acceptance criteria are available
- implementation is allowed to modify files
- if possible, execution is happening in a fresh or cleared implementation context seeded with the approved plan, interview summary, constraints, and critical findings

If any precondition is missing, ask the user instead of editing.

## Workflow

1. Restate the approved plan source briefly.
2. Execute steps sequentially, treating each numbered step as a separate checkpoint.
3. Do not skip steps silently.
4. Validate after meaningful changes.
5. After completing step `n`, immediately include `[DONE:n]` in your response before starting any later step.
6. You may continue automatically to the next step only after the prior step has been marked with its `[DONE:n]` marker.
7. If the plan becomes invalid, pause and explain why before continuing.
8. At the end, summarize completed steps and validation results.

## Progress and Resume Commands

Use compact plan UI by default. For detailed progress, prefer commands instead of relying on the persistent widget:

- `/plan-list` shows saved in-progress plans from `planPath`.
- `/plan-open <number|path>` loads a saved plan into the current session.
- `/plan-current` shows the next incomplete step.
- `/plan-status` shows grouped completed/next/remaining progress.
- `/plan-todos` shows the full checklist on demand.
- `/plan-next` or `/plan-resume` continues from the first incomplete step.

## Progress Markers

Use exact markers so extensions can track progress:

```text
[DONE:1]
[DONE:2]
[DONE:3]
```

Only emit `[DONE:n]` after step `n` is actually complete. Emit one marker per completed step so progress can be persisted and resumed later. Do not batch multiple completed steps without their individual markers.

## Safety

- Do not edit before verifying approval.
- Stay within the approved scope.
- If implementation reveals a materially different approach is needed, stop and request plan revision.
- Preserve durable progress by marking each completed step before continuing or pausing.
- Preserve user changes and avoid destructive commands unless explicitly approved.

## Output Format

```md
## Execution Update

Completed:
- [DONE:1] Step description and result

Validation:
- ...

Next:
- Step 2 ...
```
