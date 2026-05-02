# Pi Cockpit Styling Package Design

## Goal

Create a new Pi package named `pi-cockpit` that customizes non-color styling for the Pi TUI with a dense cockpit-style footer, editor title bar, and subtle pulse working indicator. Color styling remains handled by normal Pi themes; this package focuses on exposed TUI extension points.

## Package Shape

```text
packages/pi-cockpit/
  package.json
  extensions/
    pi-cockpit.ts
```

The package exposes one extension through its `pi.extensions` manifest. It does not include a theme file initially.

## User Experience

On each Pi session start, the extension installs:

1. A custom dense footer.
2. A subtle pulse working indicator.
3. A custom editor skin that preserves normal editor behavior.
4. Commands for controlling the current-change title.

Editor target layout:

```text
╭─ Pi cockpit package ───────────────────────────────────────╮
│ help me make a new package...                             │
╰────────────────────────────────────────────────────────────╯
```

The current-change title lives in the editor top border, not the footer. The title text uses a different color from the border line.

Footer target layout with the default Nerd Font icon style:

```text
󰍛 42% ▰▰▰▱▱ │ 󰔟 Claude S 63% 󰑓 2h │ 󰚩 claude... · high │  main │ ↑196k ↓16k $2.41
```

The footer should degrade for narrow terminals by shortening labels, truncating long values, and hiding lower-priority sections before exceeding the render width.

## Footer Content

The footer displays, in priority order:

The extension supports configurable footer icon styles:

- `nerd` default: uses Nerd Font glyphs for a polished terminal look.
- `unicode`: uses broadly-supported Unicode fallback glyphs.
- `none`: uses text labels only.

Icon mapping:

| Section | Nerd Font | Unicode fallback | None fallback |
|---|---:|---:|---|
| Editor title | none | none | none |
| Context fullness | `󰍛` | `◔` | `ctx` |
| Session-period usage | `󰔟` | `◷` | `usage` |
| Reset countdown | `󰑓` | `↻` | `reset` |
| Model | `󰚩` | `◇` | `model` |
| Git branch | `` | `⎇` | `git` |
| Session totals | none | none | `tokens` |

1. **Context fullness**
   - Show current context usage as used/max tokens and/or percentage when available from Pi session/model data.
   - If max context is unavailable, show used tokens only.
3. **Session-period usage**
   - Use `pi-usage-bars` as the real-time source for provider usage windows and quota utilization.
   - Show active-provider session-window usage percentage and reset countdown, e.g. `Claude S 63% 󰑓 2h 10m`.
   - Show weekly usage only if there is enough footer width.
   - Treat this as provider window/quota utilization, not raw cost. Token-based providers are displayed only when `pi-usage-bars` can normalize their token limits into percentage windows.
   - If the active provider is unmetered, unsupported, has no usage endpoint, or `pi-usage-bars` data is not available yet, hide the usage segment on narrow terminals; otherwise show a short loading/unavailable state.
4. **Model and effort**
   - Show the active model id, shortened when needed.
   - Include the active Pi thinking/effort level next to the model, e.g. `󰚩 sonnet · high`.
   - Color the effort label using the matching theme token: `thinkingOff`, `thinkingMinimal`, `thinkingLow`, `thinkingMedium`, `thinkingHigh`, or `thinkingXhigh`.
5. **Git branch**
   - Show the current branch via footer data when available.
6. **Extension statuses**
   - Include compact status badges only if there is remaining width.
7. **Session token/cost totals**
   - Lowest-priority footer segment.
   - Show cumulative assistant usage totals for the current Pi session when available, e.g. `↑196k ↓16k $2.41`.
   - Input/output totals come from assistant message `usage.input` and `usage.output`; cost comes from `usage.cost.total`.
   - Hide this segment first when terminal width is constrained.

## Editor Skin

The package replaces the default editor with a `CustomEditor` subclass so Pi's normal text editing behavior and keybindings continue to work. The custom editor only changes rendering.

Editor requirements:

- Put the current-change title in the top border.
- Color the title differently from the border line.
- Change the editor border/input-line color based on input mode.
- Preserve Pi's default editor behavior for typing, submission, escape, Ctrl+D, model switching, thinking-level cycling, and other app keybindings.

Initial mode color rules:

