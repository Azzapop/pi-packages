---
name: package-creator
description: Create or add new domain package contents in this repository, including extensions, skills, prompt templates, themes, and related package metadata. Use when asked to scaffold or add a package, command, skill, prompt, or theme.
---

# Package Creator

Use this skill when adding new Pi package contents to this repo.

## First Steps

1. Clarify what the user wants to create:
   - New domain package
   - Extension command/tool or UI integration
   - Skill
   - Prompt template (slash command)
   - Theme
   - Package metadata/dependencies
2. Identify the target domain package under `packages/<domain>/`, or create a new one if the resource does not fit an existing domain.
3. Inspect existing files before editing:
   ```bash
   find packages -maxdepth 4 -type f | sort
   read package.json
   ```
4. Reuse existing naming and style.

## Repository Layout

- Domain packages: `packages/<domain>/`
- Package manifests: `packages/<domain>/package.json`
- Extensions: `packages/<domain>/extensions/<name>.ts` or `packages/<domain>/extensions/<name>/index.ts`
- Skills: `packages/<domain>/skills/<skill-name>/SKILL.md`
- Prompts: `packages/<domain>/prompts/<command-name>.md`
- Themes: `packages/<domain>/themes/<theme-name>.json`
- Repo-specific tools: `packages/pi-packages-repo-tools/`

The root `package.json` is container metadata only and should not have a `pi` manifest.

## Naming Rules

- Prefer lowercase kebab-case names: `my-command`, `my-skill`, `my-theme`.
- Use short domain directory names, except explicit repo-specific packages such as `pi-packages-repo-tools`.
- Skill frontmatter `name` must match its directory name.
- Prompt filenames become slash commands, e.g. `prompts/plan.md` becomes `/plan`.
- Extension command names should be clear and avoid collisions.

## Scaffolds

### New Domain Package

Create `packages/<domain>/package.json`:

```json
{
  "name": "pi-<domain>",
  "version": "0.1.0",
  "private": true,
  "description": "<short description>",
  "keywords": ["pi-package"],
  "license": "UNLICENSED",
  "type": "module",
  "pi": {}
}
```

Add only the manifest keys needed by the package, such as `extensions`, `skills`, `prompts`, or `themes`.

### Skill

Create `packages/<domain>/skills/<skill-name>/SKILL.md`:

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

Ensure `packages/<domain>/package.json` includes:

```json
"pi": {
  "skills": ["./skills"]
}
```

### Prompt Template

Create `packages/<domain>/prompts/<command-name>.md`:

```md
# <Command Title>

<Instructions the agent should follow when `/command-name` is used.>
```

Ensure the package manifest includes `"prompts": ["./prompts"]`.

### Extension Command

Create `packages/<domain>/extensions/<command-name>.ts`:

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

Ensure the package manifest includes `"extensions": ["./extensions"]`.

If adding runtime imports, update `packages/<domain>/package.json`:

- Pi core packages stay in `peerDependencies`
- Normal npm runtime libraries go in `dependencies`

### Theme

Create `packages/<domain>/themes/<theme-name>.json` by copying an existing complete theme and changing values. Keep all required color tokens present.

Ensure the package manifest includes `"themes": ["./themes"]`.

## Validation Checklist

After creating or changing package contents, run:

```bash
git status --short
find packages -maxdepth 4 -type f | sort
python3 -m json.tool package.json >/dev/null
find packages -name package.json -print0 | xargs -0 -n1 python3 -m json.tool >/dev/null
```

For TypeScript extensions, also run any available typecheck/test script if present. If no script exists, inspect imports and exported default manually.

## Response Format

Summarize:

- Files created or changed
- New commands/skills/prompts/themes available
- Any reload/install step needed, usually `/reload` or restart Pi
