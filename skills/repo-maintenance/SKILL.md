---
name: repo-maintenance
description: Maintain and evolve this personal pi package repository, including adding extensions, skills, prompt templates, themes, and package metadata. Use when changing the structure or contents of the pi package repo.
---

# Repo Maintenance

This repository is a pi package that bundles personal extensions, skills, prompts, and themes.

## Conventions

- Extensions live in `extensions/` as `.ts` files or directories with `index.ts`.
- Skills live in `skills/<skill-name>/SKILL.md`; the frontmatter `name` must match the directory name.
- Prompt templates live in `prompts/*.md` and become slash commands by filename.
- Themes live in `themes/*.json` and must define every required color token.
- Package discovery is controlled by the `pi` manifest in `package.json`.

## Validation Checklist

After changes:

```bash
git status --short
find extensions skills prompts themes -maxdepth 3 -type f | sort
```

If TypeScript dependencies are added, list pi core packages as peer dependencies and runtime packages in dependencies.