| Mode | Detection | Color token |
|---|---|---|
| Normal prompt | Default state | `border` / current thinking border behavior |
| Shell command | Input starts with `!` | `bashMode` |
| Plan mode | Reserved for future extension hook/status | configurable; no active detection initially |

Plan mode should be designed as an extensibility point rather than heuristic text detection. A future plan-mode extension should be able to expose mode state that this package can read or receive through an event/status convention.

## Commands

### `/style-title <text>`

Sets a manual editor title override for the current session.

### `/style-title --clear`

Clears the manual title override and returns to the automatic conversation-based title/fallback.

## Working Indicator

Use a subtle pulse animation:

```text
·  •  ●  •
```

Frames should be themed with dim/muted/accent colors and a moderate interval, approximately 120ms. The indicator should be installed on session start and rely on Pi's `ctx.ui.setWorkingIndicator()` extension point.

## Architecture

```text
pi-cockpit extension
├─ session state
│  ├─ manualTitle?: string
│  └─ autoTitle?: string
├─ session_start handler
│  ├─ installFooter(ctx)
│  ├─ installWorkingIndicator(ctx)
│  └─ installEditorSkin(ctx)
├─ event handlers
│  ├─ model_select
│  └─ thinking_level_select
├─ command registration
│  └─ style-title
└─ formatting helpers
   ├─ getIcons(iconStyle)
   ├─ buildFooterSegments(...)
   ├─ fitSegmentsToWidth(...)
   ├─ formatTokens(...)
   ├─ formatUsagePeriod(...)
   ├─ formatPercentBar(...)
   └─ shortenModel(...)
```

The implementation should keep formatting helpers small and local to the extension file unless the file grows large enough to justify splitting.

## Data Flow

```text
Pi session_start
  → extension captures ctx
  → footer renderer reads live footer/session/model/effort data
  → extension listens for pi-usage-bars usage updates when available
  → editor renderer reads current-change title and input mode
  → footer renderer builds prioritized segments
  → footer renderer fits segments to terminal width
  → TUI renders footer and editor skin

/style-title command
  → updates manualTitle
  → notifies user
  → editor re-renders on next TUI refresh
```

## Error Handling and Degradation

- Missing model id: show `model: unknown` or hide model segment if width is tight.
- Missing effort/thinking level: omit effort label or show `normal` only if helpful.
- Missing branch: hide branch segment.
- Missing context max: show used tokens only.
- Missing `pi-usage-bars` data, unsupported provider, or unmetered provider: hide usage on narrow terminals; otherwise show `usage: loading…` or `usage: unavailable`.
- Narrow terminal: preserve context first; drop session token/cost totals, statuses, branch, model, then usage details if required.
- Unsupported Nerd Font glyphs: user can switch `iconStyle` to `unicode` or `none`.
- No manual or available auto title: show `Pi session` in the editor top border.
- Custom editor incompatibility: restore default editor on session shutdown/reload.

## Testing and Verification

Manual verification:

1. Install or run the package locally with `pi -e ./packages/pi-cockpit`.
2. Start a Pi session and confirm the footer appears.
3. Confirm the editor top border shows the current-change title.
4. Trigger an assistant response and confirm the pulse indicator appears.
5. Run `/style-title Test title` and confirm the editor title changes.
6. Run `/style-title --clear` and confirm it returns to automatic/fallback title.
7. Resize the terminal and confirm the footer/editor lines never exceed width.
8. Confirm session-period usage appears when `pi-usage-bars` data is available.
9. Confirm unavailable, unsupported, or unmetered usage data is omitted or shown as loading/unavailable gracefully.
10. Confirm effort level changes update color and label.
11. Confirm shell-command input (`!`) uses the bash-mode color.
12. Confirm session token/cost totals appear only when there is enough footer width.

Code checks:

- TypeScript should type-check under the package's dependency assumptions.
- `iconStyle` should support `nerd`, `unicode`, and `none` without changing footer layout logic.
- The package `package.json` should include `pi-package` keyword and a `pi.extensions` entry.
- Pi core imports should be listed as peer dependencies, not bundled dependencies.

## Out of Scope

- Creating a new color theme.
- Adding persistent widgets above/below the editor.
- Reimplementing provider-specific usage API clients. The package should rely on `pi-usage-bars` data rather than duplicating its Claude/Codex/Gemini/Z.AI request logic.
