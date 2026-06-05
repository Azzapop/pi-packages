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
  readUsage,
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

// ── Persona contract ────────────────────────────────────────────────────────
//
// A persona injects role-specific context into the system prompt for every
// turn while it is active, and is automatically *not* injected when another
// persona (or the default) is active. Switching personas swaps context with
// no residue because the system prompt is rebuilt every turn.
//
// Satellite packages (e.g. pi-personas) register personas by emitting
// `cockpit:persona:register` with a Persona object.

export type Persona = {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  order?: number;

  // Appended to the system prompt every turn while this persona is active.
  // Returning empty string or undefined skips injection.
  systemPrompt?: string | ((ctx: ExtensionContext) => string | Promise<string | undefined>) | undefined;

  // Optional editor border tint while active.
  borderColor?: (theme: Theme) => (s: string) => string;

  // Optional tool allowlist; snapshot+restore on enter/exit.
  tools?: string[];

  // Footer hooks.
  getFooterSegments?: (ctx: ExtensionContext) => string[];
  getStatusText?: (ctx: ExtensionContext) => string | undefined;

  // Lifecycle hooks.
  onEnter?: (ctx: ExtensionContext) => void | Promise<void>;
  onExit?: (ctx: ExtensionContext) => void | Promise<void>;
  onInput?: (event: any, ctx: ExtensionContext) => any | Promise<any>;
  beforeAgentStart?: (event: any, ctx: ExtensionContext) => any | Promise<any>;
};

const EXTENSION_NAME = "pi-cockpit";
const DEFAULT_TITLE = "";
const SEGMENT_SEPARATOR = " │ ";
const PERSONA_STATE_ENTRY = "cockpit-persona";
const DEFAULT_PERSONA: Persona = {
  id: "default",
  label: "Default",
  description: "No persona context — standard Pi behavior",
  order: 0,
};

function getTitle(state: CockpitState): string {
  return state.manualTitle || state.autoTitle || "";
}

function isPersona(value: unknown): value is Persona {
  if (!value || typeof value !== "object") return false;
  const persona = value as Persona;
  return (
    typeof persona.id === "string" &&
    persona.id.trim().length > 0 &&
    typeof persona.label === "string" &&
    persona.label.trim().length > 0
  );
}

function formatPersona(persona: Persona, ctx?: ExtensionContext): string {
  const status = ctx ? persona.getStatusText?.(ctx) : undefined;
  if (status) return sanitizeOneLine(status);
  return sanitizeOneLine(persona.label.toLowerCase());
}

function sortedPersonas(personas: Map<string, Persona>): Persona[] {
  return [...personas.values()].sort(
    (a, b) => (a.order ?? 1000) - (b.order ?? 1000) || a.label.localeCompare(b.label),
  );
}

// Sum per-message usage across the session. pi-coding-agent normalizes
// adapters (including amazon-bedrock) to
// { input, output, cacheRead, cacheWrite, cost: { total } }; readUsage adds
// defensive coalescing for third-party adapters that might use
// provider-native field names. Cost is intentionally not synthesized when
// absent — pricing belongs in the adapter, not the statusline.
function getSessionTotals(ctx: any): {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
} {
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };

  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry?.type !== "message" || entry.message?.role !== "assistant") continue;
    const u = readUsage(entry.message.usage);
    totals.input += u.input;
    totals.output += u.output;
    totals.cacheRead += u.cacheRead;
    totals.cacheWrite += u.cacheWrite;
    totals.cost += u.cost;
  }

  return totals;
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
    private getActivePersona: () => Persona,
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
    const activePersona = this.getActivePersona();
    leftSegments.push(
      activePersona.id === DEFAULT_PERSONA.id
        ? this.theme.fg("text", formatPersona(activePersona, ctx))
        : this.theme.fg("accent", formatPersona(activePersona, ctx)),
    );
    if (ctx) {
      for (const segment of activePersona.getFooterSegments?.(ctx) ?? []) {
        if (segment) leftSegments.push(sanitizeOneLine(segment));
      }
    }

    const contextUsage = ctx?.getContextUsage?.();
    if (contextUsage?.percent != null) {
      const percent = Number(contextUsage.percent);
      const contextText = `${Math.round(percent)}% ${percentBar(percent)}`;
      leftSegments.push(`${icon(icons.context)} ${this.theme.fg(colorForPercent(percent), contextText)}`);
    } else {
      leftSegments.push(`${icon(icons.context)} ${this.theme.fg("dim", `--% ${percentBar(0)}`)}`);
    }

    // Subscription gauge: rendered only when usage data is present
    // (emitted by pi-usage-bars for providers with session/weekly quotas).
    // Pay-per-token providers (amazon-bedrock, openai, google-vertex, …)
    // never populate this, so the segment stays hidden rather than
    // showing a misleading placeholder.
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
    if (totals.input || totals.output || totals.cost || totals.cacheRead) {
      const prefix = icons.tokens ? `${icons.tokens} ` : "";
      const tokens = `↑${formatTokens(totals.input)} ↓${formatTokens(totals.output)}`;
      const cache = totals.cacheRead > 0 ? ` ${icons.cache}${formatTokens(totals.cacheRead)}` : "";
      const cost = totals.cost > 0 ? ` ${formatCost(totals.cost)}` : "";
      leftSegments.push(this.theme.fg("text", `${prefix}${tokens}${cache}${cost}`));
    }

    return [` ${fitSplitSegments(leftSegments, rightSegments, width - 2)} `, ""];
  }
}

