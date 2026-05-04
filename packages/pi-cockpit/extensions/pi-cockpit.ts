import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
  type ReadonlyFooterDataProvider,
  type Theme,
} from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth, type Component, type EditorTheme, type TUI } from "@mariozechner/pi-tui";
import { type IconStyle, getIcons, normalizeIconStyle } from "./icons.ts";
import { formatGitInfo, getGitInfo, resetGitCache, setGitUpdateCallback } from "./git.ts";
import {
  clampPercent,
  colorForPercent,
  formatCost,
  formatModelName,
  formatTokens,
  kebabCaseTitle,
  percentBar,
  providerLabel,
  sanitizeOneLine,
  summarizePrompt,
  thinkingColor,
} from "./format.ts";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

type UsageUpdate = {
  provider?: string;
  label?: string;
  session?: number;
  weekly?: number;
  sessionResetsIn?: string;
  weeklyResetsIn?: string;
};

type CockpitState = {
  manualTitle?: string;
  autoTitle: string;
  titleCleared?: boolean;
  usage?: UsageUpdate;
};

type CockpitMode = {
  id: string;
  label: string;
  icon?: string;
  description?: string;
  order?: number;
  onEnter?: (ctx: ExtensionContext) => void | Promise<void>;
  onExit?: (ctx: ExtensionContext) => void | Promise<void>;
  getFooterSegments?: (ctx: ExtensionContext) => string[];
  getStatusText?: (ctx: ExtensionContext) => string | undefined;
  onInput?: (event: any, ctx: ExtensionContext) => any | Promise<any>;
  beforeAgentStart?: (event: any, ctx: ExtensionContext) => any | Promise<any>;
};

const EXTENSION_NAME = "pi-cockpit";
const DEFAULT_TITLE = "";
const SEGMENT_SEPARATOR = " │ ";
const MODE_STATE_ENTRY = "cockpit-mode";
const EDIT_MODE: CockpitMode = {
  id: "edit",
  label: "Edit",
  description: "Normal Pi editing mode",
  order: 0,
};

function getTitle(state: CockpitState): string {
  return state.manualTitle || state.autoTitle || "";
}

function isCockpitMode(value: unknown): value is CockpitMode {
  if (!value || typeof value !== "object") return false;
  const mode = value as CockpitMode;
  return typeof mode.id === "string" && mode.id.trim().length > 0 && typeof mode.label === "string" && mode.label.trim().length > 0;
}

function formatMode(mode: CockpitMode, ctx?: ExtensionContext): string {
  const status = ctx ? mode.getStatusText?.(ctx) : undefined;
  if (status) return sanitizeOneLine(status);
  return sanitizeOneLine(mode.label.toLowerCase());
}

function sortedModes(modes: Map<string, CockpitMode>): CockpitMode[] {
  return [...modes.values()].sort((a, b) => (a.order ?? 1000) - (b.order ?? 1000) || a.label.localeCompare(b.label));
}

function getSessionTotals(ctx: any): { input: number; output: number; cost: number } {
  let input = 0;
  let output = 0;
  let cost = 0;

  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry?.type !== "message" || entry.message?.role !== "assistant") continue;
    input += entry.message.usage?.input ?? 0;
    output += entry.message.usage?.output ?? 0;
    cost += entry.message.usage?.cost?.total ?? 0;
  }

  return { input, output, cost };
}

function buildTitleLine(width: number, title: string, theme: Theme, borderColor: (s: string) => string): string {
  if (width <= 0) return "";
  if (width < 8) return borderColor("─".repeat(width));

  const rawTitle = sanitizeOneLine(title);
  if (!rawTitle) return borderColor("─".repeat(width));

  const cleanTitle = truncateToWidth(rawTitle, Math.max(1, width - 4), "…");
  const titlePrefix = " ";
  const paddedTitle = ` ${cleanTitle} `;
  const titleSuffix = " ─";
  const used = visibleWidth(titlePrefix) + visibleWidth(paddedTitle) + visibleWidth(titleSuffix);
  const leadingRule = "─".repeat(Math.max(0, width - used));
  const titleText = theme.inverse(theme.fg("accent", theme.bold(paddedTitle)));
  return borderColor(leadingRule + titlePrefix) + titleText + borderColor(titleSuffix);
}

function fitSegments(segments: string[], width: number): string {
  const kept: string[] = [];
  for (const segment of segments) {
    if (!segment) continue;
    const next = [...kept, segment].join(SEGMENT_SEPARATOR);
    if (visibleWidth(next) <= width) kept.push(segment);
  }

  if (kept.length === 0) return "";
  return truncateToWidth(kept.join(SEGMENT_SEPARATOR), width, "…");
}

