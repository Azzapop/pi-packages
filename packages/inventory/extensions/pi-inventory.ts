import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@mariozechner/pi-coding-agent";
import { type Component, Key, matchesKey, Text, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";

const CONTENT_PAGE_SIZE = 24;

type SettingsFile = {
  packages?: unknown[];
  theme?: string;
};

type SettingsSummary = {
  label: string;
  path: string;
  packages: string[];
  theme?: string;
  error?: string;
};

type InventoryData = {
  cwd: string;
  settings: SettingsSummary[];
  configuredTheme?: string;
  commands: ReturnType<ExtensionAPI["getCommands"]>;
  tools: ReturnType<ExtensionAPI["getAllTools"]>;
  activeTools: Set<string>;
  themes: { name: string; path: string | undefined }[];
};

type InventoryLine = {
  render: (theme: Theme) => string;
  wrap?: boolean;
};

async function readSettings(label: string, filePath: string): Promise<SettingsSummary> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as SettingsFile;
    return {
      label,
      path: filePath,
      packages: Array.isArray(parsed.packages) ? parsed.packages.map(formatPackageEntry) : [],
      theme: typeof parsed.theme === "string" ? parsed.theme : undefined,
    };
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
    return {
      label,
      path: filePath,
      packages: [],
      error: code === "ENOENT" ? "not found" : error instanceof Error ? error.message : String(error),
    };
  }
}

function formatPackageEntry(entry: unknown): string {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") {
    const record = entry as Record<string, unknown>;
    const source = typeof record.source === "string" ? record.source : JSON.stringify(entry);
    const filters = ["extensions", "skills", "prompts", "themes"]
      .filter((key) => key in record)
      .map((key) => `${key}=${JSON.stringify(record[key])}`);
    return filters.length > 0 ? `${source} (${filters.join(", ")})` : source;
  }
  return String(entry);
}

function sourceLabel(sourceInfo: unknown): string {
  if (!sourceInfo || typeof sourceInfo !== "object") return "unknown";
  const info = sourceInfo as { source?: string; scope?: string; origin?: string; path?: string };
  const parts = [info.source, info.scope, info.origin].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : info.path ?? "unknown";
}

function pathLabel(sourceInfo: unknown): string | undefined {
  if (!sourceInfo || typeof sourceInfo !== "object") return undefined;
  const info = sourceInfo as { path?: string };
  return info.path;
}

function fillLine(line: string, width: number): string {
  const truncated = truncateToWidth(line, width);
  const padding = Math.max(0, width - visibleWidth(truncated));
  return truncated + " ".repeat(padding);
}

function plain(text: string, wrap = false): InventoryLine {
  return { render: () => text, wrap };
}

function section(title: string): InventoryLine {
  return { render: (theme) => theme.fg("accent", theme.bold(title)) };
}

function bullet(text: string, color: "text" | "accent" | "success" | "warning" | "error" | "muted" | "dim" = "text", wrap = false): InventoryLine {
  return { render: (theme) => `  ${theme.fg("dim", "•")} ${theme.fg(color, text)}`, wrap };
}

function detail(text: string, color: "muted" | "dim" | "warning" | "error" = "muted", wrap = true): InventoryLine {
  return { render: (theme) => `      ${theme.fg(color, text)}`, wrap };
}

function blank(): InventoryLine {
  return plain("");
}

function addCommandSection(lines: InventoryLine[], title: string, data: InventoryData, source: "extension" | "prompt" | "skill") {
  const commands = data.commands.filter((command) => command.source === source);
  lines.push(section(`${title} (${commands.length})`));
  if (commands.length === 0) {
    lines.push(bullet("none", "dim"), blank());
    return;
  }

  for (const command of commands) {
    lines.push({
      render: (theme) => {
        const description = command.description ? theme.fg("muted", ` — ${command.description}`) : "";
        return `  ${theme.fg("dim", "•")} ${theme.fg("accent", `/${command.name}`)}${description}`;
      },
      wrap: true,
    });
    lines.push(detail(sourceLabel(command.sourceInfo), "muted"));
    const location = pathLabel(command.sourceInfo);
    if (location) lines.push(detail(location, "dim"));
  }
  lines.push(blank());
}

