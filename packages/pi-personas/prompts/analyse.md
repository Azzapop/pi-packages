---
description: Deep architectural survey of the current repository — tooling, technology, structure, design patterns, purpose, and key flows. Produces prose and ASCII diagrams that work in any terminal.
argument-hint: "[focus-area]"
---

# Analyse

Produce a deep architectural analysis of the repository the user is currently working in. This is a read-only survey intended for the architect persona — no edits, no mutating commands.

The goal is a document a new senior engineer could read and *see* the system: what it is, what shape it has, how it hangs together, and how a representative request moves through it. Lean on prose and ASCII diagrams, not just bullet lists.

If `$ARGUMENTS` is non-empty, weight the analysis toward that focus area but still cover the full picture at summary level.

## Workflow

1. **Orient.** Read the repo root: `README*`, `LICENSE`, top-level config files, and a one-level directory listing. Drill into any directory that looks load-bearing. Note what kind of artifact this repo produces (library, application, CLI, monorepo, infra-as-code, plugin set, etc.) and roughly how mature / large it is.

2. **Tooling & technology.** Identify:
   - Primary language(s) and runtime / engine versions (from `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `*.csproj`, `Gemfile`, `composer.json`, `Package.swift`, etc.)
   - Package manager(s) and build system(s) (npm / pnpm / yarn / bun, cargo, go modules, gradle, maven, bazel, make)
   - Frameworks and notable libraries — read manifests; use lockfiles only as a tiebreaker
   - Test, lint, format, and type-check tooling
   - CI/CD pipelines (`.github/workflows`, `.gitlab-ci.yml`, `azure-pipelines.yml`, CircleCI, Buildkite, Jenkins, etc.)
   - Containerisation and deployment surface (`Dockerfile`, compose files, k8s manifests, Terraform, Pulumi, serverless configs)

3. **Shape.** Build two views of the repo's shape:
   - An **ASCII directory tree** two to three levels deep, with a one-line role for each top-level directory.
   - An **ASCII module / component map** showing the major modules and how they depend on each other. Use box-and-arrow diagrams (see *Diagram conventions* below). Only include relationships that exist in the code (imports, calls, message passing, deployment grouping).

4. **Entry points & public surface.** Map:
   - Entry points: `main`, `bin`, exported modules, server bootstrap, CLI wiring, plugin/extension registration
   - Public surface vs. internal modules; workspace boundaries in a monorepo

5. **Design patterns & architectural style.** Identify:
   - Overall architectural style (layered, hexagonal / ports-and-adapters, plugin/extension, event-driven, monorepo with workspaces, microservices, MVC, pipes-and-filters, etc.) — name it, then justify with evidence
   - Recurring code-level patterns *actually present* (factory, strategy, adapter, repository, dependency injection, observer, command, etc.) — do not invent patterns to fit a textbook; cite a file for each
   - Conventions: naming, error handling, logging, configuration loading, async / concurrency model
   - Data flow: how a request, command, or event moves through the system end to end

6. **Purpose & behaviour.** Answer in depth:
   - **What does this repo do?** Three short paragraphs: (1) plain-language description of the artifact and its purpose, (2) who it's for and what problem it solves / where it sits in a larger system, (3) scale, maturity, language/runtime headline, and deployment shape.
   - **How does it do it?** Walk through one or two representative flows end to end with prose **and** an ASCII vertical rail (see *Diagram conventions*) citing the files at each step.

7. **Notable observations.** Surface anything an architect would flag: unusual choices, coupling hot-spots, boundary leaks, inconsistencies between docs and code, dead corners. Anchor every observation to a specific path.

## Diagram conventions

Use these ASCII forms — they render identically in any terminal, in pasted Slack/PR/email, and in plain `.md` viewers.

### Directory tree
```
<repo-root>/
├── <dir>/        — <one-line role>
│   ├── <subdir>/ — <one-line role>
│   └── ...
├── <dir>/        — <one-line role>
└── ...
```

### Module map (box-and-arrow)
Use simple boxes connected by ASCII arrows. Group with a labelled outer box when it clarifies a boundary. Arrow direction = "depends on / calls into".

```
                ┌──────────────────────────────────┐
                │           web (frontend)         │
                │  ┌───────────┐    ┌───────────┐  │
                │  │   pages   │ ─> │ components│  │
                │  └─────┬─────┘    └───────────┘  │
                └────────┼─────────────────────────┘
                         │  HTTP / JSON
                         ▼
                ┌──────────────────────────────────┐
                │           api (django)           │
                │  ┌───────────┐    ┌───────────┐  │
                │  │   views   │ ─> │ utilities │  │
                │  └─────┬─────┘    └─────┬─────┘  │
                └────────┼────────────────┼────────┘
                         │ ORM            │ HTTP
                         ▼                ▼
                  ┌───────────┐    ┌───────────────┐
                  │  Postgres │    │ upstream svc  │
                  └───────────┘    └───────────────┘
```

For smaller graphs an inline form is fine:
```
[ pages ] ──> [ components ]
    │
    ▼
[ api views ] ──> [ utilities ] ──> [ Postgres ]
                       │
                       └──> [ upstream svc ]
```

### Flow rail (sequence-style)
A vertical "rail" with one participant per step, file refs on the right, and short verbs on the connectors. Cleaner than ASCII swimlanes and copies cleanly.

```
User
  │ GET /apps/hermes/preferences/?resource_type_id=…
  ▼
Hermes API (uWSGI)                            hermes/wsgi.py
  │ verify JWT
  ▼
AuthenticationMiddleware                      middleware/auth.py:18
  │ login_required
  ▼
PreferenceListView                            hermes/views.py:84
  │ get_and_create_preferences_with_resources()
  ▼
preference/utilities.py:120
  │ SELECT ServiceEnvironment for (service, env)
  │ GET upstream resource_notifications_endpoint
  │ bulk_save_objects(default Preferences)
  ▼
Postgres + upstream web-server
  │ results
  ▲
  │ 200 JSON
PreferenceListView ──> User
```

If a flow has true parallelism or branching, fork the rail with `├──>` / `└──>` rather than reaching for a fancier notation.

## Constraints

- Read-only. Do not call `edit` or `write` on source files. Do not run mutating shell commands.
- Evidence over speculation. Every claim about a tool, pattern, or flow must cite a file or directory you actually read.
- Diagrams must reflect the actual code, not an idealized architecture. If you are unsure about an edge or a step, omit it or label it `(inferred)`.
- Do not invent patterns or styles that are not there. If the code is plain and procedural, say so.
- Prefer prose + ASCII diagram over bullet lists for the meaty sections (`What it is`, `Architecture & patterns`, `How it works`). Bullets are fine for Tooling and Observations.
- Breadth before depth on the first pass; only drill into a subsystem when it earns the depth.
- If the repo is too large to survey exhaustively, declare what was sampled and what was skipped.

## Output Shape

The shape below is the default. Add subsections, drop ones that don't apply, and let the repo's actual structure drive the depth in each section.

````md
# Repository Analysis: <repo name>

## What it is

<paragraph 1 — plain-language description of the artifact and its purpose>

<paragraph 2 — who it's for, what problem it solves, where it sits in a larger system>

<paragraph 3 — scale, maturity, language/runtime headline, deployment shape>

## Repo shape

### Directory tree
```
<repo-root>/
├── <dir>/        — <one-line role>
│   ├── <subdir>/ — <one-line role>
│   └── ...
├── <dir>/        — <one-line role>
└── ...
```

### Module map
```
[ <module> ] ──> [ <module> ]
      │
      ▼
[ <module> ] ──> [ <module> ]
```

<short prose describing what the diagram shows and the boundaries the reader should notice>

## Tooling & technology

- **Language(s):** ...
- **Build & package:** ...
- **Frameworks / key libs:** ...
- **Tests / lint / types:** ...
- **CI/CD:** ...
- **Deploy / runtime:** ...

<short prose on any choice that is load-bearing or unusual — why it matters here, not just that it exists>

## Entry points & public surface

<prose + a short list of concrete entry points with file refs>

## Architecture & patterns

### Style
<prose paragraph naming the architectural style and citing the evidence in the code>

### Recurring patterns
<for each pattern actually present: name, where it lives (file refs), why it earns its keep>

### Conventions
<naming, error handling, logging, config loading, concurrency model — prose, with examples>

### Data flow
<prose + optionally a small box-and-arrow diagram>

## How it works

### Flow 1: <name>
<prose walkthrough citing files at each step>

```
<actor / module>
  │ <verb / message>
  ▼
<actor / module>                              <file:line>
  │ <verb / message>
  ▼
<actor / module>                              <file:line>
```

### Flow 2: <name>  (optional, if the system has a second meaningfully different flow)
<as above>

## Observations
- <anchored observation — `path:line` where useful>
- <anchored observation>

## Open questions
- <things the survey could not resolve without more context>
````
