import {
  CustomEditor,
  type ExtensionAPI,
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

const EXTENSION_NAME = "pi-cockpit";
const DEFAULT_TITLE = "";
const SEGMENT_SEPARATOR = " │ ";

function getTitle(state: CockpitState): string {
  return state.manualTitle || state.autoTitle || "";
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
  ) {
    super(tui, editorTheme, keybindings, { paddingX: 2 });
  }

  override setPaddingX(_padding: number) {
    // Always enforce our padding, ignore core overrides
    super.setPaddingX(2);
  }

  private currentBorderColor(): (s: string) => string {
    const text = this.getText().trimStart();
    if (text.startsWith("!")) return this.appTheme.getBashModeBorderColor();
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
  let currentCtx: any;
  let unsubscribeUsage: (() => void) | undefined;

  pi.registerFlag("cockpit-icons", {
    description: "Pi Cockpit icon style: nerd, unicode, or none",
    type: "string",
    default: "nerd",
  });

  const getIconStyle = () => normalizeIconStyle(pi.getFlag("cockpit-icons"));
  const getThinkingLevel = () => pi.getThinkingLevel?.();

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
      new CockpitFooter(tui, theme, footerData, () => currentCtx, () => state, getIconStyle, getThinkingLevel),
    );

    ctx.ui.setEditorComponent((tui: TUI, editorTheme: EditorTheme, keybindings: KeybindingsManager) =>
      new CockpitEditor(tui, editorTheme, keybindings, ctx.ui.theme, () => getTitle(state), getThinkingLevel),
    );
  }

  unsubscribeUsage = pi.events.on("usage:update", (data: unknown) => {
    if (data && typeof data === "object") {
      state.usage = data as UsageUpdate;
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    installUi(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    unsubscribeUsage?.();
    unsubscribeUsage = undefined;
    resetGitCache();

    if (ctx?.hasUI) {
      ctx.ui.setFooter(undefined);
      ctx.ui.setEditorComponent(undefined);
      ctx.ui.setWorkingIndicator();
    }
  });

  pi.on("before_agent_start", async (event, ctx) => {
    currentCtx = ctx;

    if (!state.manualTitle && !state.titleCleared && !state.autoTitle) {
      state.autoTitle = summarizePrompt(event.prompt ?? "");
    }
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
