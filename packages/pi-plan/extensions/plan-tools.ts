import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
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

type PlanWidgetMode = "compact" | "summary" | "full" | "hidden";

type PlanDocumentSummary = {
  path: string;
  title: string;
  status: string;
  todos: PlanTodo[];
  approvedPlan?: string;
  created?: string;
  project?: string;
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

async function resolvePlanWidgetMode(ctx: ExtensionContext): Promise<PlanWidgetMode> {
  const project = findProjectRoot(ctx.cwd);
  const projectSettings = await readJson(project.settingsPath);
  const globalSettingsPath = join(homedir(), ".pi", "agent", "settings.json");
  const globalSettings = await readJson(globalSettingsPath);
  const raw = projectSettings?.planWidgetMode !== undefined ? projectSettings.planWidgetMode : globalSettings?.planWidgetMode;
  return raw === "summary" || raw === "full" || raw === "hidden" || raw === "compact" ? raw : "compact";
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

function extractSection(text: string, heading: string): string | undefined {
  const re = new RegExp(`^## ${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m");
  const match = re.exec(text);
  if (!match) return undefined;
  const start = match.index + match[0].length;
  const rest = text.slice(start);
  const nextHeading = rest.search(/^##\s+\S/m);
  return (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).trim();
}

function extractProgressTodos(progressText: string): PlanTodo[] {
  const todos: PlanTodo[] = [];
  for (const match of progressText.matchAll(/^\s*-\s+\[([ xX])\]\s+(\d+)[.)]\s+(.+?)\s*$/gm)) {
    const step = Number(match[2]);
    const text = match[3]?.trim();
    if (Number.isFinite(step) && text) todos.push({ step, text, completed: match[1]?.toLowerCase() === "x" });
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

function getPlanStatus(state: PlanState): string {
  if (state.todos.length > 0 && state.todos.every((todo) => todo.completed)) return "complete";
  if (state.executionMode || state.approvedPlan) return "in-progress";
  return "draft";
}

function buildPlanDocument(state: PlanState, ctx: ExtensionContext): string {
  const title = state.title || state.todos[0]?.text || "Plan";
  const now = new Date().toISOString();
  const project = basename(ctx.cwd) || ctx.cwd;
  const plan = state.rawPlan?.trim() || ["Plan:", ...state.todos.map((todo) => `${todo.step}. ${todo.text}`)].join("\n");
  const progress = buildProgressChecklist(state);

  return `# Plan: ${title}\n\nStatus: ${getPlanStatus(state)}\nCreated: ${now}\nProject: ${project}\n\n## Interview Summary\n\n_Not captured in this document._\n\n## Constraints and Acceptance Criteria\n\n_Not captured in this document._\n\n## Exploration Findings\n\n_Not captured in this document._\n\n## Approved Plan\n\n${plan}\n\n## Execution Progress\n\n${progress}\n`;
}

function buildProgressChecklist(state: PlanState): string {
  return state.todos.map((todo) => `- [${todo.completed ? "x" : " "}] ${todo.step}. ${todo.text}`).join("\n");
}

function getNextIncompleteTodo(state: PlanState): PlanTodo | undefined {
  return state.todos.find((todo) => !todo.completed);
}

function truncateText(text: string, max = 72): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function formatTodoLine(todo: PlanTodo, completedPrefix = "✓", pendingPrefix = "○"): string {
  return `${todo.completed ? completedPrefix : pendingPrefix} ${todo.step}. ${todo.text}`;
}

function buildImplementationSeed(state: PlanState): string {
  const plan = state.approvedPlan || state.rawPlan || ["Plan:", ...state.todos.map((todo) => `${todo.step}. ${todo.text}`)].join("\n");
  const progress = buildProgressChecklist(state);
  const next = getNextIncompleteTodo(state);
  return `[APPROVED PLAN]\n\n${plan}\n\nExecution requirements:\n- Execute steps in order, one numbered step at a time.\n- Treat each step as a durable checkpoint: finish step n, then immediately include [DONE:n] before starting any later step.\n- You may continue automatically to the next step only after the previous step has been marked with its [DONE:n] marker.\n- Never claim or batch multiple completed steps without emitting each individual [DONE:n] marker.\n- Stop and ask if the plan becomes invalid.\n\nCurrent progress checklist:\n${progress}${next ? `\n\nNext incomplete step: ${next.step}. ${next.text}` : "\n\nAll steps are currently marked complete."}${state.savedPath ? `\n\nPlan document: ${state.savedPath}` : ""}`;
}

function buildResumePrompt(state: PlanState): string {
  const next = getNextIncompleteTodo(state);
  if (!next) return "The approved plan appears complete. Summarize the completed work and validation results.";
  return `${buildImplementationSeed(state)}\n\nResume the approved plan from the next incomplete step: ${next.step}. ${next.text}\n\nContinue sequentially from there. Remember: complete and mark each step with its [DONE:n] marker before moving to any later step.`;
}

function isPlanDocumentPath(path: string | undefined): path is string {
  return typeof path === "string" && /\.(md|mdx|txt)$/i.test(path);
}

function replaceStatus(document: string, status: string): string {
  if (/^Status:\s*.+$/m.test(document)) return document.replace(/^Status:\s*.+$/m, `Status: ${status}`);
  return document.replace(/^(# .+\n)/, `$1\nStatus: ${status}\n`);
}

async function updateSavedPlanProgress(state: PlanState): Promise<boolean> {
  if (!isPlanDocumentPath(state.savedPath)) return false;
  const progress = buildProgressChecklist(state);
  let document: string;
  try {
    document = await readFile(state.savedPath, "utf8");
  } catch {
    return false;
  }

  document = replaceStatus(document, getPlanStatus(state));
  const section = `## Execution Progress\n\n${progress}`;
  if (/^## Execution Progress\s*$/m.test(document)) {
    const nextHeading = /^## Execution Progress\s*$/m.exec(document);
    if (!nextHeading) return false;
    const start = nextHeading.index;
    const afterHeadingStart = start + nextHeading[0].length;
    const rest = document.slice(afterHeadingStart);
    const nextSectionMatch = rest.search(/^##\s+\S/m);
    document = nextSectionMatch === -1
      ? `${document.slice(0, start)}${section}\n`
      : `${document.slice(0, start)}${section}\n\n${rest.slice(nextSectionMatch)}`;
  } else {
    document = `${document.replace(/\s*$/, "")}\n\n${section}\n`;
  }

  await writeFile(state.savedPath, document, "utf8");
  return true;
}

async function updateSavedPlanStatus(state: PlanState): Promise<boolean> {
  if (!isPlanDocumentPath(state.savedPath)) return false;
  try {
    const document = replaceStatus(await readFile(state.savedPath, "utf8"), getPlanStatus(state));
    await writeFile(state.savedPath, document, "utf8");
    return true;
  } catch {
    return false;
  }
}

async function findPlanDocuments(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) paths.push(...await findPlanDocuments(path));
    else if (entry.isFile() && /\.plan\.md$/i.test(entry.name)) paths.push(path);
  }
  return paths.sort().reverse();
}

async function parsePlanDocument(path: string): Promise<PlanDocumentSummary | undefined> {
  try {
    const document = await readFile(path, "utf8");
    const title = /^#\s+Plan:\s*(.+?)\s*$/m.exec(document)?.[1]?.trim() || basename(path);
    const status = /^Status:\s*(.+?)\s*$/m.exec(document)?.[1]?.trim() || "unknown";
    const created = /^Created:\s*(.+?)\s*$/m.exec(document)?.[1]?.trim();
    const project = /^Project:\s*(.+?)\s*$/m.exec(document)?.[1]?.trim();
    const approvedPlan = extractSection(document, "Approved Plan");
    const progress = extractSection(document, "Execution Progress");
    const todos = progress ? extractProgressTodos(progress) : approvedPlan ? extractTodos(approvedPlan) : [];
    return { path, title, status, todos, approvedPlan, created, project };
  } catch {
    return undefined;
  }
}

function planSummaryProgress(plan: PlanDocumentSummary): { completed: number; total: number; next?: PlanTodo } {
  const completed = plan.todos.filter((todo) => todo.completed).length;
  return { completed, total: plan.todos.length, next: plan.todos.find((todo) => !todo.completed) };
}

// ── UI helpers ──

function renderWidget(ctx: ExtensionContext, state: PlanState, mode: PlanWidgetMode = "compact"): void {
  if (!ctx.hasUI) return;
  if (state.todos.length === 0) {
    ctx.ui.setWidget("pi-plan-todos", undefined);
    ctx.ui.setStatus("pi-plan", undefined);
    return;
  }

  const completed = state.todos.filter((todo) => todo.completed).length;
  if (mode === "hidden") {
    ctx.ui.setWidget("pi-plan-todos", undefined);
    ctx.ui.setStatus("pi-plan", `plan ${completed}/${state.todos.length}`);
    return;
  }

  const next = getNextIncompleteTodo(state);
  const checks = state.todos.length <= 20
    ? state.todos.map((todo) => (todo.completed ? ctx.ui.theme.fg("success", "☑") : ctx.ui.theme.fg("muted", "☐"))).join("")
    : "";
  const summary = checks ? `Plan ${completed}/${state.todos.length} ${checks}` : `Plan ${completed}/${state.todos.length}`;

  if (mode === "full") {
    const lines = state.todos.map((todo) => {
      if (todo.completed) return ctx.ui.theme.fg("success", "☑ ") + ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(todo.text));
      return `${ctx.ui.theme.fg("muted", "☐ ")}${todo.text}`;
    });
    ctx.ui.setWidget("pi-plan-todos", lines);
  } else {
    const lines = [summary];
    if (next) lines.push(`Next ${next.step}: ${truncateText(next.text)}`);
    else lines.push(ctx.ui.theme.fg("success", "All plan steps complete"));
    if (mode === "summary") {
      const remaining = state.todos.filter((todo) => !todo.completed && todo !== next).length;
      lines.push(`Remaining after next: ${remaining}`);
    }
    ctx.ui.setWidget("pi-plan-todos", lines);
  }

  ctx.ui.setStatus("pi-plan", `plan ${completed}/${state.todos.length}`);
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
  let widgetMode: PlanWidgetMode = "compact";
  let lastPlanList: PlanDocumentSummary[] = [];

  function persist(): void {
    pi.appendEntry(STATE_ENTRY, state);
  }

  function getState(): PlanState {
    return { ...state };
  }

  // ── Session lifecycle ──

  // ── Event listeners (registered once at load time) ──

  // Respond to state queries from other packages or extensions
  pi.events.on("plan:request-state", () => {
    pi.events.emit("plan:state", getState());
  });

  // Clear plan state when cockpit /clear is invoked
  pi.events.on("cockpit:clear", () => {
    state = { todos: [] };
    persist();
    if (currentCtx) renderWidget(currentCtx, state, widgetMode);
    pi.events.emit("plan:cleared");
  });

  // ── Session lifecycle ──

  let currentCtx: ExtensionContext | undefined;

  pi.on("session_start", async (_event, ctx) => {
    currentCtx = ctx;
    state = restoreState(ctx);
    widgetMode = await resolvePlanWidgetMode(ctx);
    renderWidget(ctx, state, widgetMode);
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
    renderWidget(ctx, state, widgetMode);

    // Emit event so other packages can react or override the approval flow
    const draftEvent = { rawPlan, todos, title: state.title, handled: false };
    pi.events.emit("plan:draft", draftEvent);

    // If another package handled the approval UI, skip ours
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
    const savedProgress = await updateSavedPlanProgress(state);
    renderWidget(ctx, state, widgetMode);
    const next = getNextIncompleteTodo(state);
    pi.events.emit("plan:progress", { todos: [...state.todos], next, savedProgress });
    if (ctx.hasUI) {
      ctx.ui.notify(
        next
          ? `Plan progress saved. Next: ${next.step}. ${next.text}`
          : "Plan progress saved. All plan steps are complete.",
        "info",
      );
    }
  });

  async function ensureApprovedPlanDocument(ctx: any): Promise<void> {
    const storage = await resolvePlanStorage(ctx);
    let savedPath = isPlanDocumentPath(state.savedPath) ? state.savedPath : undefined;
    if (!savedPath && storage.kind === "path") {
      const title = state.title || state.todos[0]?.text || "plan";
      const filename = `${timestampForFilename()}-${slugify(title)}.plan.md`;
      savedPath = join(storage.path, filename);
      await mkdir(storage.path, { recursive: true });
    }
    state = {
      ...state,
      approvedPlan: state.rawPlan,
      executionMode: true,
      savedPath,
    };
    persist();
    if (savedPath) await writeFile(savedPath, buildPlanDocument(state, ctx), "utf8");
    else await updateSavedPlanStatus(state);
  }

  async function startImplementationSession(ctx: any): Promise<void> {
    const stateSnapshot: PlanState = { ...state, todos: [...state.todos] };
    const seed = buildImplementationSeed(stateSnapshot);
    pi.events.emit("plan:approved", { rawPlan: stateSnapshot.rawPlan, todos: [...stateSnapshot.todos], seed });
    await ctx.newSession({
      parentSession: ctx.sessionManager.getSessionFile(),
      setup: async (sessionManager: any) => {
        if (stateSnapshot.todos.length > 0) sessionManager.appendCustomEntry(STATE_ENTRY, stateSnapshot);
      },
      withSession: async (newCtx: any) => {
        widgetMode = await resolvePlanWidgetMode(newCtx);
        renderWidget(newCtx, stateSnapshot, widgetMode);
        await newCtx.sendUserMessage(
          `${seed}\n\nImplement the approved plan from the first incomplete step. Work sequentially and checkpoint each numbered step with its [DONE:n] marker before moving on.`,
        );
      },
    });
  }

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

  pi.registerCommand("plan-list", {
    description: "List saved plans from planPath. Filters: in-progress (default), all, draft, complete",
    handler: async (args, ctx) => {
      const storage = await resolvePlanStorage(ctx);
      if (storage.kind === "session") {
        ctx.ui.notify("planPath is session-only; no saved plans can be listed.", "info");
        return;
      }

      const filter = args.trim() || "in-progress";
      if (!["in-progress", "all", "draft", "complete"].includes(filter)) {
        ctx.ui.notify("Usage: /plan-list [in-progress|all|draft|complete]", "warning");
        return;
      }

      let paths: string[] = [];
      try {
        paths = await findPlanDocuments(storage.path);
      } catch {
        ctx.ui.notify(`No plan directory found: ${storage.path}`, "info");
        return;
      }

      const plans = (await Promise.all(paths.map((path) => parsePlanDocument(path)))).filter((plan): plan is PlanDocumentSummary => !!plan);
      lastPlanList = plans.filter((plan) => {
        const progress = planSummaryProgress(plan);
        const normalizedStatus = plan.status.toLowerCase();
        if (filter === "all") return true;
        if (filter === "in-progress") return normalizedStatus !== "complete" && progress.completed < progress.total;
        return normalizedStatus === filter;
      });

      if (lastPlanList.length === 0) {
        ctx.ui.notify(`No ${filter} plans found in ${storage.path}.`, "info");
        return;
      }

      const lines = lastPlanList.map((plan, index) => {
        const progress = planSummaryProgress(plan);
        const next = progress.next ? `${progress.next.step}. ${truncateText(progress.next.text, 64)}` : "all steps complete";
        return `${index + 1}. ${plan.title}\n   Status: ${plan.status} | Progress: ${progress.completed}/${progress.total}\n   Next: ${next}\n   Path: ${plan.path}`;
      });
      ctx.ui.notify(`Plans (${filter}):\n\n${lines.join("\n\n")}\n\nOpen with: /plan-open <number|path>`, "info");
    },
  });

  pi.registerCommand("plan-open", {
    description: "Open a saved plan from /plan-list by number, or from a .plan.md path",
    handler: async (args, ctx) => {
      const target = args.trim();
      if (!target) {
        ctx.ui.notify("Usage: /plan-open <number|path>", "warning");
        return;
      }

      const index = /^\d+$/.test(target) ? Number(target) - 1 : -1;
      const path = index >= 0 ? lastPlanList[index]?.path : resolve(ctx.cwd, expandHome(target.replace(/^@/, "")));
      if (!path) {
        ctx.ui.notify("No plan found for that list number. Run /plan-list first.", "warning");
        return;
      }

      const plan = await parsePlanDocument(path);
      if (!plan || plan.todos.length === 0) {
        ctx.ui.notify(`Could not read a valid plan document: ${path}`, "warning");
        return;
      }

      state = {
        todos: plan.todos,
        rawPlan: plan.approvedPlan,
        approvedPlan: plan.approvedPlan,
        title: plan.title,
        savedPath: plan.path,
        executionMode: plan.status.toLowerCase() !== "draft" && plan.status.toLowerCase() !== "complete",
      };
      persist();
      renderWidget(ctx, state, widgetMode);
      const progress = planSummaryProgress(plan);
      ctx.ui.notify(
        `Opened plan: ${plan.title}\nProgress: ${progress.completed}/${progress.total}\nNext: ${progress.next ? `${progress.next.step}. ${progress.next.text}` : "all steps complete"}`,
        "info",
      );
      pi.events.emit("plan:opened", { path: plan.path, todos: [...state.todos] });
    },
  });

  pi.registerCommand("plan-widget-mode", {
    description: "Show or temporarily set plan widget mode: compact, summary, full, hidden",
    handler: async (args, ctx) => {
      const requested = args.trim();
      if (requested) {
        if (requested !== "compact" && requested !== "summary" && requested !== "full" && requested !== "hidden") {
          ctx.ui.notify("Usage: /plan-widget-mode [compact|summary|full|hidden]", "warning");
          return;
        }
        widgetMode = requested;
        renderWidget(ctx, state, widgetMode);
      }
      ctx.ui.notify(`Plan widget mode: ${widgetMode}\nPersist by setting planWidgetMode in .pi/settings.json or ~/.pi/agent/settings.json.`, "info");
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
      const next = getNextIncompleteTodo(state);
      ctx.ui.notify(
        `Plan todos:\n${lines}\n\nNext: ${next ? `${next.step}. ${next.text}` : "all steps complete"}${state.savedPath ? `\nPlan document: ${state.savedPath}` : ""}`,
        "info",
      );
    },
  });

  pi.registerCommand("plan-status", {
    description: "Show durable execution progress for the approved plan",
    handler: async (_args, ctx) => {
      if (state.todos.length === 0) {
        ctx.ui.notify("No parsed plan todos yet. Use /plan or ask for a numbered Plan: section.", "info");
        return;
      }
      const completedTodos = state.todos.filter((todo) => todo.completed);
      const remainingTodos = state.todos.filter((todo) => !todo.completed);
      const next = remainingTodos[0];
      const completedPreview = completedTodos.slice(-5).map((todo) => formatTodoLine(todo)).join("\n") || "none";
      const remainingPreview = remainingTodos.slice(next ? 1 : 0, next ? 6 : 5).map((todo) => formatTodoLine(todo)).join("\n") || "none";
      ctx.ui.notify(
        `Plan progress: ${completedTodos.length}/${state.todos.length}\n\nRecently completed:\n${completedPreview}\n\nNext:\n${next ? formatTodoLine(next) : "all steps complete"}\n\nRemaining:\n${remainingPreview}${state.savedPath ? `\n\nPlan document: ${state.savedPath}` : ""}`,
        "info",
      );
    },
  });

  pi.registerCommand("plan-current", {
    description: "Show the current/next plan step and resume hint",
    handler: async (_args, ctx) => {
      if (state.todos.length === 0) {
        ctx.ui.notify("No parsed plan todos yet. Use /plan or ask for a numbered Plan: section.", "info");
        return;
      }
      const completed = state.todos.filter((todo) => todo.completed).length;
      const next = getNextIncompleteTodo(state);
      ctx.ui.notify(
        next
          ? `Current plan step:\n${next.step}. ${next.text}\n\nProgress: ${completed}/${state.todos.length}\nResume with: /plan-next`
          : `All plan steps are complete.\n\nProgress: ${completed}/${state.todos.length}`,
        "info",
      );
    },
  });

  pi.registerCommand("plan-resume", {
    description: "Resume the approved plan from the first incomplete step",
    handler: async (_args, ctx) => {
      if (state.todos.length === 0 || !state.approvedPlan) {
        ctx.ui.notify("No approved plan is available to resume.", "warning");
        return;
      }
      const next = getNextIncompleteTodo(state);
      if (!next) {
        ctx.ui.notify("All plan steps are already complete.", "info");
        return;
      }
      await ctx.waitForIdle();
      state = { ...state, executionMode: true };
      persist();
      pi.sendUserMessage(buildResumePrompt(state), { deliverAs: "followUp" });
    },
  });

  pi.registerCommand("plan-next", {
    description: "Alias for /plan-resume",
    handler: async (_args, ctx) => {
      if (state.todos.length === 0 || !state.approvedPlan) {
        ctx.ui.notify("No approved plan is available to resume.", "warning");
        return;
      }
      const next = getNextIncompleteTodo(state);
      if (!next) {
        ctx.ui.notify("All plan steps are already complete.", "info");
        return;
      }
      await ctx.waitForIdle();
      state = { ...state, executionMode: true };
      persist();
      pi.sendUserMessage(buildResumePrompt(state), { deliverAs: "followUp" });
    },
  });

  pi.registerCommand("plan-clear", {
    description: "Clear the latest parsed plan todos and reset plan state",
    handler: async (_args, ctx) => {
      state = { todos: [] };
      persist();
      renderWidget(ctx, state, widgetMode);
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
      await ensureApprovedPlanDocument(ctx);
      await startImplementationSession(ctx);
    },
  });

  pi.registerCommand("plan-cancel", {
    description: "Cancel plan execution tracking and clear plan state",
    handler: async (_args, ctx) => {
      state = { todos: [] };
      persist();
      renderWidget(ctx, state, widgetMode);
      ctx.ui.notify("Plan execution cancelled", "info");
      pi.events.emit("plan:cleared");
    },
  });
}
