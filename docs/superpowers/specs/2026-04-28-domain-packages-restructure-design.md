# Domain Package Restructure Design

## Goal

Restructure this repository from one installable Pi package into a container repository with independently installable, domain-based Pi packages. This lets user-level Pi settings install only broadly useful personal packages, while this repository's project-level Pi settings install only repo-specific maintenance tools.

## Package Layout

```text
pi-packages/
  README.md
  package.json
  .pi/settings.json

  packages/
    inventory/
      package.json
      extensions/
        pi-inventory.ts

    themes/
      package.json
      themes/
        custom-dark.json
        nordic.json

    pi-packages-repo-tools/
      package.json
      extensions/
        package-info.ts
      skills/
        package-creator/
          SKILL.md
        repo-maintenance/
          SKILL.md
```

## Root Repository Role

The root repository becomes a container only. Its `package.json` keeps repository metadata but removes the root `pi` manifest so installing the root no longer loads every resource. The README documents that individual packages under `packages/` are the intended install targets.

## Domain Packages

### inventory

Contains Pi inspection/inventory functionality. Initially this includes the `/plugins` command from `pi-inventory.ts`.

### themes

Contains UI themes. Initially this includes `custom-dark.json` and `nordic.json`.

### pi-packages-repo-tools

Contains tools specifically for maintaining this `pi-packages` repository. Initially this includes:

- `/pi-packages-info`
- `repo-maintenance` skill
- `package-creator` skill

The package name explicitly ties these tools to this repository so they are not mistaken for general-purpose repo tooling.

## Pi Settings

The repo-level `.pi/settings.json` should install only the repo-tools package:

```json
{
  "quietStartup": true,
  "packages": ["./packages/pi-packages-repo-tools"]
}
```

User/global Pi settings can independently install optional packages such as:

```bash
pi install /Users/aaron/src/pi-packages/packages/inventory
pi install /Users/aaron/src/pi-packages/packages/themes
```

## Package Manifests

Each subpackage gets its own private `package.json` with a `pi` manifest pointing only at resources inside that package. Extension packages keep Pi core imports in `peerDependencies`.

The root package keeps `private: true`, repository metadata, and may keep peer dependencies for development convenience, but it does not declare Pi resources.

## Validation

After restructuring:

- `find packages -maxdepth 4 -type f | sort` should show all migrated package files.
- Root `package.json` should not contain a `pi` manifest.
- Each `packages/*/package.json` should contain the correct domain-specific `pi` manifest.
- `.pi/settings.json` should reference `./packages/pi-packages-repo-tools`.
