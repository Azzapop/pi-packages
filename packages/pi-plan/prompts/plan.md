---
description: Interview, explore read-only, draft a numbered plan, and ask for approval before implementation.
---

# Plan

Plan the requested work before making implementation edits.

## Workflow

1. If the request is ambiguous, use the `plan-interview` workflow to clarify goals, scope, constraints, and acceptance criteria.
2. Perform read-only exploration if needed. Do not modify source files.
3. Use the `plan-draft` workflow to produce a concrete numbered `Plan:` section.
4. If plan document storage is configured with `planPath`, offer to save the plan document there. If `planPath` is `null`, `false`, or `"session"`, keep the plan in session only.
5. Ask for explicit approval before implementation.

## Constraints

- Do not call `edit` or `write` for source files.
- Do not make implementation changes.
- Do not run mutating shell commands.
- Plan document writes are allowed only to the configured plan-doc destination.
- Implementation requires explicit user approval.

## Required Plan Shape

```md
## Planning Context
...

## Assumptions
...

## Risks
...

Plan:
1. ...
2. ...
3. ...

## Validation
...

## Approval Required
Please approve this plan before I make implementation edits.
```