function buildInventoryLines(data: InventoryData): InventoryLine[] {
  const lines: InventoryLine[] = [];
  const globalPackages = data.settings[0]?.packages.length ?? 0;
  const projectPackages = data.settings[1]?.packages.length ?? 0;
  const extensionCommands = data.commands.filter((command) => command.source === "extension").length;
  const promptCommands = data.commands.filter((command) => command.source === "prompt").length;
  const skillCommands = data.commands.filter((command) => command.source === "skill").length;
  const activeToolCount = data.tools.filter((tool) => data.activeTools.has(tool.name)).length;

  lines.push({ render: (theme) => theme.fg("accent", theme.bold("Pi Inventory")) });
  lines.push({ render: (theme) => theme.fg("muted", `cwd: ${data.cwd}`), wrap: true });
  lines.push({
    render: (theme) =>
      theme.fg(
        "dim",
        `packages ${globalPackages} global / ${projectPackages} project  |  commands ${extensionCommands} ext / ${promptCommands} prompt / ${skillCommands} skill  |  tools ${activeToolCount}/${data.tools.length} active  |  themes ${data.themes.length}`,
      ),
    wrap: true,
  });
  lines.push(blank());

  lines.push(section("Installed packages from settings"));
  for (const setting of data.settings) {
    const status = setting.error ? ` (${setting.error})` : "";
    lines.push({
      render: (theme) =>
        `  ${theme.fg("dim", "•")} ${theme.fg(setting.error ? "warning" : "accent", setting.label)} ${theme.fg("dim", setting.path + status)}`,
      wrap: true,
    });
    if (setting.packages.length === 0) {
      lines.push(detail("none", "dim"));
    } else {
      for (const pkg of setting.packages) lines.push(detail(pkg, "muted"));
    }
  }
  lines.push(blank());

  addCommandSection(lines, "Extension commands", data, "extension");
  addCommandSection(lines, "Prompt commands", data, "prompt");
  addCommandSection(lines, "Skill commands", data, "skill");

  lines.push(section(`Tools (${activeToolCount} active, ${data.tools.length - activeToolCount} inactive)`));
  for (const tool of data.tools) {
    const active = data.activeTools.has(tool.name);
    lines.push({
      render: (theme) => {
        const state = active ? theme.fg("success", "active") : theme.fg("dim", "inactive");
        return `  ${theme.fg("dim", "•")} ${theme.fg(active ? "success" : "muted", tool.name)} ${theme.fg("dim", "(")}${state}${theme.fg("dim", ")")}`;
      },
    });
    lines.push(detail(sourceLabel(tool.sourceInfo), active ? "muted" : "dim"));
    const location = pathLabel(tool.sourceInfo);
    if (location) lines.push(detail(location, "dim"));
  }
  lines.push(blank());

  lines.push(section(`Themes (${data.themes.length})`));
  for (const themeInfo of data.themes) {
    const configured = data.configuredTheme === themeInfo.name;
    lines.push({
      render: (theme) =>
        `  ${theme.fg("dim", "•")} ${theme.fg(configured ? "success" : "accent", themeInfo.name)}${configured ? theme.fg("success", " configured") : ""}`,
    });
    if (themeInfo.path) lines.push(detail(themeInfo.path, "dim"));
  }

  return lines;
}

