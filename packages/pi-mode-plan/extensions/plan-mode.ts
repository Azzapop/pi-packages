import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

type PlanTodo = {
  step: number;
  text: string;
  completed?: boolean;
};

type PlanModeState = {
  active: boolean;
  executionMode: boolean;
  approvedPlan?: string;
  rawPlan?: string;
  todos: PlanTodo[];
  previousTools?: string[];
  planPath?: string;
};

type CockpitMode = {
  id: string;
  label: string;
  description?: string;
  order?: number;
  onEnter?: (ctx: ExtensionContext) => void | Promise<void>;
  onExit?: (ctx: ExtensionContext) => void | Promise<void>;
  getFooterSegments?: (ctx: ExtensionContext) => string[];
  getStatusText?: (ctx: ExtensionContext) => string | undefined;
  beforeAgentStart?: (event: any, ctx: ExtensionContext) => any | Promise<any>;
};

const STATE_ENTRY = "cockpit-plan-mode";
const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls", "edit", "write"];
const PLAN_HEADING_RE = /^\s*Plan:\s*$/im;
const NUMBERED_STEP_RE = /^\s*(\d+)[.)]\s+(.+?)\s*$/gm;
const MUTATING_TOOLS = new Set(["edit", "write"]);
const SAFE_BASH_COMMANDS = new Set([
  "awk",
  "basename",
  "cat",
  "date",
  "dirname",
  "du",
  "echo",
  "env",
  "fd",
  "find",
  "git",
  "grep",
  "head",
  "jq",
  "ls",
  "npm",
  "pnpm",
  "pwd",
  "rg",
  "sort",
  "tail",
  "tree",
  "uname",
  "uniq",
  "wc",
  "whoami",
  "yarn",
]);