class CockpitEditor extends CustomEditor {
  private personaBorderColor: (s: string) => string;

  constructor(
    tui: TUI,
    editorTheme: EditorTheme,
    keybindings: KeybindingsManager,
    private appTheme: Theme,
    private getTitle: () => string,
    private getThinkingLevel: () => ThinkingLevel | string | undefined,
    private getActivePersona: () => Persona,
  ) {
    super(tui, editorTheme, keybindings, { paddingX: 2 });
    this.personaBorderColor = (s: string) => this.appTheme.fg("muted", s);
    this.borderColor = this.personaBorderColor;
  }

  override setPaddingX(_padding: number) {
    // Always enforce our padding, ignore core overrides
    super.setPaddingX(2);
  }

  private updateBorderColor(): void {
    const text = this.getText().trimStart();
    const persona = this.getActivePersona();
    if (text.startsWith("!")) {
      this.personaBorderColor = this.appTheme.getBashModeBorderColor();
    } else {
      const fromPersona = persona.borderColor?.(this.appTheme);
      this.personaBorderColor = fromPersona ?? ((s: string) => this.appTheme.fg("muted", s));
    }
    this.borderColor = this.personaBorderColor;
  }

  override invalidate(): void {
    this.borderColor = this.personaBorderColor;
    super.invalidate();
  }

  render(width: number): string[] {
    this.updateBorderColor();
    const lines = super.render(width);
    if (!lines.length) return lines;

    lines[0] = buildTitleLine(width, this.getTitle(), this.appTheme, this.borderColor);
    return lines;
  }
}

