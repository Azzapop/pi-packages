import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { PippinDashboard } from "../lib/dashboard.ts";
import { statusColor, statusIcon } from "../lib/format.ts";
import { loadPackages, settingsPath } from "../lib/resolver.ts";
import type { ResolvedPackage } from "../lib/types.ts";

type SettingsJson = Record<string, unknown> & { packages?: unknown[] };

async function readSettings(filePath: string): Promise<SettingsJson> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as SettingsJson;
  } catch {
    return {};
  }
}

async function writeSettings(filePath: string, settings: SettingsJson) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(settings, null, 2) + "\n", "utf8");
}

async function addPackage(entry: string, scope: "global" | "project", cwd: string): Promise<boolean> {
  const filePath = settingsPath(scope, cwd);
  const settings = await readSettings(filePath);
  const packages = Array.isArray(settings.packages) ? [...settings.packages] : [];

  if (packages.some((p) => p === entry)) return false;

  packages.push(entry);
  settings.packages = packages;
  await writeSettings(filePath, settings);
  return true;
}

async function removePackage(entry: string, scope: "global" | "project", cwd: string): Promise<boolean> {
  const filePath = settingsPath(scope, cwd);
  const settings = await readSettings(filePath);
  if (!Array.isArray(settings.packages)) return false;

  const filtered = settings.packages.filter((p) => p !== entry);
  if (filtered.length === settings.packages.length) return false;

  settings.packages = filtered;
  await writeSettings(filePath, settings);
  return true;
}

async function movePackage(pkg: ResolvedPackage, cwd: string): Promise<"global" | "project"> {
  const toScope = pkg.scope === "project" ? "global" : "project";

  // Remove from old scope
  await removePackage(pkg.entry, pkg.scope, cwd);

  // Add to new scope (use absolute path so it resolves from either location)
  await addPackage(pkg.resolvedPath, toScope, cwd);

  return toScope;
}

async function openDashboard(pi: ExtensionAPI, ctx: ExtensionCommandContext) {
  const packages = await loadPackages(ctx.cwd);
  let dashboard: PippinDashboard | null = null;

  const refreshAndUpdate = async () => {
    const updated = await loadPackages(ctx.cwd);
    dashboard?.updatePackages(updated);
  };

  const onUninstall = async (pkg: ResolvedPackage) => {
    const removed = await removePackage(pkg.entry, pkg.scope, ctx.cwd);
    if (!removed) {
      ctx.ui.notify(`${pkg.name} not found in ${pkg.scope} packages`, "error");
      return;
    }
    ctx.ui.notify(`Removed ${pkg.name} from ${pkg.scope}. /reload to apply.`, "info");
    await refreshAndUpdate();
  };

  const onPromote = async (pkg: ResolvedPackage) => {
    const toScope = await movePackage(pkg, ctx.cwd);
    const label = toScope === "global" ? "Promoted to global" : "Demoted to project";
    ctx.ui.notify(`${label}: ${pkg.name}. /reload to apply.`, "info");
    await refreshAndUpdate();
  };

  await ctx.ui.custom<void>(
    (tui, theme, _keybindings, done) => {
      dashboard = new PippinDashboard(
        theme,
        packages,
        () => done(undefined),
        () => tui.requestRender(),
        onUninstall,
        onPromote,
      );
      return dashboard;
    },
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
}

async function handleInstall(rest: string[], ctx: ExtensionCommandContext) {
  const isGlobal = rest.includes("--global") || rest.includes("-g");
  const args = rest.filter((a) => a !== "--global" && a !== "-g");
  const entry = args.join(" ").trim();
  if (!entry) {
    ctx.ui.notify("Usage: /pippin install <path> [--global]", "error");
    return;
  }

  const scope: "global" | "project" = isGlobal ? "global" : "project";
  // Resolve user input relative to cwd, then make relative to settings.json dir
  const absPath = path.resolve(ctx.cwd, entry);
  const settingsDir = path.dirname(settingsPath(scope, ctx.cwd));
  const relEntry = path.relative(settingsDir, absPath);
  const added = await addPackage(relEntry, scope, ctx.cwd);
  if (!added) {
    ctx.ui.notify(`${entry} is already in ${scope} packages`, "info");
    return;
  }
  ctx.ui.notify(`Added ${path.basename(entry)} to ${scope}. /reload to apply.`, "info");
}

async function handleUninstall(rest: string[], ctx: ExtensionCommandContext) {
  const name = rest.join(" ").trim();
  if (!name) {
    ctx.ui.notify("Usage: /pippin uninstall <name>", "error");
    return;
  }

  const packages = await loadPackages(ctx.cwd);
  const pkg = packages.find((p) => p.name === name || path.basename(p.resolvedPath) === name);
  if (!pkg) {
    ctx.ui.notify(`Package "${name}" not found`, "error");
    return;
  }

  await removePackage(pkg.entry, pkg.scope, ctx.cwd);
  ctx.ui.notify(`Removed ${pkg.name} from ${pkg.scope}. /reload to apply.`, "info");
}

async function handleList(pi: ExtensionAPI, ctx: ExtensionCommandContext) {
  const packages = await loadPackages(ctx.cwd);
  const theme = ctx.ui.theme;

  const lines = packages.map((pkg) => {
    const icon = statusIcon(pkg.status);
    const color = statusColor(pkg.status);
    return `${theme.fg(color, icon)} ${theme.fg(color, pkg.name)}  ${theme.fg("muted", pkg.scope)}  ${theme.fg("text", pkg.resolvedPath)}`;
  });

  const header = theme.fg("accent", theme.bold("Pippin")) + theme.fg("muted", `  ${packages.length} packages`);
  const content = [header, "", ...lines].join("\n");

  pi.sendMessage({
    customType: "pippin:report",
    content,
    display: true,
  });
}

export default function (pi: ExtensionAPI) {
  pi.registerMessageRenderer("pippin:report", (message) => new Text(String(message.content ?? ""), 0, 0));

  pi.registerCommand("pippin", {
    description: "Package manager dashboard. /pippin [install|uninstall|list]",
    handler: async (args, ctx) => {
      const [sub, ...rest] = args.trim().split(/\s+/);

      if (!sub) {
        if (!ctx.hasUI) return handleList(pi, ctx);
        return openDashboard(pi, ctx);
      }

      switch (sub) {
        case "install":
          return handleInstall(rest, ctx);
        case "uninstall":
          return handleUninstall(rest, ctx);
        case "list":
          return handleList(pi, ctx);
        default:
          ctx.ui.notify(`Unknown: /pippin ${sub}`, "error");
      }
    },
  });
}
