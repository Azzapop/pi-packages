---
name: plan-interview
description: Clarify a requested change before implementation by interviewing the user about goals, scope, constraints, risks, and acceptance criteria. Use when a task is ambiguous, broad, risky, or should be planned before editing.
---

# Plan Interview

Use this skill to clarify the user's intent before drafting or implementing a plan. This is a planning-only skill: do not edit source files while using it.

## When to Use

- The user asks to plan, design, scope, or think through work before implementation.
- The requested change is broad, ambiguous, risky, or spans multiple subsystems.
- You need acceptance criteria, constraints, or scope boundaries before drafting a plan.
- Do not use this skill for trivial one-step edits where the user clearly asked for immediate implementation.

## Workflow

1. Restate the user's request in one or two sentences.
2. Identify missing information that could change the plan.
3. Ask only the highest-value clarifying questions. Avoid long questionnaires unless the user asked for a thorough interview.
4. Capture answers in an interview summary.
5. If important ambiguity remains, list open questions rather than inventing facts.

## Interview Topics

Capture what is relevant:

- desired outcome
- context/background
- constraints
- files/subsystems in scope
- files/subsystems out of scope
- acceptance criteria
- risk tolerance
- expected level of detail
- whether the user wants implementation after planning
- whether a plan document should be saved, and rely on the configured `planPath` if saving is desired

## Safety

- Do not call `edit` or `write` while interviewing.
- Do not modify source files.
- Read-only investigation is allowed if it helps ask better questions.
- Writing a plan document is allowed only when the user/configured workflow calls for plan documentation, and only to the configured plan-doc destination.

## Output Format

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

Risk Tolerance:
...

Implementation Preference:
...

Open Questions:
...
```
