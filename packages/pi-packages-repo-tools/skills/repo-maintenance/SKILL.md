---
name: repo-maintenance
description: Maintain and evolve this personal domain-based pi package repository, including adding or moving extensions, skills, prompt templates, themes, and package metadata. Use when changing the structure or contents of the pi-packages repo.
---

# Repo Maintenance

This repository is a container for independently installable, domain-based Pi packages under `packages/`.

## Conventions

- Root `package.json` is container metadata only and should not declare a `pi` manifest.
- Each domain package lives in `packages/<domain>/` and has its own `package.json` with a `pi` manifest.
- Extensions live in `packages/<domain>/extensions/` as `.ts` files or directories with `index.ts`.
- Skills live in `packages/<domain>/skills/<skill-name>/SKILL.md`; the frontmatter `name` must match the directory name.
- Prompt templates live in `packages/<domain>/prompts/*.md` and become slash commands by filename.
- Themes live in `packages/<domain>/themes/*.json` and must define every required color token.
- Repo-specific maintenance tools belong in `packages/pi-packages-repo-tools/`.
- User-optional packages, such as inventory and themes, should stay independently installable.

## Validation Checklist

After changes:

```bash
git status --short
find packages -maxdepth 4 -type f | sort
```

Check package manifests:

```bash
python3 -m json.tool package.json >/dev/null
python3 -m json.tool .pi/settings.json >/dev/null
find packages -name package.json -print0 | xargs -0 -n1 python3 -m json.tool >/dev/null
```

If TypeScript dependencies are added, list Pi core packages as package-level peer dependencies and runtime packages in package-level dependencies.
