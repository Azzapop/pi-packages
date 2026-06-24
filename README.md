# Pi Packages

A container repository for personal, domain-based Pi packages. Each package under `packages/` is independently installable.

## Structure

```text
packages/
  inventory/                 Pi inventory/resource inspection commands
  themes/                    Personal TUI themes
  pi-cockpit/                Cockpit-style Pi footer/editor UI + persona host
  pi-personas/               Pluggable persona presets (architect, qa, reviewer, debugger)
  pi-plan/                   Reusable planning skills, prompts, and helpers
  pi-packages-repo-tools/    Tools and skills for maintaining this repo
  pi-packages-requests/      /pi-req: file change requests against this repo from anywhere
  pi-feature-flags/          Skill to register new feature flags on the Propeller FFR Jira board
```

The repository root is not itself a Pi package. Install the individual domain packages you want.

## Packages

### inventory

Provides Pi inventory and resource inspection commands.

Included resources:

- Extension command: `/plugins`

Install globally:

```bash
pi install /Users/aaron/src/pi-packages/packages/inventory
```

### themes

Provides personal TUI themes.

Included resources:

- `custom-dark`
- `nordic`

Install globally:

```bash
pi install /Users/aaron/src/pi-packages/packages/themes
```

Select a theme in `/settings` or add one to `~/.pi/agent/settings.json`:

```json
{
  "theme": "custom-dark"
}
```

### pi-cockpit

Provides a cockpit-style Pi TUI skin and the persona host. Personas inject role-specific system-prompt context for every turn while active; switching swaps that context with no residue (history is preserved).

Included resources:

