# Pi Packages

A container repository for personal, domain-based Pi packages. Each package under `packages/` is independently installable.

## Structure

```text
packages/
  inventory/                 Pi inventory/resource inspection commands
  themes/                    Personal TUI themes
  pi-cockpit/                Cockpit-style Pi footer/editor UI
  pi-plan/                   Reusable planning skills, prompts, and helpers
  pi-mode-plan/              Cockpit plan mode integration
  pi-packages-repo-tools/    Tools and skills for maintaining this repo
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

Provides a cockpit-style Pi TUI skin.

Included resources:

- Extension commands: `/session-title`, `/effort`
- `Shift+Tab` Cockpit mode cycling; `Ctrl+Shift+E` model effort cycling
- Custom footer with context, provider usage, model/effort, branch, and low-priority session totals
- Custom editor title bar and mode-colored editor border
- Subtle pulse working indicator
- Bundled `pi-usage-bars` extension for provider usage windows

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

### pi-mode-plan

Provides Cockpit integration for plan mode.

Included resources:

- Cockpit mode: `plan` via `/mode plan`
- Extension commands: `/plan-approve`, `/plan-cancel`
- Plan-mode tool restrictions that block edits and unsafe shell commands before approval
- Approval flow that starts implementation in a new context seeded with the approved plan

Install globally:

```bash
pi install /Users/aaron/src/pi-packages/packages/pi-mode-plan
```

### pi-packages-repo-tools

Provides tools specifically for maintaining this `pi-packages` repository.

Included resources:

- Extension command: `/pi-packages-info`
- Skills: `repo-maintenance`, `package-creator`

This package is installed by the repo-local `.pi/settings.json`. Project package paths are resolved from the `.pi/` directory, so the path uses `../packages/...`:

```json
{
  "quietStartup": true,
  "packages": ["../packages/pi-packages-repo-tools"]
}
```

## Try without installing

Run Pi with a package for a single session:

```bash
pi -e /Users/aaron/src/pi-packages/packages/inventory
pi -e /Users/aaron/src/pi-packages/packages/themes
pi -e /Users/aaron/src/pi-packages/packages/pi-cockpit
pi -e /Users/aaron/src/pi-packages/packages/pi-plan
pi -e /Users/aaron/src/pi-packages/packages/pi-mode-plan
pi -e /Users/aaron/src/pi-packages/packages/pi-packages-repo-tools
```

## Design Docs

- [Cockpit Modes Plugin Plan](docs/cockpit-modes/README.md) — phased plan for making `pi-cockpit` a pluggable mode host.

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
