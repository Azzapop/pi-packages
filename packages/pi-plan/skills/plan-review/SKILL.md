---
name: plan-review
description: Review, critique, and refine an existing implementation plan before approval or execution. Use when the user asks to validate a plan or when a plan may be incomplete, risky, or unclear.
---

# Plan Review

Use this skill to critique and refine a plan before implementation. This is a planning-only skill: do not edit source files while reviewing.

## When to Use

- The user asks whether a plan is good, safe, complete, or ready to execute.
- A generated plan needs a second pass before approval.
- The plan has unclear validation, risky sequencing, or broad scope.
- Do not use this skill to execute the plan.

## Review Checklist

Check for:

- missing steps
- risky sequencing
- unclear validation
- over-broad scope
- unnecessary complexity
- hidden dependencies
- likely failure points
- whether steps are independently verifiable
- whether the plan respects user constraints and acceptance criteria
- whether implementation can start from a cleared/new context seeded with the plan

## Safety

- Do not call `edit` or `write` for source files while reviewing.
- Do not begin implementation.
- Read-only investigation is allowed if necessary to assess plan quality.
- If saving a revised plan document, write only to the configured plan-doc destination.

## Output Format

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
3. ...

## Approval Required

Please approve the revised plan before implementation begins.
```
