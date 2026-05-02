import type { Theme } from "@mariozechner/pi-coding-agent";
import { type Component, Key, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";
import { fillLine, statusColor, statusIcon } from "./format.ts";
import type { ResolvedPackage } from "./types.ts";

const PAGE_SIZE = 20;

type DashboardLine = {
  render: (theme: Theme, width: number, selected: boolean) => string;
  pkg?: ResolvedPackage;
};

function pkgLine(pkg: ResolvedPackage): DashboardLine {
  return {
    pkg,
    render: (theme: Theme, width: number, selected: boolean) => {
      const icon = statusIcon(pkg.status);
      const color = statusColor(pkg.status);
      const scopeTag = theme.fg("muted", pkg.scope);
      const sel = selected ? theme.fg("accent", ">") : " ";
      const line = `${sel} ${theme.fg(color, icon)} ${theme.fg(color, pkg.name)}  ${scopeTag}  ${theme.fg("text", pkg.resolvedPath)}`;
      return fillLine(line, width);
    },
  };
}

function sectionLine(label: string, count: number): DashboardLine {
  return {
    render: (theme: Theme, width: number) =>
      fillLine(` ${theme.fg("accent", theme.bold(label))} ${theme.fg("muted", `(${count})`)}`, width),
  };
}

function blankLine(): DashboardLine {
  return { render: (_theme, width) => " ".repeat(width) };
}

function buildLines(packages: ResolvedPackage[]): DashboardLine[] {
  const loaded = packages.filter((p) => p.status === "loaded");
  const notLoaded = packages.filter((p) => p.status === "not_loaded");
  const lines: DashboardLine[] = [];

  lines.push(sectionLine("Loaded", loaded.length));
  if (loaded.length === 0) {
    lines.push(blankLine());
  } else {
    for (const pkg of loaded) lines.push(pkgLine(pkg));
  }

  lines.push(blankLine());
  lines.push(sectionLine("Not Loaded", notLoaded.length));
  if (notLoaded.length === 0) {
    lines.push(blankLine());
  } else {
    for (const pkg of notLoaded) lines.push(pkgLine(pkg));
  }

  return lines;
}

function buildDetailLines(pkg: ResolvedPackage): Array<{ render: (theme: Theme) => string; wrap?: boolean }> {
  const lines: Array<{ render: (theme: Theme) => string; wrap?: boolean }> = [];
  const r = (fn: (t: Theme) => string, wrap = false) => lines.push({ render: fn, wrap });

  r((t) => t.fg("accent", t.bold(pkg.name)));
  r(() => "");
  r((t) => `  ${t.fg("muted", "Status:")}  ${t.fg(statusColor(pkg.status), pkg.status)}`);
  r((t) => `  ${t.fg("muted", "Scope:")}   ${pkg.scope}`);
  r((t) => `  ${t.fg("muted", "Entry:")}   ${t.fg("text", pkg.entry)}`, true);
  r((t) => `  ${t.fg("muted", "Path:")}    ${t.fg("text", pkg.resolvedPath)}`, true);
  if (pkg.manifest?.description) r((t) => `  ${t.fg("muted", "Desc:")}    ${t.fg("text", pkg.manifest!.description!)}`, true);
  if (pkg.error) r((t) => `  ${t.fg("muted", "Error:")}   ${t.fg("error", pkg.error!)}`, true);

  if (pkg.manifest) {
    r(() => "");
    r((t) => t.fg("accent", "  Manifest:"));
    for (const key of ["extensions", "skills", "prompts", "themes"] as const) {
      const val = pkg.manifest[key];
      if (val && val.length > 0) {
        r((t) => `    ${t.fg("muted", key + ":")} ${val.join(", ")}`, true);
      }
    }
  }

  return lines;
}

export class PippinDashboard implements Component {
  private cursor = 0;
  private scrollOffset = 0;
  private lines: DashboardLine[] = [];
  private detailPkg: ResolvedPackage | null = null;
  private detailScroll = 0;

  constructor(
    private readonly theme: Theme,
    private packages: ResolvedPackage[],
    private readonly done: () => void,
    private readonly requestRender: () => void,
    private readonly onUninstall: (pkg: ResolvedPackage) => Promise<void>,
    private readonly onPromote: (pkg: ResolvedPackage) => Promise<void>,
  ) {
    this.rebuildLines();
  }

  private rebuildLines() {
    this.lines = buildLines(this.packages);
    // Ensure cursor is on a package line
    if (this.cursor >= this.lines.length) this.cursor = this.lines.length - 1;
    if (this.cursor < 0) this.cursor = 0;
    while (this.cursor < this.lines.length && !this.lines[this.cursor].pkg) this.cursor++;
    if (this.cursor >= this.lines.length) this.cursor = 0;
    this.clampScroll(PAGE_SIZE);
  }

  updatePackages(packages: ResolvedPackage[]) {
    this.packages = packages;
    this.rebuildLines();
    this.requestRender();
  }

  handleInput(data: string): void {
    if (this.detailPkg) {
      this.handleDetailInput(data);
      return;
    }

    if (matchesKey(data, Key.escape) || data === "q") {
      this.done();
      return;
    }

    if (matchesKey(data, Key.down) || data === "j") this.moveCursor(1);
    else if (matchesKey(data, Key.up) || data === "k") this.moveCursor(-1);
    else if (matchesKey(data, Key.pageDown)) this.moveCursor(PAGE_SIZE);
    else if (matchesKey(data, Key.pageUp)) this.moveCursor(-PAGE_SIZE);
    else if (matchesKey(data, Key.return)) this.openDetail();
    else if (data === "u") this.uninstallSelected();
    else if (data === "p") this.promoteSelected();
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (this.detailPkg) return this.renderDetail(width);
    return this.renderList(width);
  }

  private renderList(width: number): string[] {
    const bg = "toolPendingBg" as const;

    const title = this.theme.bg(
      bg,
      fillLine(
        ` ${this.theme.fg("accent", this.theme.bold("Pippin"))}  ${this.theme.fg("muted", `${this.packages.length} packages`)}`,
        width,
      ),
    );

    const rule = this.theme.bg(bg, this.theme.fg("borderMuted", "\u2500".repeat(width)));

    this.clampScroll(PAGE_SIZE);
    const visible = this.lines.slice(this.scrollOffset, this.scrollOffset + PAGE_SIZE);

    const contentLines = visible.map((line, i) => {
      const idx = this.scrollOffset + i;
      const rendered = line.render(this.theme, width - 4, idx === this.cursor);
      return this.theme.bg(bg, fillLine(`  ${rendered}`, width));
    });

    const empty = Array.from(
      { length: Math.max(0, PAGE_SIZE - visible.length) },
      () => this.theme.bg(bg, " ".repeat(width)),
    );

    const footer = this.theme.bg(
      bg,
      fillLine(
        this.theme.fg("muted", " u uninstall  p promote/demote  Enter detail  q close"),
        width,
      ),
    );

    return [title, rule, ...contentLines, ...empty, rule, footer];
  }

  private renderDetail(width: number): string[] {
    const pkg = this.detailPkg!;
    const dLines = buildDetailLines(pkg);
    const innerWidth = Math.max(20, width - 4);

    const rendered = dLines.flatMap((line) => {
      const r = line.render(this.theme);
      if (!line.wrap) return [truncateToWidth(r, innerWidth)];
      return wrapTextWithAnsi(r, innerWidth).map((w) => truncateToWidth(w, innerWidth));
    });

    const maxScroll = Math.max(0, rendered.length - PAGE_SIZE);
    this.detailScroll = Math.min(this.detailScroll, maxScroll);
    const visible = rendered.slice(this.detailScroll, this.detailScroll + PAGE_SIZE);

    const bg = "toolPendingBg" as const;

    const title = this.theme.bg(
      bg,
      fillLine(` ${this.theme.fg("accent", this.theme.bold("Package Detail"))}`, width),
    );
    const rule = this.theme.bg(bg, this.theme.fg("borderMuted", "\u2500".repeat(width)));
    const footer = this.theme.bg(
      bg,
      fillLine(this.theme.fg("muted", " q/Esc back  j/k scroll"), width),
    );

    const contentLines = visible.map((line) =>
      this.theme.bg(bg, fillLine(`  ${line}`, width)),
    );
    const empty = Array.from(
      { length: Math.max(0, PAGE_SIZE - visible.length) },
      () => this.theme.bg(bg, " ".repeat(width)),
    );

    return [title, rule, ...contentLines, ...empty, rule, footer];
  }

  private handleDetailInput(data: string) {
    if (matchesKey(data, Key.escape) || data === "q") {
      this.detailPkg = null;
      this.detailScroll = 0;
      this.requestRender();
      return;
    }
    if (matchesKey(data, Key.down) || data === "j") {
      this.detailScroll++;
      this.requestRender();
    } else if (matchesKey(data, Key.up) || data === "k") {
      this.detailScroll = Math.max(0, this.detailScroll - 1);
      this.requestRender();
    }
  }

  private moveCursor(delta: number) {
    const dir = delta > 0 ? 1 : -1;
    let steps = Math.abs(delta);
    let pos = this.cursor;

    while (steps > 0) {
      pos += dir;
      if (pos < 0 || pos >= this.lines.length) break;
      if (this.lines[pos]?.pkg) steps--;
    }

    pos = Math.max(0, Math.min(this.lines.length - 1, pos));
    // If we landed on a non-package line, search forward then backward
    if (!this.lines[pos]?.pkg) {
      let fwd = pos;
      while (fwd < this.lines.length && !this.lines[fwd]?.pkg) fwd++;
      let bwd = pos;
      while (bwd >= 0 && !this.lines[bwd]?.pkg) bwd--;
      if (fwd < this.lines.length) pos = fwd;
      else if (bwd >= 0) pos = bwd;
      else return; // no package lines at all
    }

    this.cursor = pos;
    this.clampScroll(PAGE_SIZE);
    this.requestRender();
  }

  private clampScroll(pageSize: number) {
    if (this.cursor < this.scrollOffset) this.scrollOffset = this.cursor;
    if (this.cursor >= this.scrollOffset + pageSize) this.scrollOffset = this.cursor - pageSize + 1;
    this.scrollOffset = Math.max(0, this.scrollOffset);
  }

  private openDetail() {
    const line = this.lines[this.cursor];
    if (line?.pkg) {
      this.detailPkg = line.pkg;
      this.detailScroll = 0;
      this.requestRender();
    }
  }

  private async uninstallSelected() {
    const line = this.lines[this.cursor];
    if (line?.pkg) await this.onUninstall(line.pkg);
  }

  private async promoteSelected() {
    const line = this.lines[this.cursor];
    if (line?.pkg) await this.onPromote(line.pkg);
  }
}
