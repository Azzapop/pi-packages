# Claude-Style Pi Styling Package Design

## Goal

Create a new Pi package that customizes non-color styling for the Pi TUI with a Claude-inspired dense footer and subtle pulse working indicator. Color styling remains handled by normal Pi themes; this package focuses on exposed TUI extension points.

## Package Shape

```text
packages/claude-style/
  package.json
  extensions/
    claude-style.ts
```

The package exposes one extension through its `pi.extensions` manifest. It does not include a theme file initially.

## User Experience

On each Pi session start, the extension installs:

1. A custom dense footer.
2. A subtle pulse working indicator.
3. Commands for controlling the footer title.

Footer target layout:

```text
<title> │ ctx: 42% ▰▰▰▱▱ │ Claude S 63% ⟳ 2h │ model: claude... │ branch: main
```

The footer should degrade for narrow terminals by shortening labels, truncating long values, and hiding lower-priority sections before exceeding the render width.

## Footer Content

The footer displays, in priority order:

1. **Current title**
   - Manual override if set.
   - Otherwise a conversation-based task title.
   - Initial implementation may use a simple session title string derived from available session/user prompt context if exposed; if not exposed, use a sensible fallback such as `Pi session` until a manual title is set.
2. **Context fullness**
   - Show current context usage as used/max tokens and/or percentage when available from Pi session/model data.
   - If max context is unavailable, show used tokens only.
3. **Session-period usage**
   - Use `pi-usage-bars` as the real-time source for provider usage windows.
   - Show active-provider session-window usage percentage and reset countdown, e.g. `Claude S 63% ⟳ 2h 10m`.
   - Show weekly usage only if there is enough footer width.
   - If `pi-usage-bars` data is not available yet, show a short loading/unavailable state or hide the usage segment on narrow terminals.
4. **Model**
   - Show the active model id, shortened when needed.
5. **Git branch**
   - Show the current branch via footer data when available.
6. **Extension statuses**
   - Include compact status badges only if there is remaining width.

## Commands

### `/style-title <text>`

Sets a manual footer title override for the current session.

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
claude-style extension
├─ session state
│  ├─ manualTitle?: string
│  └─ autoTitle?: string
├─ session_start handler
│  ├─ installFooter(ctx)
│  └─ installWorkingIndicator(ctx)
├─ command registration
│  └─ style-title
└─ formatting helpers
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
  → footer renderer reads live footer/session/model data
  → extension listens for pi-usage-bars usage updates when available
  → renderer builds prioritized segments
  → renderer fits segments to terminal width
  → TUI renders one footer line

/style-title command
  → updates manualTitle
  → notifies user
  → footer re-renders on next TUI refresh
```

## Error Handling and Degradation

- Missing model id: show `model: unknown` or hide model segment if width is tight.
- Missing branch: hide branch segment.
- Missing context max: show used tokens only.
- Missing `pi-usage-bars` data: hide usage on narrow terminals; otherwise show `usage: loading…` or `usage: unavailable`.
- Narrow terminal: preserve title and context first; drop statuses, branch, model, then usage details if required.
- No manual or available auto title: show `Pi session`.

## Testing and Verification

Manual verification:

1. Install or run the package locally with `pi -e ./packages/claude-style`.
2. Start a Pi session and confirm the footer appears.
3. Trigger an assistant response and confirm the pulse indicator appears.
4. Run `/style-title Test title` and confirm the footer title changes.
5. Run `/style-title --clear` and confirm it returns to automatic/fallback title.
6. Resize the terminal and confirm the footer never exceeds width.
7. Confirm session-period usage appears when `pi-usage-bars` data is available.
8. Confirm unavailable `pi-usage-bars` data is omitted or shown as loading/unavailable gracefully.

Code checks:

- TypeScript should type-check under the package's dependency assumptions.
- The package `package.json` should include `pi-package` keyword and a `pi.extensions` entry.
- Pi core imports should be listed as peer dependencies, not bundled dependencies.

## Out of Scope

- Creating a new color theme.
- Replacing the editor component.
- Adding persistent widgets above/below the editor.
- Reimplementing provider-specific usage API clients. The package should rely on `pi-usage-bars` data rather than duplicating its Claude/Codex/Gemini/Z.AI request logic.
