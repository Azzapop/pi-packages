import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

type PlanTodo = {
  step: number;
  text: string;
  completed?: boolean;
};

type PlanStorage =
  | { kind: "session"; source: "project" | "global" | "default"; raw?: unknown }
  | { kind: "path"; source: "project" | "global"; raw: string; path: string; projectRoot: string };

type PlanState = {
  todos: PlanTodo[];
  rawPlan?: string;
  title?: string;
  savedPath?: string;
  approvedPlan?: string;
  executionMode?: boolean;
};

const STATE_ENTRY = "pi-plan-state";
const PLAN_HEADING_RE = /^\s*Plan:\s*$/im;
const NUMBERED_STEP_RE = /^\s*(\d+)[.)]\s+(.+?)\s*$/gm;

// ── Shared utilities ──

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

async function resolvePlanStorage(ctx: ExtensionContext): Promise<PlanStorage> {
  const project = findProjectRoot(ctx.cwd);
  const projectSettings = await readJson(project.settingsPath);
  const globalSettingsPath = join(homedir(), ".pi", "agent", "settings.json");
  const globalSettings = await readJson(globalSettingsPath);

  const projectValue = projectSettings?.planPath;
  const globalValue = globalSettings?.planPath;
  const source = projectValue !== undefined ? "project" : globalValue !== undefined ? "global" : "default";
  const raw = projectValue !== undefined ? projectValue : globalValue;

  if (raw === undefined || raw === null || raw === false || raw === "session") {
    return { kind: "session", source, raw };
  }

  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { kind: "session", source, raw };
  }

  const expanded = expandHome(raw.trim());
  const path = isAbsolute(expanded) ? expanded : resolve(project.root, expanded);
  return { kind: "path", source: source as "project" | "global", raw, path, projectRoot: project.root };
}

function resolvePlanPath(storage: PlanStorage): string | undefined {
  return storage.kind === "path" ? storage.path : undefined;
}

function getTextFromMessage(message: any): string {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block: any) => block?.type === "text" && typeof block.text === "string")
    .map((block: any) => block.text)
    .join("\n");
}

