# pi-personas

Pluggable persona presets for [`pi-cockpit`](../pi-cockpit). Each persona injects role-specific context into the system prompt for every turn while it is active. Switching personas (Shift+Tab or `/persona <id>`) swaps that context with no residue — the system prompt is rebuilt every turn from the active persona only, so the previous persona's context is automatically gone.

Conversation history is preserved across switches; only the system-prompt block changes.

## Bundled personas

| id | label | description |
|---|---|---|
| `architect` | Architect | Software architect — design-first, surveys code, articulates trade-offs |
| `qa` | QA | QA engineer — adversarial review, edge cases, error/boundary/concurrency analysis |
| `reviewer` | Reviewer | Code reviewer — diff-focused, naming, dead code, layering, API stability |
| `debugger` | Debugger | Debugger — reproduce-first, isolate-first, hypothesis-driven |

Plus the built-in `default` persona shipped by `pi-cockpit` (no extra context, standard Pi behavior).

## Install

```bash
pi install /Users/aaron/src/pi-packages/packages/pi-cockpit
pi install /Users/aaron/src/pi-packages/packages/pi-personas
```

Or for a single session:

```bash
pi -e /Users/aaron/src/pi-packages/packages/pi-cockpit -e /Users/aaron/src/pi-packages/packages/pi-personas
```

Cycle with **Shift+Tab**, or use `/persona`, `/persona list`, `/persona next`, `/persona <id>`.

## Bundled prompt templates

| command | description |
|---|---|
| `/analyse [focus-area]` | Deep architectural survey of the current repository — tooling, technology, structure, design patterns, purpose, and key flows. Designed for the `architect` persona but available globally. |

> Pi prompt templates are not persona-scoped: `/analyse` is registered globally and can be invoked from any persona. The architect's system prompt references it as the canonical deep-survey command.

## Authoring a custom persona

A persona is a small declarative object. Minimal example:

```ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { Persona } from "pi-cockpit";

const SECURITY_PROMPT = `[PERSONA: SECURITY ENGINEER]

You are operating as a security engineer. Treat every change as a potential
attack surface. Enumerate threat model, trust boundaries, input validation,
authn/authz, secrets handling, and dependency risk before approving changes.`;

const security: Persona = {
  id: "security",
  label: "Security",
  description: "Security engineer — threat-model first, scrutinize trust boundaries",
  order: 50,
  systemPrompt: SECURITY_PROMPT,
};

export default function (pi: ExtensionAPI) {
  const register = () => pi.events.emit("cockpit:persona:register", security);
  pi.on("session_start", register);
  pi.events.on("cockpit:ready", register);
}
```

### Persona contract (from `pi-cockpit`)

```ts
type Persona = {
  id: string;                  // unique kebab-case identifier
  label: string;               // shown in footer / select
  description?: string;        // shown in /persona list
  icon?: string;
  order?: number;              // cycle order (lower first)

  // Appended to the system prompt every turn while this persona is active.
  // Returning empty string skips injection.
  systemPrompt?: string | ((ctx) => string | Promise<string | undefined>);

  // Optional editor border tint while active.
  borderColor?: (theme) => (s: string) => string;

  // Optional tool allowlist; snapshot+restore on enter/exit.
  tools?: string[];

  // Footer hooks.
  getFooterSegments?: (ctx) => string[];
  getStatusText?: (ctx) => string | undefined;

  // Lifecycle hooks (rarely needed for presets).
  onEnter?: (ctx) => void | Promise<void>;
  onExit?: (ctx) => void | Promise<void>;
  onInput?: (event, ctx) => any | Promise<any>;
  beforeAgentStart?: (event, ctx) => any | Promise<any>;
};
```

### Tips

- Register on both `session_start` and `cockpit:ready` so registration works regardless of extension load order and survives `/reload`.
- Keep `systemPrompt` blocks short and concrete. They are appended to whatever Pi has already loaded, so don't restate baseline guidelines.
- `id` is the Shift+Tab cycle key. Pick a stable lowercase value.
- `order` is spaced by 10 in the bundled presets so you can slot custom personas between them.
