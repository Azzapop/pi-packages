# pi-feature-flags

A Pi package for registering new feature flags on Propeller's **Feature Flag Register** Jira board
(project `FFR`, board 84).

## Included resources

- Skill: `new-feature-flag` — creates a `Feature Flag` ticket on the FFR board (via the Atlassian
  MCP server) whenever a new LaunchDarkly flag is introduced as part of some work. It captures the
  flag key, summary, context, component, and originating work item, builds the board's standard
  LaunchDarkly Production/Test description, and links back to the originating issue.

## Requirements

The skill drives Jira through the **Atlassian MCP server**, so that server must be connected in the
Pi session (`mcp({ server: "atlassian" })`).

Board facts used by the skill:

- `cloudId`: `propelleraero.atlassian.net`
- `projectKey`: `FFR`
- `issueTypeName`: `Feature Flag`

## Install globally

```bash
pi install /Users/aaron/src/pi-packages/packages/pi-feature-flags
```

## Try for one session

```bash
pi -e /Users/aaron/src/pi-packages/packages/pi-feature-flags
```