export default function (pi: ExtensionAPI) {
  const state: CockpitState = { autoTitle: DEFAULT_TITLE };
  const personas = new Map<string, Persona>([[DEFAULT_PERSONA.id, DEFAULT_PERSONA]]);
  let activePersonaId = DEFAULT_PERSONA.id;
  let pendingRestorePersonaId: string | undefined;
  let previousToolsSnapshot: string[] | undefined;
  let currentCtx: any;
  let unsubscribeUsage: (() => void) | undefined;
  let unsubscribePersonaRegister: (() => void) | undefined;
  let unsubscribePersonaSwitch: (() => void) | undefined;
  let unsubscribePersonaNext: (() => void) | undefined;

  pi.registerFlag("cockpit-icons", {
    description: "Pi Cockpit icon style: nerd, unicode, or none",
    type: "string",
    default: "nerd",
  });

  const getIconStyle = () => normalizeIconStyle(pi.getFlag("cockpit-icons"));
  const getThinkingLevel = () => pi.getThinkingLevel?.();
  const getActivePersona = () => personas.get(activePersonaId) ?? DEFAULT_PERSONA;

  function persistPersona(): void {
    pi.appendEntry(PERSONA_STATE_ENTRY, { activePersona: activePersonaId });
  }

  function updatePersonaUi(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    // The active persona is rendered by the Cockpit footer itself. Clear any
    // previous status entry to avoid duplicate persona labels in the status bar.
    ctx.ui.setStatus("pi-cockpit-persona", undefined);
  }

  function registerPersona(persona: Persona): void {
    if (!isPersona(persona)) {
      currentCtx?.ui?.notify?.("Ignored invalid persona registration", "warning");
      return;
    }

    const normalized = { ...persona, id: persona.id.trim(), label: persona.label.trim() };
    personas.set(normalized.id, normalized);

    if (pendingRestorePersonaId === normalized.id && currentCtx) {
      pendingRestorePersonaId = undefined;
      void switchPersona(currentCtx, normalized.id, { persist: false, notify: false });
    }
  }

  async function switchPersona(
    ctx: ExtensionContext,
    targetPersonaId: string,
    options: { persist?: boolean; notify?: boolean } = {},
  ): Promise<boolean> {
    const target = personas.get(targetPersonaId);
    if (!target) {
      ctx.ui.notify(
        `Unknown persona: ${targetPersonaId}. Available: ${sortedPersonas(personas)
          .map((p) => p.id)
          .join(", ")}`,
        "warning",
      );
      return false;
    }

    const previousId = activePersonaId;
    if (previousId === target.id) {
      updatePersonaUi(ctx);
      return true;
    }

    const previous = getActivePersona();
    try {
      await previous.onExit?.(ctx);
    } catch (error) {
      ctx.ui.notify(
        `Persona ${previous.id} exit failed: ${error instanceof Error ? error.message : String(error)}`,
        "warning",
      );
    }

    // Restore tool allowlist captured when the previous persona entered.
    if (previous.tools && previousToolsSnapshot) {
      pi.setActiveTools(previousToolsSnapshot);
    }
    previousToolsSnapshot = undefined;

    activePersonaId = target.id;
    try {
      // Snapshot active tools before persona-driven override, so we can restore on exit.
      if (target.tools) {
        previousToolsSnapshot = pi.getActiveTools?.();
        pi.setActiveTools(target.tools);
      }
      await target.onEnter?.(ctx);
    } catch (error) {
      activePersonaId = previousId;
      // Best-effort restore of previous persona's tools.
      if (target.tools && previousToolsSnapshot) {
        pi.setActiveTools(previousToolsSnapshot);
        previousToolsSnapshot = undefined;
      }
      ctx.ui.notify(
        `Persona ${target.id} enter failed: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
      try {
        await previous.onEnter?.(ctx);
      } catch {
        // Best-effort restore only.
      }
      updatePersonaUi(ctx);
      return false;
    }

    if (options.persist !== false) persistPersona();
    updatePersonaUi(ctx);
    pi.events.emit("cockpit:persona:changed", {
      previousPersona: previousId,
      activePersona: activePersonaId,
    });
    if (options.notify !== false) ctx.ui.notify(`Persona: ${formatPersona(target, ctx)}`, "info");
    return true;
  }

  async function switchToNextPersona(ctx: ExtensionContext): Promise<void> {
    const ordered = sortedPersonas(personas);
    const index = Math.max(0, ordered.findIndex((persona) => persona.id === activePersonaId));
    const next = ordered[(index + 1) % ordered.length] ?? DEFAULT_PERSONA;
    await switchPersona(ctx, next.id);
  }

  async function restorePersonaFromSession(ctx: ExtensionContext): Promise<void> {
    const entries = ctx.sessionManager.getEntries();
    const personaEntry = entries
      .filter((entry: any) => entry?.type === "custom" && entry.customType === PERSONA_STATE_ENTRY)
      .pop() as { data?: { activePersona?: string } } | undefined;
    const restored = personaEntry?.data?.activePersona;
    if (!restored || restored === DEFAULT_PERSONA.id) {
      activePersonaId = DEFAULT_PERSONA.id;
      pendingRestorePersonaId = undefined;
      return;
    }
    if (personas.has(restored)) {
      await switchPersona(ctx, restored, { persist: false, notify: false });
    } else {
      activePersonaId = DEFAULT_PERSONA.id;
      pendingRestorePersonaId = restored;
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
      new CockpitFooter(
        tui,
        theme,
        footerData,
        () => currentCtx,
        () => state,
        getIconStyle,
        getThinkingLevel,
        getActivePersona,
      ),
    );

    ctx.ui.setEditorComponent((tui: TUI, editorTheme: EditorTheme, keybindings: KeybindingsManager) =>
      new CockpitEditor(
        tui,
        editorTheme,
        keybindings,
        ctx.ui.theme,
        () => getTitle(state),
        getThinkingLevel,
        getActivePersona,
      ),
    );

    updatePersonaUi(ctx);
  }

  function formatPersonaList(ctx: ExtensionContext): string {
    return sortedPersonas(personas)
      .map(
        (persona) =>
          `${persona.id === activePersonaId ? "*" : " "} ${formatPersona(persona, ctx)} (${persona.id})${
            persona.description ? ` - ${persona.description}` : ""
          }`,
      )
      .join("\n");
  }

  registerPersona(DEFAULT_PERSONA);

  unsubscribePersonaRegister = pi.events.on("cockpit:persona:register", (persona: unknown) => {
    registerPersona(persona as Persona);
    if (currentCtx) updatePersonaUi(currentCtx);
  });

  unsubscribePersonaSwitch = pi.events.on("cockpit:persona:switch", (data: unknown) => {
    const id = typeof data === "string" ? data : (data as { id?: unknown } | undefined)?.id;
    if (typeof id !== "string") return;
    if (currentCtx) void switchPersona(currentCtx, id);
    else if (personas.has(id)) activePersonaId = id;
  });

  unsubscribePersonaNext = pi.events.on("cockpit:persona:next", () => {
    if (currentCtx) void switchToNextPersona(currentCtx);
  });

  unsubscribeUsage = pi.events.on("usage:update", (data: unknown) => {
    if (data && typeof data === "object") {
      state.usage = data as UsageUpdate;
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    installUi(ctx);
    await restorePersonaFromSession(ctx);
    updatePersonaUi(ctx);
    pi.events.emit("cockpit:ready", {
      activePersona: activePersonaId,
      personas: sortedPersonas(personas).map((persona) => persona.id),
    });
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    unsubscribeUsage?.();
    unsubscribeUsage = undefined;
    unsubscribePersonaRegister?.();
    unsubscribePersonaRegister = undefined;
    unsubscribePersonaSwitch?.();
    unsubscribePersonaSwitch = undefined;
    unsubscribePersonaNext?.();
    unsubscribePersonaNext = undefined;
    resetGitCache();

    if (ctx?.hasUI) {
      ctx.ui.setFooter(undefined);
      ctx.ui.setEditorComponent(undefined);
      ctx.ui.setWorkingIndicator();
    }
  });

  pi.on("input", async (event, ctx) => {
    currentCtx = ctx;
    return getActivePersona().onInput?.(event, ctx);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    currentCtx = ctx;

    if (!state.manualTitle && !state.titleCleared && !state.autoTitle) {
      state.autoTitle = summarizePrompt(event.prompt ?? "");
    }

    const persona = getActivePersona();

    // Inject persona system prompt for every turn while active.
    // Switching personas swaps context with no residue because we rebuild
    // the system prompt on every turn from the currently-active persona only.
    let systemPrompt: string | undefined;
    if (persona.id !== DEFAULT_PERSONA.id && persona.systemPrompt) {
      const resolved =
        typeof persona.systemPrompt === "function"
          ? await persona.systemPrompt(ctx)
          : persona.systemPrompt;
      if (typeof resolved === "string" && resolved.trim().length > 0) {
        systemPrompt = `${event.systemPrompt}\n\n${resolved}`;
      }
    }

    // Allow personas to apply additional changes via their own hook; merge results.
    const extra = await persona.beforeAgentStart?.(
      systemPrompt ? { ...event, systemPrompt } : event,
      ctx,
    );

    if (extra && typeof extra === "object") {
      return systemPrompt ? { systemPrompt, ...extra } : extra;
    }
    return systemPrompt ? { systemPrompt } : undefined;
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
    description: "Cycle persona",
    handler: async (ctx) => {
      currentCtx = ctx;
      await switchToNextPersona(ctx);
    },
  });

  pi.registerCommand("persona", {
    description: "Show or switch Pi Cockpit personas",
    getArgumentCompletions: (prefix: string) => {
      const values = ["list", "status", "next", ...sortedPersonas(personas).map((persona) => persona.id)];
      return values
        .filter((value) => value.startsWith(prefix.trim()))
        .map((value) => ({ value, label: value }));
    },
    handler: async (args, ctx) => {
      currentCtx = ctx;
      const value = args.trim();

      if (!value) {
        const labels = new Map<string, string>();
        const choices = sortedPersonas(personas).map((persona) => {
          const label = `${formatPersona(persona, ctx)} (${persona.id})${
            persona.description ? ` - ${persona.description}` : ""
          }`;
          labels.set(label, persona.id);
          return label;
        });
        const selected = await ctx.ui.select("Persona", choices);
        if (selected) await switchPersona(ctx, labels.get(selected) ?? selected);
        return;
      }

      if (value === "list") {
        ctx.ui.notify(`Personas:\n${formatPersonaList(ctx)}`, "info");
        return;
      }

      if (value === "status") {
        ctx.ui.notify(`Persona: ${formatPersona(getActivePersona(), ctx)}`, "info");
        return;
      }

      if (value === "next") {
        await switchToNextPersona(ctx);
        return;
      }

      await switchPersona(ctx, value);
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

  pi.registerCommand("clear", {
    description: "Clear all context and session state across all extensions",
    handler: async (_args, ctx) => {
      currentCtx = ctx;
      const entries = ctx.sessionManager.getEntries();
      if (!entries.length) {
        ctx.ui.notify("Nothing to clear — session is empty.", "info");
        return;
      }

      const usage = ctx.getContextUsage?.();
      const percent = usage?.percent == null ? undefined : Number(usage.percent);
      const usageText = percent != null ? ` (context: ${Math.round(percent)}%)` : "";
      const confirmed = await ctx.ui.confirm(`Clear all context and extension state?${usageText} This cannot be undone.`);
      if (!confirmed) {
        ctx.ui.notify("Clear cancelled.", "info");
        return;
      }

      const lastEntry = entries[entries.length - 1];
      ctx.sessionManager.appendCompaction(
        "Context cleared by user.",
        lastEntry.id,
        usage?.tokensUsed ?? 0,
        undefined,
        false,
      );

      state.manualTitle = undefined;
      state.autoTitle = "";
      state.titleCleared = true;

      pi.events.emit("cockpit:clear", { source: "command" });
      ctx.ui.notify("Context, title, and state cleared.", "info");
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