const SAFE_GIT_SUBCOMMANDS = new Set(["branch", "diff", "log", "show", "status"]);
const SAFE_NPM_SUBCOMMANDS = new Set(["info", "list", "ls", "outdated", "view", "why"]);
const PLAN_TRIGGER_PATTERNS = [
  /\bplan\s+(this|it|out|first|before|the work|an implementation|implementation)\b/i,
  /\b(make|create|draft|write|build)\s+(me\s+)?(a\s+)?plan\b/i,
  /\bhelp\s+me\s+plan\b/i,
  /\blet'?s\s+plan\b/i,
  /\bthink\s+(this\s+)?through\b/i,
  /\bbefore\s+(editing|implementing|coding|changing)\b/i,
  /\b(read[- ]only|no edits?|don'?t edit|do not edit)\b/i,
  /\bimplementation\s+plan\b/i,
  /\bplanning\s+mode\b/i,
  /\bplan\s+workflow\b/i,
  /\btrigger\s+(the\s+)?plan\b/i,
  /\bapproval\s+flow\b/i,
  /\bneed\s+to\s+approve\b/i,
];

function getTextFromMessage(message: any): string {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

function extractPlanText(text: string): string | undefined {
  const match = PLAN_HEADING_RE.exec(text);
  if (!match) return undefined;
  const after = text.slice(match.index).trim();
  const nextHeading = after.slice(match[0].length).search(/^##?\s+\S/m);
  if (nextHeading === -1) return after;
  return after.slice(0, match[0].length + nextHeading).trim();
}

function extractTodos(planText: string): PlanTodo[] {
  const todos: PlanTodo[] = [];
  for (const match of planText.matchAll(NUMBERED_STEP_RE)) {
    const step = Number(match[1]);
    const text = match[2]?.trim();
    if (Number.isFinite(step) && text) todos.push({ step, text });
  }
  return todos;
}

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

function shouldAutoEnterPlanMode(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith("!")) return false;
  if (/^\/plan(?:\s|$)/.test(trimmed)) return true;
  if (trimmed.startsWith("/")) return false;
  if (/\bplan\b/i.test(trimmed) && /\bapprove|approval\b/i.test(trimmed)) return true;
  return PLAN_TRIGGER_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function markCompletedSteps(text: string, todos: PlanTodo[]): number {
  let changed = 0;
  for (const match of text.matchAll(/\[DONE:(\d+)\]/g)) {
    const step = Number(match[1]);
    const todo = todos.find((item) => item.step === step);
    if (todo && !todo.completed) {
      todo.completed = true;
      changed++;
    }
  }
  return changed;
}

function renderTodos(ctx: ExtensionContext, state: PlanModeState): void {
  if (!ctx.hasUI) return;
  if (!state.executionMode || state.todos.length === 0) {
    ctx.ui.setWidget("cockpit-plan-todos", undefined);
    ctx.ui.setStatus("cockpit-plan", undefined);
    return;
  }

  const completed = state.todos.filter((todo) => todo.completed).length;
  ctx.ui.setStatus("cockpit-plan", `plan ${completed}/${state.todos.length}`);
  ctx.ui.setWidget(
    "cockpit-plan-todos",
    state.todos.map((todo) => {
      if (todo.completed) return ctx.ui.theme.fg("success", "☑ ") + ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(todo.text));
      return `${ctx.ui.theme.fg("muted", "☐ ")}${todo.text}`;
    }),
  );
}

function restoreState(ctx: ExtensionContext): PlanModeState {
  const entry = ctx.sessionManager
    .getEntries()
    .filter((entry: any) => entry?.type === "custom" && entry.customType === STATE_ENTRY)
    .pop() as { data?: PlanModeState } | undefined;
  return { active: false, executionMode: false, todos: [], ...(entry?.data ?? {}) };
}

function buildImplementationSeed(state: PlanModeState): string {
  const plan = state.approvedPlan || state.rawPlan || ["Plan:", ...state.todos.map((todo) => `${todo.step}. ${todo.text}`)].join("\n");
  const progress = state.todos.map((todo) => `- [ ] ${todo.step}. ${todo.text}`).join("\n");
  return `[APPROVED PLAN]\n\n${plan}\n\nExecution requirements:\n- Execute steps in order.\n- After completing step n, include [DONE:n].\n- Stop and ask if the plan becomes invalid.\n\nProgress checklist:\n${progress}\n${state.planPath ? `\nPlan document: ${state.planPath}\n` : ""}`;
}

export default function (pi: ExtensionAPI) {
  let state: PlanModeState = { active: false, executionMode: false, todos: [] };
  let currentCtx: ExtensionContext | undefined;

  function persist(): void {
    pi.appendEntry(STATE_ENTRY, state);
  }

  function debug(ctx: ExtensionContext | undefined, message: string): void {
    if (ctx?.hasUI) ctx.ui.notify(`[plan-debug] ${message}`, "info");
  }

  async function enterPlanMode(ctx: ExtensionContext, options: { notify?: boolean; source?: string } = {}): Promise<void> {
    const previousTools = state.previousTools ?? pi.getActiveTools?.();
    state = { ...state, active: true, executionMode: false, previousTools };
    debug(ctx, `enterPlanMode source=${options.source ?? "unknown"}`);
    pi.setActiveTools(PLAN_MODE_TOOLS);
    const planPath = await resolvePlanPath(ctx);
    if (planPath) await mkdir(planPath, { recursive: true });
    persist();
    renderTodos(ctx, state);
    if (options.notify !== false && ctx.hasUI) {
      ctx.ui.notify(
        planPath
          ? `Plan mode enabled. Source editing is blocked until approval; only planPath edits are allowed: ${planPath}`
          : "Plan mode enabled. Editing is blocked until approval because planPath is session-only or not configured.",
        "info",
      );
    }
  }

  function leavePlanMode(ctx: ExtensionContext): void {
    state = { ...state, active: false };
    if (!state.executionMode && state.previousTools?.length) pi.setActiveTools(state.previousTools);
    persist();
    renderTodos(ctx, state);
  }


  function planSystemPrompt(systemPrompt: string): string {
    return `${systemPrompt}\n\n[PLAN MODE ACTIVE]\n\nYou are in interactive planning mode. Use the reusable planning workflow: interview, read-only exploration, draft, review, approval. Do not modify source files. You may edit plan documentation only under the configured planPath. If planPath is session-only or not configured, do not write plan files. Do not use edit/write on source files. Use read-only investigation for code. Produce a concrete numbered plan under a \`Plan:\` header. Wait for explicit user approval before implementation.`;
  }

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
      getStatusText: () => "plan",
      getFooterSegments: () => {
        if (!state.executionMode || state.todos.length === 0) return [];
        const completed = state.todos.filter((todo) => todo.completed).length;
        return [`${completed}/${state.todos.length}`];
      },

    };

    pi.events.emit("cockpit:mode:register", mode);
  }

  pi.on("session_start", async (_event, ctx) => {
    currentCtx = ctx;
    state = restoreState(ctx);
    renderTodos(ctx, state);
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

  pi.on("input", async (event, ctx) => {
    currentCtx = ctx;
    if (state.active || state.executionMode || event.source === "extension") return;
    if (!shouldAutoEnterPlanMode(event.text)) return;
    debug(ctx, `input trigger text=${JSON.stringify(event.text.slice(0, 120))}`);
    await enterPlanMode(ctx, { notify: true, source: "input" });
    pi.events.emit("cockpit:mode:switch", { id: "plan" });
    return { action: "continue" };
  });


  pi.on("before_agent_start", async (event, ctx) => {
    currentCtx = ctx;
    if (!state.active && !state.executionMode && shouldAutoEnterPlanMode(event.prompt ?? "")) {
      debug(ctx, `before_agent_start trigger prompt=${JSON.stringify((event.prompt ?? "").slice(0, 120))}`);
      await enterPlanMode(ctx, { notify: true, source: "before_agent_start" });
      pi.events.emit("cockpit:mode:switch", { id: "plan" });
    }
    if (!state.active) return;
    return { systemPrompt: planSystemPrompt(event.systemPrompt) };
  });

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
            ? `Plan mode blocks source edits until approval. Only files under the configured planPath may be edited while planning: ${planPath}`
            : "Plan mode blocks edits until approval because planPath is session-only or not configured.",
        };
      }
    }
    if (event.toolName === "bash") {
      const command = typeof event.input?.command === "string" ? event.input.command : "";
      if (!isSafeReadOnlyCommand(command)) {
        return { block: true, reason: `Plan mode only allows simple read-only shell commands until approval. Command: ${command}` };
      }
    }
  });

  pi.on("agent_end", async (event, ctx) => {
    currentCtx = ctx;
    debug(ctx, `agent_end active=${state.active} execution=${state.executionMode} messages=${event.messages.length}`);
    if (!state.active || state.executionMode) return;
    const lastAssistant = [...event.messages].reverse().find((message: any) => message?.role === "assistant");
    const assistantText = getTextFromMessage(lastAssistant);
    debug(ctx, `agent_end assistantTextLen=${assistantText.length}`);
    const rawPlan = extractPlanText(assistantText);
    debug(ctx, `agent_end rawPlan=${rawPlan ? "yes" : "no"}`);
    if (!rawPlan) return;

    const todos = extractTodos(rawPlan);
    debug(ctx, `agent_end todos=${todos.length}`);
    if (todos.length === 0) return;

    state = { ...state, rawPlan, todos };
    persist();

    if (!ctx.hasUI) {
      debug(ctx, "agent_end no-ui; approval prompt skipped");
      return;
    }
    debug(ctx, "opening approval prompt");
    const choice = await ctx.ui.select("Plan drafted. What next?", [
      "Approve plan and start implementation in a new context",
      "Save plan document",
      "Refine plan",
      "Stay in plan mode",
      "Exit to edit mode",
    ]);

    if (choice === "Approve plan and start implementation in a new context") {
      state = { ...state, approvedPlan: rawPlan, executionMode: true, active: false };
      persist();
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
  });

  pi.on("turn_end", async (event, ctx) => {
    currentCtx = ctx;
    if (!state.executionMode || state.todos.length === 0) return;
    if (markCompletedSteps(getTextFromMessage(event.message), state.todos) === 0) return;
    persist();
    renderTodos(ctx, state);
  });

  pi.registerCommand("plan-approve", {
    description: "Approve the current plan and start implementation in a new context",
    handler: async (_args, ctx) => {
      debug(ctx, `plan-approve command rawPlan=${state.rawPlan ? "yes" : "no"} todos=${state.todos.length}`);
      if (!state.rawPlan || state.todos.length === 0) {
        ctx.ui.notify("No draft plan is available to approve.", "warning");
        return;
      }

      await ctx.waitForIdle();
      state = { ...state, approvedPlan: state.rawPlan, active: false, executionMode: true, planPath: await resolvePlanPath(ctx) };
      persist();
      const seed = buildImplementationSeed(state);
      if (state.previousTools?.length) pi.setActiveTools(state.previousTools);

      await ctx.newSession({
        parentSession: ctx.sessionManager.getSessionFile(),
        setup: async (sm: any) => {
          sm.appendMessage({
            role: "user",
            content: [{ type: "text", text: seed }],
            timestamp: Date.now(),
          });
        },
        withSession: async (newCtx) => {
          renderTodos(newCtx, state);
          await newCtx.sendUserMessage("Implement the approved plan. Start with step 1 and use [DONE:n] markers as each step is completed.");
        },
      });
    },
  });

  pi.registerCommand("plan-cancel", {
    description: "Cancel Cockpit plan execution tracking and restore previous tools",
    handler: async (_args, ctx) => {
      state = { active: false, executionMode: false, todos: [], previousTools: state.previousTools };
      if (state.previousTools?.length) pi.setActiveTools(state.previousTools);
      persist();
      renderTodos(ctx, state);
      pi.events.emit("cockpit:mode:switch", { id: "edit" });
      ctx.ui.notify("Plan mode cancelled", "info");
    },
  });
}