function fitSplitSegments(leftSegments: string[], rightSegments: string[], width: number): string {
  const right = fitSegments(rightSegments, Math.max(0, Math.floor(width * 0.4)));
  const rightWidth = visibleWidth(right);

  if (!right) return fitSegments(leftSegments, width);
  if (rightWidth >= width - 4) return truncateToWidth(right, width, "…");

  const gap = 2;
  const leftWidth = Math.max(0, width - rightWidth - gap);
  const left = fitSegments(leftSegments, leftWidth);
  const padding = " ".repeat(Math.max(gap, width - visibleWidth(left) - rightWidth));
  return `${left}${padding}${right}`;
}

class CockpitFooter implements Component {
  private unsubBranch?: () => void;

  constructor(
    private tui: TUI,
    private theme: Theme,
    private footerData: ReadonlyFooterDataProvider,
    private getCtx: () => any,
    private getState: () => CockpitState,
    private getIconStyle: () => IconStyle,
    private getThinkingLevel: () => ThinkingLevel | string | undefined,
    private getActiveMode: () => CockpitMode,
  ) {
    this.unsubBranch = footerData.onBranchChange(() => this.tui.requestRender());
    setGitUpdateCallback(() => this.tui.requestRender());
  }

  invalidate(): void {}

  dispose(): void {
    this.unsubBranch?.();
  }

  render(width: number): string[] {
    const ctx = this.getCtx();
    const state = this.getState();
    const icons = getIcons(this.getIconStyle());
    const leftSegments: string[] = [];
    const rightSegments: string[] = [];

    const icon = (text: string) => this.theme.fg("borderAccent", text);
    const loading = icon(icons.loading);
    const activeMode = this.getActiveMode();
    leftSegments.push(activeMode.id === "edit" ? this.theme.fg("text", formatMode(activeMode, ctx)) : this.theme.fg("accent", formatMode(activeMode, ctx)));
    if (ctx) {
      for (const segment of activeMode.getFooterSegments?.(ctx) ?? []) {
        if (segment) leftSegments.push(sanitizeOneLine(segment));
      }
    }

    const contextUsage = ctx?.getContextUsage?.();
    if (contextUsage) {
      const percent = contextUsage.percent == null ? undefined : Number(contextUsage.percent);
      const contextText = percent == null
        ? `${icons.loading} --% ${percentBar(0)}`
        : `${Math.round(percent)}% ${percentBar(percent)}`;
      const color = percent == null ? "muted" : colorForPercent(percent);
      leftSegments.push(`${icon(icons.context)} ${this.theme.fg(color, contextText)}`);
    } else {
      leftSegments.push(`${icon(icons.context)} ${loading} --% ${this.theme.fg("dim", percentBar(0))}`);
    }

    const usage = state.usage;
    if (usage?.session != null) {
      const session = clampPercent(usage.session);
      const provider = usage.label || providerLabel(usage.provider || ctx?.model?.provider);
      const reset = usage.sessionResetsIn ? ` ${icon(icons.reset)} ${usage.sessionResetsIn}` : ` ${icon(icons.reset)} --`;
      const weekly = usage.weekly != null
        ? `${icon(" W ")}${this.theme.fg(colorForPercent(clampPercent(usage.weekly)), `${clampPercent(usage.weekly)}%`)}`
        : "";
      leftSegments.push(
        `${icon(icons.usage)} ${provider} ${icon("S")} ${this.theme.fg(colorForPercent(session), `${session}%`)}${reset}${weekly}`,
      );
    } else {
      const provider = providerLabel(ctx?.model?.provider);
      leftSegments.push(`${icon(icons.usage)} ${provider} ${icon("S")} ${loading}--% ${icon(icons.reset)} --`);
    }

    const modelName = formatModelName(ctx?.model);
    const effort = this.getThinkingLevel?.() ?? "off";
    const effortText = this.theme.fg(thinkingColor(effort), String(effort));
    leftSegments.push(`${icon(icons.model)} ${modelName} · ${effortText}`);

    const gitInfo = getGitInfo(ctx?.cwd);
    if (gitInfo) {
      rightSegments.push(formatGitInfo(gitInfo, icons, this.theme, icon));
    } else {
      const branch = this.footerData.getGitBranch();
      if (branch) rightSegments.push(`${icon(icons.branch)} ${branch}`);
    }

    const statuses = Array.from(this.footerData.getExtensionStatuses().entries())
      .filter(([key]) => key !== "usage-bars" && key !== EXTENSION_NAME)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, value]) => sanitizeOneLine(value));
    if (statuses.length) leftSegments.push(this.theme.fg("dim", statuses.join(" ")));

    const totals = getSessionTotals(ctx);
    if (totals.input || totals.output || totals.cost) {
      leftSegments.push(
        this.theme.fg(
          "text",
          `${icons.tokens ? `${icons.tokens} ` : ""}↑${formatTokens(totals.input)} ↓${formatTokens(totals.output)} ${formatCost(totals.cost)}`,
        ),
      );
    }

    return [` ${fitSplitSegments(leftSegments, rightSegments, width - 2)} `, ""];
  }
}

