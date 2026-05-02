import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { ResolvedPackage } from "./types.ts";

type PiManifest = {
  name?: string;
  description?: string;
  pi?: {
    extensions?: string[];
    skills?: string[];
    prompts?: string[];
    themes?: string[];
  };
};

type SettingsJson = {
  packages?: unknown[];
};

async function readManifest(pkgPath: string): Promise<PiManifest | null> {
  try {
    const raw = await readFile(path.join(pkgPath, "package.json"), "utf8");
    return JSON.parse(raw) as PiManifest;
  } catch {
    return null;
  }
}

function resolveEntryPath(entry: string, settingsDir: string): string {
  return path.isAbsolute(entry) ? path.resolve(entry) : path.resolve(settingsDir, entry);
}

async function resolveEntry(
  entry: string,
  scope: "global" | "project",
  settingsDir: string,
): Promise<ResolvedPackage> {
  const resolvedPath = resolveEntryPath(entry, settingsDir);
  const manifest = await readManifest(resolvedPath);

  if (!manifest) {
    return {
      entry,
      name: path.basename(resolvedPath),
      resolvedPath,
      scope,
      status: "not_loaded",
      error: "package.json not found",
    };
  }

  return {
    entry,
    name: manifest.name ?? path.basename(resolvedPath),
    resolvedPath,
    scope,
    status: "loaded",
    manifest: {
      description: manifest.description,
      ...manifest.pi,
    },
  };
}

function settingsPath(scope: "global" | "project", cwd: string): string {
  return scope === "global"
    ? path.join(homedir(), ".pi/agent/settings.json")
    : path.join(cwd, ".pi/settings.json");
}

async function readSettingsJson(filePath: string): Promise<SettingsJson | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as SettingsJson;
  } catch {
    return null;
  }
}

export async function loadPackages(cwd: string): Promise<ResolvedPackage[]> {
  const results: ResolvedPackage[] = [];

  for (const scope of ["global", "project"] as const) {
    const filePath = settingsPath(scope, cwd);
    const settings = await readSettingsJson(filePath);
    const entries = Array.isArray(settings?.packages)
      ? settings.packages.filter((p): p is string => typeof p === "string")
      : [];
    const dir = path.dirname(filePath);

    const resolved = await Promise.all(
      entries.map((entry) => resolveEntry(entry, scope, dir)),
    );
    results.push(...resolved);
  }

  return results;
}

export { settingsPath };
