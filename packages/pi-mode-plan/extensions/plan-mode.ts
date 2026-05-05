import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

// ── Cockpit mode type (matches pi-cockpit's registration shape) ──

type CockpitMode = {
  id: string;
  label: string;
  description?: string;
  order?: number;
  onEnter?: (ctx: ExtensionContext) => void | Promise<void>;
  onExit?: (ctx: ExtensionContext) => void | Promise<void>;
  getFooterSegments?: (ctx: ExtensionContext) => string[];
  getStatusText?: (ctx: ExtensionContext) => string | undefined;
};

// ── Minimal local state (cockpit-specific concerns only) ──

type PlanModeState = {
  active: boolean;
  previousTools?: string[];
  todos: { step: number; text: string; completed?: boolean }[];
  executionMode: boolean;
};

// ── Plan path resolution (needed for tool-call gating) ──

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function findProjectRoot(cwd: string): { root: string; settingsPath: string } {
  let current = resolve(cwd);
  while (true) {
    const settingsPath = join(current, ".pi", "settings.json");
    if (existsSync(settingsPath)) return { root: current, settingsPath };
    const parent = dirname(current);
    if (parent === current) return { root: resolve(cwd), settingsPath: join(resolve(cwd), ".pi", "settings.json") };
    current = parent;
  }
}

async function resolvePlanPath(ctx: ExtensionContext): Promise<string | undefined> {
  const project = findProjectRoot(ctx.cwd);
  const projectSettings = await readJson(project.settingsPath);
  const globalSettings = await readJson(join(homedir(), ".pi", "agent", "settings.json"));
  const raw = projectSettings?.planPath !== undefined ? projectSettings.planPath : globalSettings?.planPath;
  if (raw === undefined || raw === null || raw === false || raw === "session") return undefined;
  if (typeof raw !== "string" || raw.trim().length === 0) return undefined;
  const expanded = expandHome(raw.trim());
  return isAbsolute(expanded) ? expanded : resolve(project.root, expanded);
}

async function isAllowedPlanDocPath(path: unknown, ctx: ExtensionContext): Promise<boolean> {
  if (typeof path !== "string") return false;
  const planPath = await resolvePlanPath(ctx);
  if (!planPath) return false;
  const normalizedInput = path.replace(/^@/, "");
  if (!/\.(md|mdx|txt)$/i.test(normalizedInput)) return false;
  const absoluteInput = resolve(ctx.cwd, expandHome(normalizedInput));
  const absolutePlanPath = resolve(planPath);
  return absoluteInput === absolutePlanPath || absoluteInput.startsWith(`${absolutePlanPath}/`);
}

// ── Bash safety ──

const MUTATING_TOOLS = new Set(["edit", "write"]);

const SAFE_BASH_COMMANDS = new Set([
  "awk", "basename", "cat", "date", "dirname", "du", "echo", "env",
  "fd", "find", "git", "grep", "head", "jq", "ls", "npm", "pnpm",
  "pwd", "rg", "sort", "tail", "tree", "uname", "uniq", "wc", "whoami", "yarn",
]);

const SAFE_GIT_SUBCOMMANDS = new Set(["branch", "diff", "log", "show", "status"]);
const SAFE_NPM_SUBCOMMANDS = new Set(["info", "list", "ls", "outdated", "view", "why"]);

function stripShellSyntax(command: string): string {
  return command
    .replace(/^\s*(?:command|builtin|noglob|time)\s+/, "")
    .replace(/^\s*env\s+(?:[A-Za-z_][A-Za-z0-9_]*=(?:\S+)\s+)*/, "")
    .trim();
}

function isSafeReadOnlyCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return true;
  if (/[;&|`$<>]/.test(trimmed)) return false;
  if (trimmed.includes("\n")) return false;

  const parts = stripShellSyntax(trimmed).split(/\s+/).filter(Boolean);
  const executable = parts[0]?.split("/").pop()?.toLowerCase();
  if (!executable || !SAFE_BASH_COMMANDS.has(executable)) return false;

  if (executable === "git") {
    const subcommand = parts.find((part, index) => index > 0 && !part.startsWith("-"))?.toLowerCase();
    return !!subcommand && SAFE_GIT_SUBCOMMANDS.has(subcommand);
  }

  if (executable === "npm" || executable === "pnpm" || executable === "yarn") {
    const subcommand = parts.find((part, index) => index > 0 && !part.startsWith("-"))?.toLowerCase();
    return !!subcommand && SAFE_NPM_SUBCOMMANDS.has(subcommand);
  }

  return true;
}

// ── Auto-enter detection ──

const PLAN_TRIGGER_PATTERNS = [
  /\b(make|create|draft|write|build|start)\s+(me\s+)?(a\s+)?plan\b/i,
  /\bplan\s+(this|it|out|first|before|the work|an implementation|implementation)\b/i,
  /\bhelp\s+me\s+plan\b/i,
  /\blet'?s\s+plan\b/i,
  /\bimplementation\s+plan\b/i,
  /\bplan(?:ning)?\s+mode\b/i,
  /\bplan\s+workflow\b/i,
  /\bbefore\s+(editing|implementing|coding|changing)\b/i,
  /\bplan\b.*\bapproval?\b/i,
  /\bapproval?\b.*\bplan\b/i,
];

function shouldAutoEnterPlanMode(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith("!")) return false;
  if (/^\/plan(?:\s|$)/.test(trimmed)) return true;
  if (trimmed.startsWith("/")) return false;
  return PLAN_TRIGGER_PATTERNS.some((pattern) => pattern.test(trimmed));
}

// ── System prompt injection ──

function planSystemPrompt(systemPrompt: string): string {
  return `${systemPrompt}\n\n[PLAN MODE ACTIVE]\n\nYou are in interactive planning mode. Use the reusable planning workflow: interview, read-only exploration, draft, review, approval. Do not modify source files. You may edit plan documentation only under the configured planPath. If planPath is session-only or not configured, do not write plan files. Do not use edit/write on source files. Use read-only investigation for code. Produce a concrete numbered plan under a \`Plan:\` header. Wait for explicit user approval before implementation.`;
}

// ── Extension entry point ──

export default function (pi: ExtensionAPI) {
  let state: PlanModeState = { active: false, executionMode: false, todos: [] };
  let currentCtx: ExtensionContext | undefined;

  // ── Plan mode enter/exit ──

  async function enterPlanMode(ctx: ExtensionContext, options: { notify?: boolean; source?: string } = {}): Promise<void> {
    const previousTools = state.previousTools ?? pi.getActiveTools?.();
    state = { ...state, active: true, previousTools };

    // Build dynamic tool list: only include edit/write if planPath exists
    const planPath = await resolvePlanPath(ctx);
    const tools = ["read", "bash", "grep", "find", "ls"];
    if (planPath) {
      tools.push("edit", "write");
      await mkdir(planPath, { recursive: true });
    }
    pi.setActiveTools(tools);

    if (options.notify !== false && ctx.hasUI) {
      ctx.ui.notify(
        planPath
          ? `Plan mode enabled. Source editing blocked until approval; plan docs allowed under: ${planPath}`
          : "Plan mode enabled. All editing blocked until approval (no planPath configured).",
        "info",
      );
    }
  }

  function leavePlanMode(ctx: ExtensionContext): void {
    state = { ...state, active: false };
    if (state.previousTools?.length) pi.setActiveTools(state.previousTools);
    if (ctx.hasUI) ctx.ui.notify("Plan mode exited", "info");
  }

  // ── Cockpit mode registration ──

  function registerCockpitMode(): void {
    const mode: CockpitMode = {
      id: "plan",
      label: "Plan",
      description: "Interview, explore safely, and draft an approved implementation plan",
      order: 20,
      onEnter: async (ctx) => {
        await enterPlanMode(ctx, { source: "cockpit-onEnter" });
      },
      onExit: async (ctx) => {
        leavePlanMode(ctx);
      },
      getStatusText: () => {
        if (state.executionMode && state.todos.length > 0) {
          const completed = state.todos.filter((t) => t.completed).length;
          return `plan ${completed}/${state.todos.length}`;
        }
        return state.active ? "plan" : undefined;
      },
      getFooterSegments: () => {
        if (!state.executionMode || state.todos.length === 0) return [];
        const completed = state.todos.filter((t) => t.completed).length;
        return [`${completed}/${state.todos.length}`];
      },
    };

    pi.events.emit("cockpit:mode:register", mode);
  }

  // ── Listen to pi-plan events (state comes from pi-plan, not us) ──

  pi.events.on("plan:draft", (event: any) => {
    state.todos = event.todos ?? [];

    // If plan mode is active, we handle the approval UI with cockpit-specific choices
    if (!state.active || !currentCtx?.hasUI) return;
    event.handled = true;

    const ctx = currentCtx;
    void (async () => {
      const choice = await ctx.ui.select("Plan drafted. What next?", [
        "Approve plan and start implementation in a new context",
        "Save plan document",
        "Refine plan",
        "Stay in plan mode",
        "Exit to edit mode",
      ]);

      if (choice === "Approve plan and start implementation in a new context") {
        state = { ...state, active: false, executionMode: true };
        pi.events.emit("cockpit:mode:switch", { id: "edit" });
        pi.sendUserMessage("/plan-approve", { deliverAs: "followUp" });
      } else if (choice === "Save plan document") {
        pi.sendUserMessage("/plan-save", { deliverAs: "followUp" });
      } else if (choice === "Refine plan") {
        const refinement = await ctx.ui.editor("How should the plan be refined?", "");
        if (refinement?.trim()) pi.sendUserMessage(refinement.trim());
      } else if (choice === "Exit to edit mode") {
        pi.events.emit("cockpit:mode:switch", { id: "edit" });
      }
    })();
  });

  pi.events.on("plan:progress", (event: any) => {
    state.todos = event.todos ?? state.todos;
  });

  pi.events.on("plan:approved", () => {
    state = { ...state, active: false, executionMode: true };
    if (state.previousTools?.length) pi.setActiveTools(state.previousTools);
  });

  pi.events.on("plan:cleared", () => {
    state = { ...state, active: false, executionMode: false, todos: [] };
  });

  // ── Session lifecycle ──

  pi.on("session_start", async (_event, ctx) => {
    currentCtx = ctx;
    registerCockpitMode();
  });

  pi.events.on("cockpit:ready", () => registerCockpitMode());

  pi.events.on("cockpit:mode:changed", (event: unknown) => {
    const data = event as { activeMode?: string; previousMode?: string };
    if (!currentCtx) return;
    if (data.activeMode === "plan" && !state.active && !state.executionMode) {
      void enterPlanMode(currentCtx, { notify: false, source: "cockpit-mode-changed" });
    } else if (data.previousMode === "plan" && data.activeMode !== "plan" && state.active) {
      leavePlanMode(currentCtx);
    }
  });

  // ── Auto-enter from user input ──

  pi.on("input", async (event, ctx) => {
    currentCtx = ctx;
    if (state.active || state.executionMode || event.source === "extension") return;
    if (!shouldAutoEnterPlanMode(event.text)) return;
    await enterPlanMode(ctx, { notify: true, source: "input" });
    pi.events.emit("cockpit:mode:switch", { id: "plan" });
    return { action: "continue" };
  });

  // ── System prompt injection + auto-enter from agent start ──

  pi.on("before_agent_start", async (event, ctx) => {
    currentCtx = ctx;
    if (!state.active && !state.executionMode && shouldAutoEnterPlanMode(event.prompt ?? "")) {
      await enterPlanMode(ctx, { notify: true, source: "before_agent_start" });
      pi.events.emit("cockpit:mode:switch", { id: "plan" });
    }
    if (!state.active) return;
    return { systemPrompt: planSystemPrompt(event.systemPrompt) };
  });

  // ── Tool-call enforcement (cockpit-specific: block edits and unsafe bash) ──

  pi.on("tool_call", async (event, ctx) => {
    currentCtx = ctx;
    if (!state.active) return;

    if (MUTATING_TOOLS.has(event.toolName)) {
      const path = (event.input as { path?: unknown } | undefined)?.path;
      if (!(await isAllowedPlanDocPath(path, ctx))) {
        const planPath = await resolvePlanPath(ctx);
        return {
          block: true,
          reason: planPath
            ? `Plan mode blocks source edits until approval. Only files under planPath may be edited: ${planPath}`
            : "Plan mode blocks edits until approval (no planPath configured).",
        };
      }
    }

    if (event.toolName === "bash") {
      const command = typeof event.input?.command === "string" ? event.input.command : "";
      if (!isSafeReadOnlyCommand(command)) {
        return { block: true, reason: `Plan mode only allows simple read-only shell commands. Blocked: ${command}` };
      }
    }
  });
}
