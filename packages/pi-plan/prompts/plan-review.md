---
description: Review and refine an existing plan before approval or execution.
---

# Plan Review

Review the existing plan before implementation.

## Workflow

1. Identify the plan to review from the conversation or provided text.
2. Use the `plan-review` workflow to check completeness, sequencing, validation, risks, and scope.
3. Produce recommended changes and, if needed, a revised numbered plan.
4. Ask for explicit approval before implementation.

## Constraints

- Do not call `edit` or `write` for source files.
- Do not begin implementation.
- Use read-only investigation only if necessary to evaluate the plan.
- If saving a revised plan document, write only to the configured `planPath` destination.

## Output Shape

```md
## Plan Review

Strengths:
- ...

Concerns:
- ...

Recommended Changes:
- ...

Revised Plan:
1. ...
2. ...

## Approval Required
Please approve the revised plan before implementation begins.
```