class CockpitEditor extends CustomEditor {
  constructor(
    tui: TUI,
    editorTheme: EditorTheme,
    keybindings: KeybindingsManager,
    private appTheme: Theme,
    private getTitle: () => string,
    private getThinkingLevel: () => ThinkingLevel | string | undefined,
    private getActiveMode: () => CockpitMode,
  ) {
    super(tui, editorTheme, keybindings, { paddingX: 2 });
  }

  override setPaddingX(_padding: number) {
    // Always enforce our padding, ignore core overrides
    super.setPaddingX(2);
  }

  private currentBorderColor(): (s: string) => string {
    const text = this.getText().trimStart();
    const mode = this.getActiveMode();
    if (mode.id === "terminal" || text.startsWith("!")) return this.appTheme.getBashModeBorderColor();
    if (mode.id === "plan") return (s: string) => this.appTheme.fg("warning", s);
    return (s: string) => this.appTheme.fg("muted", s);
  }

  render(width: number): string[] {
    this.borderColor = this.currentBorderColor();
    const lines = super.render(width);
    if (!lines.length) return lines;

    lines[0] = buildTitleLine(width, this.getTitle(), this.appTheme, this.borderColor);
    return lines;
  }
}

export default function (pi: ExtensionAPI) {
  const state: CockpitState = { autoTitle: DEFAULT_TITLE };
  const modes = new Map<string, CockpitMode>([[EDIT_MODE.id, EDIT_MODE]]);
  let activeModeId = EDIT_MODE.id;
  let pendingRestoreModeId: string | undefined;
  let currentCtx: any;
  let unsubscribeUsage: (() => void) | undefined;
  let unsubscribeModeRegister: (() => void) | undefined;
  let unsubscribeModeSwitch: (() => void) | undefined;
  let unsubscribeModeNext: (() => void) | undefined;

  pi.registerFlag("cockpit-icons", {
    description: "Pi Cockpit icon style: nerd, unicode, or none",
    type: "string",
    default: "nerd",
  });

  const getIconStyle = () => normalizeIconStyle(pi.getFlag("cockpit-icons"));
  const getThinkingLevel = () => pi.getThinkingLevel?.();
  const getActiveMode = () => modes.get(activeModeId) ?? EDIT_MODE;

  function persistMode(): void {
    pi.appendEntry(MODE_STATE_ENTRY, { activeMode: activeModeId });
  }

  function updateModeUi(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    // The active mode is rendered by the Cockpit footer itself. Clear any
    // previous status entry to avoid duplicate mode labels in the status bar.
    ctx.ui.setStatus("pi-cockpit-mode", undefined);
  }

  function registerMode(mode: CockpitMode): void {
    if (!isCockpitMode(mode)) {
      currentCtx?.ui?.notify?.("Ignored invalid cockpit mode registration", "warning");
      return;
    }

    const normalized = { ...mode, id: mode.id.trim(), label: mode.label.trim() };
    modes.set(normalized.id, normalized);

    if (pendingRestoreModeId === normalized.id && currentCtx) {
      pendingRestoreModeId = undefined;
      void switchMode(currentCtx, normalized.id, { persist: false, notify: false });
    }
  }

  async function switchMode(ctx: ExtensionContext, targetModeId: string, options: { persist?: boolean; notify?: boolean } = {}): Promise<boolean> {
    const target = modes.get(targetModeId);
    if (!target) {
      ctx.ui.notify(`Unknown cockpit mode: ${targetModeId}. Available: ${sortedModes(modes).map((m) => m.id).join(", ")}`, "warning");
      return false;
    }

    const previousId = activeModeId;
    if (previousId === target.id) {
      updateModeUi(ctx);
      return true;
    }

    const previous = getActiveMode();
    try {
      await previous.onExit?.(ctx);
    } catch (error) {
      ctx.ui.notify(`Cockpit mode ${previous.id} exit failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
    }

    activeModeId = target.id;
    try {
      await target.onEnter?.(ctx);
    } catch (error) {
      activeModeId = previousId;
      ctx.ui.notify(`Cockpit mode ${target.id} enter failed: ${error instanceof Error ? error.message : String(error)}`, "error");
      try {
        await previous.onEnter?.(ctx);
      } catch {
        // Best-effort restore only.
      }
      updateModeUi(ctx);
      return false;
    }

    if (options.persist !== false) persistMode();
    updateModeUi(ctx);
    pi.events.emit("cockpit:mode:changed", { previousMode: previousId, activeMode: activeModeId });
    if (options.notify !== false) ctx.ui.notify(`Cockpit mode: ${formatMode(target, ctx)}`, "info");
    return true;
  }

  async function switchToNextMode(ctx: ExtensionContext): Promise<void> {
    const ordered = sortedModes(modes);
    const index = Math.max(0, ordered.findIndex((mode) => mode.id === activeModeId));
    const next = ordered[(index + 1) % ordered.length] ?? EDIT_MODE;
    await switchMode(ctx, next.id);
  }

  async function restoreModeFromSession(ctx: ExtensionContext): Promise<void> {
    const entries = ctx.sessionManager.getEntries();
    const modeEntry = entries
      .filter((entry: any) => entry?.type === "custom" && entry.customType === MODE_STATE_ENTRY)
      .pop() as { data?: { activeMode?: string } } | undefined;
    const restored = modeEntry?.data?.activeMode;
    if (!restored || restored === EDIT_MODE.id) {
      activeModeId = EDIT_MODE.id;
      pendingRestoreModeId = undefined;
      return;
    }
    if (modes.has(restored)) {
      await switchMode(ctx, restored, { persist: false, notify: false });
    } else {
      activeModeId = EDIT_MODE.id;
      pendingRestoreModeId = restored;
    }
  }

  function installUi(ctx: any) {
    if (!ctx?.hasUI) return;
    currentCtx = ctx;

    ctx.ui.setWorkingIndicator({
      frames: [
        ctx.ui.theme.fg("dim", "·"),
        ctx.ui.theme.fg("muted", "•"),
        ctx.ui.theme.fg("accent", "●"),
        ctx.ui.theme.fg("muted", "•"),
      ],
      intervalMs: 120,
    });

    ctx.ui.setFooter((tui: TUI, theme: Theme, footerData: ReadonlyFooterDataProvider) =>
      new CockpitFooter(tui, theme, footerData, () => currentCtx, () => state, getIconStyle, getThinkingLevel, getActiveMode),
    );

    ctx.ui.setEditorComponent((tui: TUI, editorTheme: EditorTheme, keybindings: KeybindingsManager) =>
      new CockpitEditor(tui, editorTheme, keybindings, ctx.ui.theme, () => getTitle(state), getThinkingLevel, getActiveMode),
    );

    updateModeUi(ctx);
  }

  function formatModeList(ctx: ExtensionContext): string {
    return sortedModes(modes)
      .map((mode) => `${mode.id === activeModeId ? "*" : " "} ${formatMode(mode, ctx)} (${mode.id})${mode.description ? ` - ${mode.description}` : ""}`)
      .join("\n");
  }

  registerMode(EDIT_MODE);

  unsubscribeModeRegister = pi.events.on("cockpit:mode:register", (mode: unknown) => {
    registerMode(mode as CockpitMode);
    if (currentCtx) updateModeUi(currentCtx);
  });

  unsubscribeModeSwitch = pi.events.on("cockpit:mode:switch", (data: unknown) => {
    const id = typeof data === "string" ? data : (data as { id?: unknown } | undefined)?.id;
    if (typeof id !== "string") return;
    if (currentCtx) void switchMode(currentCtx, id);
    else if (modes.has(id)) activeModeId = id;
  });

  unsubscribeModeNext = pi.events.on("cockpit:mode:next", () => {
    if (currentCtx) void switchToNextMode(currentCtx);
  });

  unsubscribeUsage = pi.events.on("usage:update", (data: unknown) => {
    if (data && typeof data === "object") {
      state.usage = data as UsageUpdate;
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    installUi(ctx);
    await restoreModeFromSession(ctx);
    updateModeUi(ctx);
    pi.events.emit("cockpit:ready", { activeMode: activeModeId, modes: sortedModes(modes).map((mode) => mode.id) });
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    unsubscribeUsage?.();
    unsubscribeUsage = undefined;
    unsubscribeModeRegister?.();
    unsubscribeModeRegister = undefined;
    unsubscribeModeSwitch?.();
    unsubscribeModeSwitch = undefined;
    unsubscribeModeNext?.();
    unsubscribeModeNext = undefined;
    resetGitCache();

    if (ctx?.hasUI) {
      ctx.ui.setFooter(undefined);
      ctx.ui.setEditorComponent(undefined);
      ctx.ui.setWorkingIndicator();
    }
  });

  pi.on("input", async (event, ctx) => {
    currentCtx = ctx;
    return getActiveMode().onInput?.(event, ctx);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    currentCtx = ctx;

    if (!state.manualTitle && !state.titleCleared && !state.autoTitle) {
      state.autoTitle = summarizePrompt(event.prompt ?? "");
    }

    return getActiveMode().beforeAgentStart?.(event, ctx);
  });

  pi.on("turn_start", async (_event, ctx) => {
    currentCtx = ctx;
  });

  pi.on("message_end", async (_event, ctx) => {
    currentCtx = ctx;
  });

  pi.on("model_select", async (_event, ctx) => {
    currentCtx = ctx;
  });

  pi.on("thinking_level_select", async (_event, ctx) => {
    currentCtx = ctx;
  });

  pi.registerShortcut("shift+tab", {
    description: "Cycle cockpit mode",
    handler: async (ctx) => {
      currentCtx = ctx;
      await switchToNextMode(ctx);
    },
  });

  pi.registerCommand("mode", {
    description: "Show or switch Pi Cockpit modes",
    getArgumentCompletions: (prefix: string) => {
      const values = ["list", "status", "next", ...sortedModes(modes).map((mode) => mode.id)];
      return values
        .filter((value) => value.startsWith(prefix.trim()))
        .map((value) => ({ value, label: value }));
    },
    handler: async (args, ctx) => {
      currentCtx = ctx;
      const value = args.trim();

      if (!value) {
        const labels = new Map<string, string>();
        const choices = sortedModes(modes).map((mode) => {
          const label = `${formatMode(mode, ctx)} (${mode.id})${mode.description ? ` - ${mode.description}` : ""}`;
          labels.set(label, mode.id);
          return label;
        });
        const selected = await ctx.ui.select("Cockpit mode", choices);
        if (selected) await switchMode(ctx, labels.get(selected) ?? selected);
        return;
      }

      if (value === "list") {
        ctx.ui.notify(`Cockpit modes:\n${formatModeList(ctx)}`, "info");
        return;
      }

      if (value === "status") {
        ctx.ui.notify(`Cockpit mode: ${formatMode(getActiveMode(), ctx)}`, "info");
        return;
      }

      if (value === "next") {
        await switchToNextMode(ctx);
        return;
      }

      await switchMode(ctx, value);
    },
  });

  pi.registerCommand("effort", {
    description: "Show, cycle, or set model effort/thinking level",
    getArgumentCompletions: (prefix: string) => {
      const values = ["status", "next", ...THINKING_LEVELS];
      return values
        .filter((value) => value.startsWith(prefix.trim()))
        .map((value) => ({ value, label: value }));
    },
    handler: async (args, ctx) => {
      const value = args.trim().toLowerCase();
      const current = (pi.getThinkingLevel?.() ?? "off") as ThinkingLevel;

      if (!value || value === "status") {
        ctx.ui.notify(`Effort: ${current}`, "info");
        return;
      }

      if (value === "next") {
        const index = THINKING_LEVELS.indexOf(current);
        const next = THINKING_LEVELS[(index + 1) % THINKING_LEVELS.length] ?? "off";
        pi.setThinkingLevel?.(next);
        ctx.ui.notify(`Effort: ${next}`, "info");
        return;
      }

      if (!THINKING_LEVELS.includes(value as ThinkingLevel)) {
        ctx.ui.notify(`Unknown effort: ${value}. Use: status, next, ${THINKING_LEVELS.join(", ")}`, "warning");
        return;
      }

      pi.setThinkingLevel?.(value as ThinkingLevel);
      ctx.ui.notify(`Effort: ${value}`, "info");
    },
  });

  pi.registerCommand("session-title", {
    description: "Set or clear the Pi Cockpit editor title",
    handler: async (args, ctx) => {
      const value = args.trim();
      if (value === "--clear") {
        state.manualTitle = undefined;
        state.autoTitle = "";
        state.titleCleared = true;
        ctx.ui.notify("Pi Cockpit title cleared", "info");
        return;
      }

      if (!value) {
        ctx.ui.notify(`Pi Cockpit title: ${getTitle(state)}`, "info");
        return;
      }

      state.manualTitle = truncateToWidth(kebabCaseTitle(value), 80, "…");
      state.titleCleared = false;
      ctx.ui.notify("Pi Cockpit title updated", "info");
    },
  });
}