- Extension commands: `/session-title`, `/effort`, `/persona`
- `Shift+Tab` persona cycling; `Ctrl+Shift+E` model effort cycling
- Custom footer with context, provider usage, model/effort, branch, and low-priority session totals
- Custom editor title bar and persona-colored editor border
- Subtle pulse working indicator
- Bundled `pi-usage-bars` extension for provider usage windows
- Built-in `default` persona (no extra context). Install [`pi-personas`](#pi-personas) for the bundled presets.

Install globally:

```bash
cd /Users/aaron/src/pi-packages/packages/pi-cockpit
npm install
pi install /Users/aaron/src/pi-packages/packages/pi-cockpit
```

Try for one session:

```bash
cd /Users/aaron/src/pi-packages/packages/pi-cockpit
npm install
pi -e /Users/aaron/src/pi-packages/packages/pi-cockpit
```

Use Nerd Font icons by default, or switch fallbacks:

```bash
pi -e /Users/aaron/src/pi-packages/packages/pi-cockpit --cockpit-icons unicode
pi -e /Users/aaron/src/pi-packages/packages/pi-cockpit --cockpit-icons none
```

### pi-personas

Pluggable persona presets for `pi-cockpit`. Each persona is a small declarative object whose `systemPrompt` is appended to the system prompt every turn while active.

Bundled presets:

- `architect` — software architect, design-first, surveys code, articulates trade-offs
- `qa` — QA engineer, adversarial review, edge cases, error/boundary/concurrency analysis
- `reviewer` — code reviewer, diff-focused, naming, dead code, layering, API stability
- `debugger` — debugger, reproduce-first, isolate-first, hypothesis-driven

Cycle with **Shift+Tab**, or use `/persona`, `/persona list`, `/persona next`, `/persona <id>`. The active persona is persisted per session.

Install globally:

```bash
pi install /Users/aaron/src/pi-packages/packages/pi-personas
```

See [`packages/pi-personas/README.md`](packages/pi-personas/README.md) for the persona contract and instructions on authoring custom personas.

### pi-plan

Provides reusable planning workflows that work without Cockpit.

Included resources:

- Skills: `plan-interview`, `plan-draft`, `plan-review`, `plan-execute`
- Prompt templates: `/plan`, `/plan-review`
- Extension commands: `/plan-path`, `/plan-todos`, `/plan-clear`, `/plan-save`

Configure plan document storage in Pi settings with `planPath`:

```json
{
  "planPath": "docs/plans"
}
```

Relative paths are repo-local. Absolute or `~` paths can point to shared plan locations. Use `null`, `false`, or `"session"` for session-only plans.

Install globally:

```bash
pi install /Users/aaron/src/pi-packages/packages/pi-plan
```

### pi-packages-repo-tools

Provides tools specifically for maintaining this `pi-packages` repository.

Included resources:

- Extension command: `/pi-packages-info`
- Skills: `repo-maintenance`, `package-creator`
- Persona: `pi-author` — Pi package author, fluent in extension API and repo conventions

This package is installed by the repo-local `.pi/settings.json`. Project package paths are resolved from the `.pi/` directory, so the path uses `../packages/...`:

```json
{
  "quietStartup": true,
  "packages": ["../packages/pi-packages-repo-tools"]
}
```

### pi-packages-requests

File change requests against this repo from any pi session anywhere on your machine. `/pi-req` writes the request to `requests/<id>.md` and dispatches a detached headless `pi -p` run inside the repo to actually make the change on a fresh `req/<id>` branch. The runner survives the parent pi session exiting; you check on it later with `/pi-req list`, `/pi-req log <id>`, or `/pi-req tail <id>`.

Included resources:

- Extension command: `/pi-req` with subcommands `list`, `show`, `log`, `tail`, `done`, `reap`
- Skill: `requests-inbox` for triaging queued requests when you sit down inside the repo
- Dispatch assets: `dispatch/run.mjs` (orchestrator) and `dispatch/execution-preamble.md` (system-prompt addendum for non-interactive runs)

Configure the repo path once in `~/.pi/agent/settings.json` so the command can find the repo from any cwd:

```json
{
  "piPackagesRoot": "/Users/aaron/src/pi-packages"
}
```

If unset, the extension walks up from the current directory looking for `packages/pi-packages-repo-tools` and falls back to `~/src/pi-packages`.

Install globally:

```bash
pi install /Users/aaron/src/pi-packages/packages/pi-packages-requests
```

See [`packages/pi-packages-requests/README.md`](packages/pi-packages-requests/README.md) for the full command reference, on-disk layout, and dispatch lifecycle.

### pi-feature-flags

Registers new feature flags on Propeller's Feature Flag Register Jira board (project `FFR`, board 84) when a new LaunchDarkly flag is needed as part of some work.

Included resources:

- Skill: `new-feature-flag` — creates a `Feature Flag` ticket via the Atlassian MCP server, building the board's standard LaunchDarkly Production/Test description and linking back to the originating work item.

Requires the Atlassian MCP server to be connected in the session.

Install globally:

```bash
pi install /Users/aaron/src/pi-packages/packages/pi-feature-flags
```

See [`packages/pi-feature-flags/README.md`](packages/pi-feature-flags/README.md) for board facts and usage.

## Try without installing

Run Pi with a package for a single session:

```bash
pi -e /Users/aaron/src/pi-packages/packages/inventory
pi -e /Users/aaron/src/pi-packages/packages/themes
pi -e /Users/aaron/src/pi-packages/packages/pi-cockpit
pi -e /Users/aaron/src/pi-packages/packages/pi-personas
pi -e /Users/aaron/src/pi-packages/packages/pi-plan
pi -e /Users/aaron/src/pi-packages/packages/pi-packages-repo-tools
pi -e /Users/aaron/src/pi-packages/packages/pi-packages-requests
pi -e /Users/aaron/src/pi-packages/packages/pi-feature-flags
```

## Adding more

Add new resources to the package for their domain. If a new domain emerges, create a new directory under `packages/<domain>/` with its own `package.json` and `pi` manifest.

### Extension

Add `packages/<domain>/extensions/my-extension.ts` and include `"./extensions"` in that package's `pi.extensions` manifest.

### Prompt template

Add `packages/<domain>/prompts/name.md` and include `"./prompts"` in that package's `pi.prompts` manifest.

### Skill

Add `packages/<domain>/skills/my-skill/SKILL.md` and include `"./skills"` in that package's `pi.skills` manifest.

### Theme

Add `packages/<domain>/themes/name.json` and include `"./themes"` in that package's `pi.themes` manifest.

## Notes

- Packages installed from a local path are loaded in place, so edits are picked up after `/reload`.
- Keep Pi core packages in package-level `peerDependencies` if imported by extensions.
- Put normal runtime npm packages in the package-level `dependencies`.
