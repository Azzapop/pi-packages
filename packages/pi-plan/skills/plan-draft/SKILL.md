---
name: plan-draft
description: Draft a concrete numbered implementation plan from an interview, request, or read-only exploration. Use when the user wants a plan before edits or when plan-mode workflows need parseable steps.
---

# Plan Draft

Use this skill to produce a concrete, numbered plan that can be reviewed, approved, saved, and later executed. This is a planning-only skill: do not edit source files while drafting.

## When to Use

- The user asks for a plan, approach, implementation strategy, or design before coding.
- You have completed a planning interview and need to turn it into steps.
- You need a `Plan:` section that other tools/extensions can parse into todos.
- Do not use this skill to begin implementation.

## Workflow

1. Review the request, interview summary, constraints, and acceptance criteria.
2. Perform read-only exploration if necessary using safe inspection tools.
3. Identify assumptions and risks.
4. Draft a sequential, concrete plan.
5. Include validation steps.
6. Ask the user for explicit approval before implementation.
7. If plan document storage is configured via `planPath`, offer to save or update the plan document.

## Safety

- Do not call `edit` or `write` for source files while drafting.
- Do not make implementation changes.
- Use read-only investigation only.
- If writing a plan document, write only to the configured plan-doc destination. Treat plan docs as documentation output, not implementation.
- If no `planPath` is configured, keep the plan in the session unless the user explicitly asks for another destination.

## Plan Document Guidance

If saving a plan document, use the effective `planPath` setting. Relative paths resolve against the current repo/root working directory. Absolute and `~` paths may point to shared locations. `null`, `false`, or `"session"` means no file write.

Use a stable, sortable filename:

```text
YYYY-MM-DD-HHMM-short-slug.plan.md
```

## Output Format

```md
## Planning Context

...

## Assumptions

- ...

## Risks

- ...

Plan:
1. First concrete step
2. Second concrete step
3. Third concrete step

## Validation

- ...

## Approval Required

Please approve this plan before I make implementation edits.
```
