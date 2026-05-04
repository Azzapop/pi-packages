---
name: package-creator
description: Create or add new domain package contents in this repository, including extensions, skills, prompt templates, themes, and related package metadata. Use when asked to scaffold or add a package, command, skill, prompt, or theme.
---

# Package Creator

Interactive wizard for creating Pi package components. Guide the user through a structured flow, inferring what you can from context and only asking questions when genuinely ambiguous.

## Wizard Flow

### Phase 1: Understand Intent

Determine what the user wants to create. If their request is clear, skip straight to Phase 2.

Component types:
- **Package** — A new domain package (top-level container)
- **Extension** — TypeScript code that hooks into the Pi agent runtime (commands, event handlers, UI interactions)
- **Skill** — A markdown-based agent skill (workflow instructions for the AI)
- **Prompt** — A slash-command prompt template
- **Theme** — A color theme JSON file

If ambiguous, ask ONE clarifying question. Do not present a menu of all options unless the user says something generic like "create something new".

### Phase 2: Gather Details

For each component type, gather the minimum required information:

**Package**: name, short description, which component types it will contain
**Extension**: target package, command/feature name, what it should do
**Skill**: target package, skill name, when/how it should trigger
**Prompt**: target package, command name, what instructions it provides
**Theme**: target package, theme name, base theme to derive from

Infer the target package from context when possible (e.g. if the user is discussing a specific package, or if only one package makes sense). Only ask if multiple packages could reasonably be the target.

### Phase 3: Discover Existing Packages

Before generating files, scan the repo to:

1. List existing packages: `find packages -maxdepth 1 -type d | sort`
2. Check for naming conflicts with the proposed component
3. Look at similar existing components for style consistency
4. Identify if the component should live in an existing package rather than a new one

If a conflict or better home is found, suggest it to the user before proceeding.

### Phase 4: Generate Files

Create files using the templates below. Adapt templates to the specific use case — don't just fill in blanks mechanically. Add realistic, useful starter code that demonstrates the component's intended behavior.

### Phase 5: Validate

Run the validation checklist (see below). Fix any issues before presenting results.

### Phase 6: Summarize

Report:
- Files created or modified (with paths)
- New commands/skills/prompts/themes now available
- Any reload step needed (usually `/reload` or restart Pi)

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

- Prefer lowercase kebab-case: `my-command`, `my-skill`, `my-theme`
- Use short domain directory names, except explicit repo-specific packages like `pi-packages-repo-tools`
- Skill frontmatter `name` must match its directory name
- Prompt filenames become slash commands: `prompts/plan.md` -> `/plan`
- Extension command names should be clear, descriptive, and avoid collisions with existing commands

## Templates

### New Domain Package

`packages/<domain>/package.json`:

```json
{
  "name": "pi-<domain>",
  "version": "0.1.0",
  "private": true,
  "description": "<short description of what this package provides>",
  "keywords": ["pi-package"],
  "license": "UNLICENSED",
  "type": "module",
  "pi": {
    // Only include the keys this package actually uses:
    // "extensions": ["./extensions"],
    // "skills": ["./skills"],
    // "prompts": ["./prompts"],
    // "themes": ["./themes"]
  }
}
```

Guidelines:
- Only add manifest keys (`extensions`, `skills`, `prompts`, `themes`) for component types the package actually contains
- Start with `version: "0.1.0"` for new packages
- The `"keywords": ["pi-package"]` entry is required for package discovery

### Extension

`packages/<domain>/extensions/<name>.ts`:

```ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // Register a command that users can invoke
  pi.registerCommand("<command-name>", {
    description: "<what this command does>",
    args: [
      // Optional: define arguments
      // { name: "target", description: "Target to operate on", required: false }
    ],
    handler: async (args, ctx) => {
      // Access arguments
      // const target = args.target ?? "default";

      // Show user feedback
      ctx.ui.notify("Command executed", "info");

      // Return a result to the agent context
      return { success: true };
    },
  });

  // Optional: Register event handlers
  // pi.on("file:saved", async (event) => {
  //   // React to file save events
  // });

  // Optional: Register a status bar item
  // pi.ui.statusBar.add({
  //   id: "<domain>-status",
  //   text: "Status Text",
  //   tooltip: "Tooltip on hover",
  //   priority: 50,
  // });
}
```

For multi-file extensions, use a directory structure:

```
extensions/<name>/
  index.ts      — entry point with registerCommand/event handlers
  utils.ts      — helper functions
  types.ts      — shared type definitions
```

Dependency guidelines:
- `peerDependencies`: Pi core packages (`@mariozechner/pi-coding-agent`)
- `dependencies`: Normal npm runtime libraries your extension needs
- `devDependencies`: Build tools, type packages, test frameworks

Ensure the package manifest includes `"extensions": ["./extensions"]`.

### Skill

`packages/<domain>/skills/<skill-name>/SKILL.md`:

```md
---
name: <skill-name>
description: <Clear description of what this skill does and when it should be triggered. Be specific about trigger conditions.>
---

# <Human-Readable Title>

<Brief overview of the skill's purpose — one or two sentences.>

## When to Use

- <Specific trigger condition 1>
- <Specific trigger condition 2>
- <When NOT to use this skill>

## Workflow

1. <First step — what to gather or check>
2. <Second step — core action>
3. <Third step — validation or follow-up>

## Guidelines

- <Key principle or constraint>
- <Another guideline>
- <Error handling approach>

## Validation

- <How to verify the skill completed successfully>
- <What to check before reporting done>

## Output Format

<What the skill should report back to the user when complete.>
```

Ensure the package manifest includes `"skills": ["./skills"]`.

### Prompt Template

`packages/<domain>/prompts/<command-name>.md`:

```md
---
description: <Short description shown in command palette / autocomplete>
---

# <Command Title>

<Instructions the agent should follow when this slash command is invoked.>

## Context

<What information to gather before acting.>

## Steps

1. <First action>
2. <Second action>

## Constraints

- <Important limitation or rule>
- <Style or safety constraint>
```

Ensure the package manifest includes `"prompts": ["./prompts"]`.

### Theme

Create `packages/<domain>/themes/<theme-name>.json` by:

1. Reading an existing theme file to understand the required token structure
2. Copying all required color tokens (do not omit any)
3. Adjusting color values to match the desired aesthetic

Ensure the package manifest includes `"themes": ["./themes"]`.

## Validation Checklist

After creating or changing package contents, verify:

1. **JSON validity**: All package.json files parse cleanly
   ```bash
   find packages -name package.json -print0 | xargs -0 -n1 python3 -m json.tool >/dev/null
   ```

2. **File structure**: Created files are in the expected locations
   ```bash
   find packages/<domain> -type f | sort
   ```

3. **Manifest consistency**: The `pi` object in package.json references the correct directories for all component types present

4. **Naming consistency**: Directory names match frontmatter `name` fields (skills), filenames match intended command names (prompts)

5. **Import validity** (extensions only): The default export function signature matches `(pi: ExtensionAPI) => void`, and any imports reference installed or peer dependencies

6. **No duplicates**: The new component doesn't duplicate functionality already provided by another package in the repo

## Decision Logic

Use this to decide when to ask vs. infer:

- **User says "add a command to do X"** -> Infer: it's an extension. Ask only which package if ambiguous.
- **User says "create a skill for Y"** -> Infer: it's a skill. Determine package from context.
- **User says "new package"** -> Ask: what domain/purpose, what components it will contain.
- **User says "add a prompt"** -> Infer: it's a prompt template. Ask for the command name and behavior.
- **User gives a vague request** -> Ask ONE question to disambiguate, don't present the full menu.
- **User provides a detailed spec** -> Skip all questions, generate directly, validate, report.
