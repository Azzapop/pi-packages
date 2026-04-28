# Pi Packages

A personal package for pi extensions, skills, prompt templates, and themes.

## Structure

```text
extensions/  TypeScript pi extensions
skills/      Agent Skills (`skills/<name>/SKILL.md`)
prompts/     Prompt templates (`/filename` commands)
themes/      TUI themes (`*.json`)
```

This repo is itself a pi package via the `pi` manifest in `package.json`.

## Install locally

From anywhere, install this package into your global pi settings:

```bash
pi install /path/to/pi-packages
```

Then restart pi or run `/reload` in an existing session.

To use it only for one pi run:

```bash
pi -e /path/to/pi-packages
```

## Included starters

- Extension command: `/pi-packages-info`
- Prompt templates: `/review`, `/finish`
- Skills: `repo-maintenance`, `package-creator`
- Theme: `custom-dark`

Select the theme in `/settings` or add this to `~/.pi/agent/settings.json`:

```json
{
  "theme": "custom-dark"
}
```

## Adding more

### Extension

Add `extensions/my-extension.ts`:

```ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("hello", {
    description: "Say hello",
    handler: async (_args, ctx) => ctx.ui.notify("Hello!", "info"),
  });
}
```

### Prompt template

Add `prompts/name.md`; it becomes `/name`.

### Skill

Add `skills/my-skill/SKILL.md` with frontmatter:

```md
---
name: my-skill
description: What this skill does and when to use it.
---
```

### Theme

Add a complete theme JSON file to `themes/`. Theme names must be unique.

## Notes

- Packages installed from a local path are loaded in place, so edits here are picked up after `/reload`.
- Keep pi core packages in `peerDependencies` if imported by extensions.
- Put normal runtime npm packages in `dependencies`.