function extractPlanText(text: string): string | undefined {
  const match = PLAN_HEADING_RE.exec(text);
  if (!match) return undefined;
  const start = match.index;
  const after = text.slice(start);
  const nextHeading = after.slice(match[0].length).search(/^##?\s+\S/m);
  if (nextHeading === -1) return after.trim();
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

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[`'"""'']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "plan";
}

function timestampForFilename(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function buildPlanDocument(state: PlanState, ctx: ExtensionContext): string {
  const title = state.title || state.todos[0]?.text || "Plan";
  const now = new Date().toISOString();
  const project = basename(ctx.cwd) || ctx.cwd;
  const plan = state.rawPlan?.trim() || ["Plan:", ...state.todos.map((todo) => `${todo.step}. ${todo.text}`)].join("\n");
  const progress = state.todos.map((todo) => `- [${todo.completed ? "x" : " "}] ${todo.step}. ${todo.text}`).join("\n");

  return `# Plan: ${title}\n\nStatus: draft\nCreated: ${now}\nProject: ${project}\n\n## Interview Summary\n\n_Not captured in this document._\n\n## Constraints and Acceptance Criteria\n\n_Not captured in this document._\n\n## Exploration Findings\n\n_Not captured in this document._\n\n## Approved Plan\n\n${plan}\n\n## Execution Progress\n\n${progress}\n`;
}

function buildImplementationSeed(state: PlanState): string {
  const plan = state.approvedPlan || state.rawPlan || ["Plan:", ...state.todos.map((todo) => `${todo.step}. ${todo.text}`)].join("\n");
  const progress = state.todos.map((todo) => `- [ ] ${todo.step}. ${todo.text}`).join("\n");
  return `[APPROVED PLAN]\n\n${plan}\n\nExecution requirements:\n- Execute steps in order.\n- After completing step n, include [DONE:n].\n- Stop and ask if the plan becomes invalid.\n\nProgress checklist:\n${progress}${state.savedPath ? `\n\nPlan document: ${state.savedPath}` : ""}`;
}

// ── UI helpers ──

function renderWidget(ctx: ExtensionContext, state: PlanState): void {
  if (!ctx.hasUI) return;
  if (state.todos.length === 0) {
    ctx.ui.setWidget("pi-plan-todos", undefined);
    ctx.ui.setStatus("pi-plan", undefined);
    return;
  }

  const lines = state.todos.map((todo) => {
    if (todo.completed) return ctx.ui.theme.fg("success", "☑ ") + ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(todo.text));
    return `${ctx.ui.theme.fg("muted", "☐ ")}${todo.text}`;
  });
  ctx.ui.setWidget("pi-plan-todos", lines);

  const checks = state.todos
    .map((todo) => (todo.completed ? ctx.ui.theme.fg("success", "☑") : ctx.ui.theme.fg("muted", "☐")))
    .join("");
  const completed = state.todos.filter((todo) => todo.completed).length;
  ctx.ui.setStatus("pi-plan", `${checks} ${completed}/${state.todos.length}`);
}

function restoreState(ctx: ExtensionContext): PlanState {
  const entry = ctx.sessionManager
    .getEntries()
    .filter((entry: any) => entry?.type === "custom" && entry.customType === STATE_ENTRY)
    .pop() as { data?: PlanState } | undefined;
  return { todos: [], ...(entry?.data ?? {}) };
}

// ── Extension entry point ──

export default function (pi: ExtensionAPI) {
  let state: PlanState = { todos: [] };

  function persist(): void {
    pi.appendEntry(STATE_ENTRY, state);
  }

  function getState(): PlanState {
    return { ...state };
  }

  // ── Session lifecycle ──

  // ── Event listeners (registered once at load time) ──

  // Respond to state queries from other packages (e.g. pi-mode-plan)
  pi.events.on("plan:request-state", () => {
    pi.events.emit("plan:state", getState());
  });

  // Clear plan state when cockpit /clear is invoked
  pi.events.on("cockpit:clear", () => {
    state = { todos: [] };
    persist();
    if (currentCtx) renderWidget(currentCtx, state);
    pi.events.emit("plan:cleared");
  });

  // ── Session lifecycle ──

  let currentCtx: ExtensionContext | undefined;

  pi.on("session_start", async (_event, ctx) => {
    currentCtx = ctx;
    state = restoreState(ctx);
    renderWidget(ctx, state);
  });

  // ── Plan detection from agent output ──

  pi.on("agent_end", async (event, ctx) => {
    currentCtx = ctx;
    if (state.executionMode) return;

    const lastAssistant = [...event.messages].reverse().find((message: any) => message?.role === "assistant");
    const text = getTextFromMessage(lastAssistant);
    const rawPlan = extractPlanText(text);
    if (!rawPlan) return;

    const todos = extractTodos(rawPlan);
    if (todos.length === 0) return;

    state = { ...state, rawPlan, todos, title: todos[0]?.text };
    persist();
    renderWidget(ctx, state);

    // Emit event so other packages (pi-mode-plan) can react or override the approval flow
    const draftEvent = { rawPlan, todos, title: state.title, handled: false };
    pi.events.emit("plan:draft", draftEvent);

    // If another package (e.g. pi-mode-plan) handled the approval UI, skip ours
    if (draftEvent.handled) return;

    // Standalone approval flow
    if (!ctx.hasUI) return;

    const storage = await resolvePlanStorage(ctx);
    const planPath = resolvePlanPath(storage);

    const choices = [
      "Approve plan and start implementation in a new context",
      ...(planPath ? ["Save plan document"] : []),
      "Refine plan",
      "Continue (keep plan in session)",
    ];

    const choice = await ctx.ui.select("Plan drafted. What next?", choices);

    if (choice === "Approve plan and start implementation in a new context") {
      pi.sendUserMessage("/plan-approve", { deliverAs: "followUp" });
    } else if (choice === "Save plan document") {
      pi.sendUserMessage("/plan-save", { deliverAs: "followUp" });
    } else if (choice === "Refine plan") {
      const refinement = await ctx.ui.editor("How should the plan be refined?", "");
      if (refinement?.trim()) pi.sendUserMessage(refinement.trim());
    }
  });

  // ── Execution progress tracking ──

  pi.on("turn_end", async (event, ctx) => {
    currentCtx = ctx;
    if (state.todos.length === 0) return;
    const text = getTextFromMessage(event.message);
    if (markCompletedSteps(text, state.todos) === 0) return;
    persist();
    renderWidget(ctx, state);
    pi.events.emit("plan:progress", { todos: [...state.todos] });
  });

  // ── Commands ──

  pi.registerCommand("plan-path", {
    description: "Show the effective planPath setting and resolved plan document destination",
    handler: async (_args, ctx) => {
      const storage = await resolvePlanStorage(ctx);
      if (storage.kind === "session") {
        ctx.ui.notify(`planPath: session-only (${storage.source})`, "info");
        return;
      }
      ctx.ui.notify(`planPath: ${storage.raw} (${storage.source})\nResolved: ${storage.path}`, "info");
    },
  });

  pi.registerCommand("plan-todos", {
    description: "Show the latest parsed plan todos",
    handler: async (_args, ctx) => {
      if (state.todos.length === 0) {
        ctx.ui.notify("No parsed plan todos yet. Use /plan or ask for a numbered Plan: section.", "info");
        return;
      }
      const lines = state.todos.map((todo) => `${todo.step}. ${todo.completed ? "✓" : "○"} ${todo.text}`).join("\n");
      ctx.ui.notify(`Plan todos:\n${lines}`, "info");
    },
  });

  pi.registerCommand("plan-clear", {
    description: "Clear the latest parsed plan todos and reset plan state",
    handler: async (_args, ctx) => {
      state = { todos: [] };
      persist();
      renderWidget(ctx, state);
      ctx.ui.notify("Plan state cleared", "info");
      pi.events.emit("plan:cleared");
    },
  });

  pi.registerCommand("plan-save", {
    description: "Save the latest parsed plan document to the configured planPath",
    handler: async (args, ctx) => {
      if (state.todos.length === 0) {
        ctx.ui.notify("No parsed plan to save. Ask for a numbered Plan: section first.", "warning");
        return;
      }

      const storage = await resolvePlanStorage(ctx);
      if (storage.kind === "session") {
        ctx.ui.notify("planPath is session-only; no plan document was written.", "info");
        return;
      }

      const title = args.trim() || state.title || state.todos[0]?.text || "plan";
      const filename = `${timestampForFilename()}-${slugify(title)}.plan.md`;
      const path = join(storage.path, filename);
      await mkdir(storage.path, { recursive: true });
      await writeFile(path, buildPlanDocument({ ...state, title }, ctx), "utf8");
      state = { ...state, title, savedPath: path };
      persist();
      ctx.ui.notify(`Plan saved: ${path}`, "info");
      pi.events.emit("plan:saved", { path });
    },
  });

  pi.registerCommand("plan-approve", {
    description: "Approve the current plan and start implementation in a new context",
    handler: async (_args, ctx) => {
      if (!state.rawPlan || state.todos.length === 0) {
        ctx.ui.notify("No draft plan is available to approve.", "warning");
        return;
      }

      await ctx.waitForIdle();

      const storage = await resolvePlanStorage(ctx);
      state = {
        ...state,
        approvedPlan: state.rawPlan,
        executionMode: true,
        savedPath: state.savedPath || (storage.kind === "path" ? storage.path : undefined),
      };
      persist();

      const seed = buildImplementationSeed(state);
      pi.events.emit("plan:approved", { rawPlan: state.rawPlan, todos: [...state.todos], seed });

      await ctx.newSession({
        parentSession: ctx.sessionManager.getSessionFile(),
        withSession: async (newCtx) => {
          renderWidget(newCtx, state);
          await newCtx.sendUserMessage(
            `${seed}\n\nImplement the approved plan. Start with step 1 and use [DONE:n] markers as each step is completed.`,
          );
        },
      });
    },
  });

  pi.registerCommand("plan-cancel", {
    description: "Cancel plan execution tracking and clear plan state",
    handler: async (_args, ctx) => {
      state = { todos: [] };
      persist();
      renderWidget(ctx, state);
      ctx.ui.notify("Plan execution cancelled", "info");
      pi.events.emit("plan:cleared");
    },
  });
}
