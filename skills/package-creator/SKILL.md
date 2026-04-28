---
name: package-creator
description: Create or add new pi package contents in this repository, including extensions, skills, prompt templates, themes, and related package metadata. Use when asked to scaffold or add a new package, command, skill, prompt, or theme.
---

# Package Creator

Use this skill when adding new pi package contents to this repo.

## First Steps

1. Clarify what the user wants to create:
   - Extension command/tool or UI integration
   - Skill
   - Prompt template (slash command)
   - Theme
   - Package metadata/dependencies
2. Inspect existing files before editing:
   ```bash
   find extensions skills prompts themes -maxdepth 3 -type f | sort
   read package.json
   ```
3. Reuse existing naming and style.

## Repository Layout

- Extensions: `extensions/<name>.ts` or `extensions/<name>/index.ts`
- Skills: `skills/<skill-name>/SKILL.md`
- Prompts: `prompts/<command-name>.md`
- Themes: `themes/<theme-name>.json`
- Package discovery: `package.json` `pi` manifest

## Naming Rules

- Prefer lowercase kebab-case names: `my-command`, `my-skill`, `my-theme`.
- Skill frontmatter `name` must match its directory name.
- Prompt filenames become slash commands, e.g. `prompts/plan.md` becomes `/plan`.
- Extension command names should be clear and avoid collisions.

## Scaffolds

### Skill

Create `skills/<skill-name>/SKILL.md`:

```md
---
name: <skill-name>
description: <what this skill does and when to use it>
---

# <Human Title>

## Workflow

1. ...
2. ...

## Validation

- ...
```

### Prompt Template

Create `prompts/<command-name>.md`:

```md
# <Command Title>

<Instructions the agent should follow when `/command-name` is used.>
```

### Extension Command

Create `extensions/<command-name>.ts`:

```ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("<command-name>", {
    description: "<short description>",
    handler: async (_args, ctx) => {
      ctx.ui.notify("<message>", "info");
    },
  });
}
```

If adding runtime imports, update `package.json`:

- pi core packages stay in `peerDependencies`
- normal npm runtime libraries go in `dependencies`

### Theme

Create `themes/<theme-name>.json` by copying an existing complete theme and changing values. Keep all required color tokens present.

## Validation Checklist

After creating or changing package contents, run:

```bash
git status --short
find extensions skills prompts themes -maxdepth 3 -type f | sort
```

For TypeScript extensions, also run any available typecheck/test script if present. If no script exists, inspect imports and exported default manually.

## Response Format

Summarize:

- Files created or changed
- New commands/skills/prompts/themes available
- Any reload/install step needed, usually `/reload` or restart pi
