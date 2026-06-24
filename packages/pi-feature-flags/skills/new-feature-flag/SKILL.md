---
name: new-feature-flag
description: Create a new Feature Flag ticket on the Propeller FFR Jira board (project FFR, board 84) when a new feature flag is needed as part of some work. Use when the user is implementing work that needs to be gated behind a LaunchDarkly flag and wants the flag tracked in Jira.
---

# New Feature Flag

Raise a tracking ticket on the **Feature Flag Register** board (Jira project `FFR`, board 84 at
`https://propelleraero.atlassian.net/jira/software/c/projects/FFR/boards/84`) whenever a new
LaunchDarkly feature flag is introduced as part of some work.

Every flag the team ships gets one `Feature Flag` issue on this board so the flag has an owner, a
home for its LaunchDarkly links, and a lifecycle (development → staging → rolling out → cleanup).
This skill captures the flag's details and creates that issue via the Atlassian MCP tools.

## When to Use

- You (or the user) are adding a new LaunchDarkly flag while implementing a feature, fix, or spike,
  and the flag does not yet have an `FFR-*` tracking ticket.
- The user explicitly asks to "register a feature flag", "make a feature flag ticket", or "add a
  flag to the FFR board".

Do **not** use this skill when:

- The flag already has an `FFR-*` ticket — update the existing one instead (search first).
- The work only toggles or cleans up an existing flag (that belongs on the existing ticket).
- No actual LaunchDarkly flag is being introduced.

## Prerequisites

- The Atlassian MCP server must be connected (`mcp({ server: "atlassian" })`). All Jira calls go
  through its tools.
- Board facts (stable — reuse them rather than rediscovering):
  - `cloudId`: `propelleraero.atlassian.net` (site URL is accepted; resolves to
    `c3da8b1d-d3ec-4dfd-819e-a0a1faa44b6a`)
  - `projectKey`: `FFR`
  - `issueTypeName`: `Feature Flag` (the only issue type in this project)

## Information to Gather

Infer as much as possible from the work in progress; only ask the user when a value is genuinely
ambiguous.

1. **Flag key** — the LaunchDarkly key, lowercase kebab-case, usually area-prefixed
   (e.g. `vis-jetbridge`, `processing-3p-vfi-essential`, `settings-frontend-demo-projects-on-sites-access`).
   This drives the LaunchDarkly links.
2. **Summary** — a short human-readable title. Many tickets just use the flag key as the summary;
   a descriptive sentence ("Keep bulk selection on workspace tab") is also fine.
3. **What the flag gates** — one or two sentences of context for the description (optional but
   preferred).
4. **Originating work item** — the Jira key of the story/bug/spike this flag supports
   (e.g. `MOB-336`, `BUG-5683`, `VN-13773`), if there is one.
5. **Component** — the FFR component the flag belongs to (e.g. `visualiser`, `handheld-scanning`,
   `drone-management`, `3P`, `site-settings-frontend`). Default to the originating issue's component
   when known.

## Workflow

1. **Check for duplicates.** Search before creating so you never double-register a flag:

   ```
   mcp({ server: "atlassian", tool: "searchJiraIssuesUsingJql", args: '{
     "cloudId": "propelleraero.atlassian.net",
     "jql": "project = FFR AND (summary ~ \"<flag-key>\" OR description ~ \"<flag-key>\") ORDER BY created DESC",
     "maxResults": 10
   }' })
   ```

   If a matching `FFR-*` issue already exists, stop and surface it instead of creating a new one.

2. **Build the description** using the board's standard template (Markdown). Replace
   `<flag-key>` and keep both LaunchDarkly links — `production` for Production and `test` for
   Local/Dev/Staging:

   ```
   <one or two sentences describing what the flag gates>

   Feature flag for <originating-issue-key>.

   LaunchDarkly configuration can be found here:
   [Production](https://app.launchdarkly.com/default/production/features/<flag-key>/targeting)
   [Local, Dev, Staging](https://app.launchdarkly.com/default/test/features/<flag-key>/targeting)
   ```

   Drop the "Feature flag for ..." line if there is no originating issue. The context sentence is
   optional but recommended.

3. **Create the issue:**

   ```
   mcp({ server: "atlassian", tool: "createJiraIssue", args: '{
     "cloudId": "propelleraero.atlassian.net",
     "projectKey": "FFR",
     "issueTypeName": "Feature Flag",
     "summary": "<summary>",
     "description": "<description from step 2>",
     "additional_fields": { "components": [{ "name": "<component>" }] }
   }' })
   ```

   Omit `components` from `additional_fields` if no component is known rather than guessing.

4. **Link to the originating work item** (when there is one) so the flag is traceable both ways:

   ```
   mcp({ server: "atlassian", tool: "createIssueLink", args: '{
     "cloudId": "propelleraero.atlassian.net",
     "inwardIssue": "<new FFR key>",
     "outwardIssue": "<originating-issue-key>",
     "type": "Relates"
   }' })
   ```

   Skip this step if it fails or there is no originating issue — it is a nice-to-have, not a blocker.

## Guidelines

- New `Feature Flag` issues open in **In Development** by default; do not transition them — the team
  walks them through In Staging → Rolling out → Closed as the flag matures.
- Keep the LaunchDarkly links exact: environment `production` for prod and `test` for
  Local/Dev/Staging, with `/targeting` suffix. The flag key in both URLs must match the real
  LaunchDarkly key.
- One flag = one ticket. Re-running this skill for the same flag should be prevented by the
  duplicate check in step 1.
- If the Atlassian MCP server is not connected or the create call is rejected (auth, unknown
  component, etc.), report the exact error and the values you tried — do not silently retry in a loop.

## Validation

- The create call returns a new `FFR-<n>` key. Confirm the issue type is `Feature Flag` and the
  status is `In Development`.
- Open `https://propelleraero.atlassian.net/browse/FFR-<n>` and confirm the LaunchDarkly links and
  component look right (or re-read with `getJiraIssue`).

## Output Format

Report back:

- The new ticket: `FFR-<n>` with its URL (`https://propelleraero.atlassian.net/browse/FFR-<n>`).
- The flag key and the two LaunchDarkly links used.
- The component set (or a note that none was set) and any link created to the originating issue.
- If creation was skipped because a duplicate exists, the existing `FFR-*` key and URL instead.