async function buildInventoryData(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<InventoryData> {
  const globalSettings = await readSettings("Global settings", path.join(homedir(), ".pi/agent/settings.json"));
  const projectSettings = await readSettings("Project settings", path.join(ctx.cwd, ".pi/settings.json"));

  return {
    cwd: ctx.cwd,
    settings: [globalSettings, projectSettings],
    configuredTheme: projectSettings.theme ?? globalSettings.theme,
    commands: pi.getCommands(),
    tools: pi.getAllTools(),
    activeTools: new Set(pi.getActiveTools()),
    themes: ctx.ui.getAllThemes(),
  };
}

function buildPlainReport(lines: InventoryLine[], theme: Theme): string {
  return lines.map((line) => line.render(theme)).join("\n");
}

class InventoryViewer implements Component {
  private scrollOffset = 0;
  private maxOffset = 0;

  constructor(
    private readonly theme: Theme,
    private readonly lines: InventoryLine[],
    private readonly done: () => void,
    private readonly requestRender: () => void,
  ) {}

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || data === "q") {
      this.done();
      return;
    }
    if (matchesKey(data, Key.down) || data === "j") this.scrollBy(1);
    else if (matchesKey(data, Key.up) || data === "k") this.scrollBy(-1);
    else if (matchesKey(data, Key.pageDown) || data === " ") this.scrollBy(CONTENT_PAGE_SIZE);
    else if (matchesKey(data, Key.pageUp)) this.scrollBy(-CONTENT_PAGE_SIZE);
    else if (matchesKey(data, Key.home)) this.scrollTo(0);
    else if (matchesKey(data, Key.end)) this.scrollTo(this.maxOffset);
  }

  invalidate(): void {}

  render(width: number): string[] {
    const innerWidth = Math.max(20, width - 4);
    const rendered = this.getRenderedLines(innerWidth);
    this.maxOffset = Math.max(0, rendered.length - CONTENT_PAGE_SIZE);
    this.scrollOffset = Math.min(this.scrollOffset, this.maxOffset);
    const visible = rendered.slice(this.scrollOffset, this.scrollOffset + CONTENT_PAGE_SIZE);
    const percent = rendered.length <= CONTENT_PAGE_SIZE ? "100%" : `${Math.round(((this.scrollOffset + CONTENT_PAGE_SIZE) / rendered.length) * 100)}%`;

    const top = this.theme.bg("customMessageBg", fillLine(` ${this.theme.fg("accent", this.theme.bold("Pi Inventory"))} ${this.theme.fg("dim", "— scrollable resource list")}`, width));
    const rule = this.theme.bg("customMessageBg", this.theme.fg("borderMuted", "─".repeat(width)));
    const footerText = ` ↑↓/j/k scroll  PgUp/PgDn page  Home/End jump  q/Esc close  ${this.scrollOffset + 1}-${Math.min(this.scrollOffset + CONTENT_PAGE_SIZE, rendered.length)}/${rendered.length} ${percent}`;
    const footer = this.theme.bg("customMessageBg", fillLine(this.theme.fg("dim", footerText), width));

    return [
      top,
      rule,
      ...visible.map((line) => this.theme.bg("customMessageBg", fillLine(`  ${line}`, width))),
      ...Array.from({ length: Math.max(0, CONTENT_PAGE_SIZE - visible.length) }, () => this.theme.bg("customMessageBg", " ".repeat(width))),
      rule,
      footer,
    ];
  }

  private getRenderedLines(width: number): string[] {
    return this.lines.flatMap((line) => {
      const rendered = line.render(this.theme);
      if (!line.wrap) return [truncateToWidth(rendered, width)];
      return wrapTextWithAnsi(rendered, width).map((wrapped) => truncateToWidth(wrapped, width));
    });
  }

  private scrollBy(delta: number) {
    this.scrollTo(Math.max(0, Math.min(this.maxOffset, this.scrollOffset + delta)));
  }

  private scrollTo(offset: number) {
    this.scrollOffset = offset;
    this.requestRender();
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerMessageRenderer("pi-inventory:report", (message) => new Text(String(message.content ?? ""), 0, 0));

  pi.registerCommand("plugins", {
    description: "List loaded pi packages, extensions, prompts, skills, tools, and themes",
    handler: async (_args, ctx) => {
      const data = await buildInventoryData(pi, ctx);
      const lines = buildInventoryLines(data);

      if (!ctx.hasUI) {
        pi.sendMessage({
          customType: "pi-inventory:report",
          content: buildPlainReport(lines, ctx.ui.theme),
          display: true,
        });
        return;
      }

      await ctx.ui.custom<void>(
        (tui, theme, _keybindings, done) =>
          new InventoryViewer(
            theme,
            lines,
            () => done(undefined),
            () => tui.requestRender(),
          ),
        {
          overlay: true,
          overlayOptions: {
            anchor: "center",
            width: "92%",
            maxHeight: "88%",
            margin: 1,
          },
        },
      );
    },
  });
}
