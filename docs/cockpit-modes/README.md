# Pi Cockpit Modes Plugin Plan

## Purpose

Turn `pi-cockpit` into the host UI framework for Pi "modes". Cockpit should own the shared TUI chrome — footer, editor title bar, working indicator, mode indicator, and mode switching — while separate packages can plug in new modes that alter Pi behavior.

Initial target modes:

- `edit` — normal Pi editing/agent mode.
- `plan` — interactive planning mode with interviewing, safe exploration, plan drafting, refinement, and optional execution tracking.
- `terminal` — terminal-oriented mode that behaves as much like a normal shell as possible.

Mode cycling should eventually use `Shift+Tab`:

```text
edit -> plan -> terminal -> edit
```

## Design Principles

1. **Cockpit is the host, not every mode implementation**
   - `pi-cockpit` owns UI integration and mode orchestration.
   - Mode packages own mode-specific behavior.

2. **Modes are pluggable**
   - New packages should be able to register modes without importing internal cockpit files.
   - Use Pi's shared extension event bus (`pi.events`) as the plugin boundary.

3. **Separate UI mode from agent behavior mode**
   - Cockpit tracks active mode and renders it.
   - Mode plugins may modify prompts, tools, input handling, widgets, or shell behavior.

4. **Avoid clobbering other extensions**
   - Cockpit already replaces the footer and editor. Mode support should compose with this rather than encouraging every mode package to replace the editor/footer independently.

## Phase Documents

1. [Phase 1: Cockpit Mode Host](phase-1-cockpit-mode-host.md)
2. [Phase 2: Plan Mode](phase-2-plan-mode.md)
   - [Phase 2A: Reusable Plan Skills and Resources](phase-2a-plan-skills.md)
   - [Phase 2B: Cockpit Plan Mode Plugin](phase-2b-cockpit-plan-plugin.md)
3. [Phase 3: Terminal Mode Plugin](phase-3-terminal-mode-plugin.md)
4. [Phase 4: Polish, Docs, and Hardening](phase-4-polish.md)

## Proposed Package Layout

Long-term structure:

```text
packages/
  pi-cockpit/
    extensions/
      pi-cockpit.ts        # main cockpit extension
      cockpit-modes.ts     # mode registry / types / event contract
      cockpit-editor.ts    # optional future split
      cockpit-footer.ts    # optional future split

  pi-plan/
    skills/
      plan-interview/SKILL.md
      plan-draft/SKILL.md
      plan-review/SKILL.md
      plan-execute/SKILL.md
    prompts/
      plan.md
      plan-review.md

  pi-mode-plan/
    extensions/
      plan-mode.ts

  pi-mode-terminal/
    extensions/
      terminal-mode.ts
```

For the first implementation, it is fine to keep the mode host inside `packages/pi-cockpit/extensions/pi-cockpit.ts` and split later when it grows.

## Open Decisions

1. Should terminal handoff return to `edit` or stay in `terminal` after shell exit?
2. Should terminal V1 prioritize literal shell handoff or integrated command mode?
3. Should plan execution switch to `edit`, or should there be a separate `execute` submode?
4. Should cockpit expose mode APIs only through `pi.events`, or also publish TypeScript helper types from the package?
5. Should `Shift+Tab` always be cockpit-owned, or configurable via a cockpit flag?

## Suggested First Step

Start with [Phase 1: Cockpit Mode Host](phase-1-cockpit-mode-host.md). Build the mode host in `pi-cockpit` without implementing plan or terminal behavior yet. Once the host is stable, implement plan and terminal as separate mode packages.
