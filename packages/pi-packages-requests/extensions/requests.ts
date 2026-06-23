import { mkdir, readFile, readdir, writeFile, rename, unlink, stat } from "node:fs/promises";
import { existsSync, openSync, closeSync, writeSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

// ── Paths to assets bundled inside this package ──

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DISPATCH_RUNNER = resolve(PKG_ROOT, "dispatch", "run.mjs");
const EXECUTION_PREAMBLE = resolve(PKG_ROOT, "dispatch", "execution-preamble.md");

// ── Types ──

type RepoRoot = {
  path: string;
  source: "setting" | "walked" | "default-home";
};

type RequestFrontmatter = {
  id: string;
  created: string;
  target?: string;
  origin_cwd?: string;
};

type RequestStatus = {
  status: "pending" | "running" | "done" | "failed";
  pid?: number | null;
  pi_pid?: number | null;
  branch?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  exit_code?: number | null;
  signal?: string | null;
  commit?: string | null;
  error?: string | null;
};

type RequestRecord = {
  id: string;
  frontmatter: RequestFrontmatter;
  body: string;
  status: RequestStatus;
  paths: {
    md: string;
    status: string;
    log: string;
  };
};

// ── Generic helpers ──

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

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

// ── Step 2: repo root resolution ──

async function resolveRepoRoot(ctx: ExtensionContext): Promise<RepoRoot | undefined> {
  // 1. Setting from ~/.pi/agent/settings.json
  const globalSettingsPath = join(homedir(), ".pi", "agent", "settings.json");
  const globalSettings = await readJson(globalSettingsPath);
  const setting = globalSettings?.piPackagesRoot;
  if (typeof setting === "string" && setting.trim().length > 0) {
    const expanded = expandHome(setting.trim());
    const absolute = isAbsolute(expanded) ? expanded : resolve(expanded);
    if (await isRepoRoot(absolute)) return { path: absolute, source: "setting" };
  }

  // 2. Walk up from cwd looking for the marker package
  let current = resolve(ctx.cwd);
  while (true) {
    if (await isRepoRoot(current)) return { path: current, source: "walked" };
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  // 3. Fallback: ~/src/pi-packages
  const homeFallback = join(homedir(), "src", "pi-packages");
  if (await isRepoRoot(homeFallback)) return { path: homeFallback, source: "default-home" };

  return undefined;
}

async function isRepoRoot(candidate: string): Promise<boolean> {
  // We treat any directory that contains packages/pi-packages-repo-tools/package.json as the repo root.
  return pathExists(join(candidate, "packages", "pi-packages-repo-tools", "package.json"));
}

function repoRootError(): string {
  return [
    "Could not locate the pi-packages repo.",
    "Set `piPackagesRoot` to its absolute path in ~/.pi/agent/settings.json:",
    `  { "piPackagesRoot": "/absolute/path/to/pi-packages" }`,
  ].join("\n");
}

// ── Step 3: ids, slugs, paths ──

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function timestampForId(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function slugify(text: string, max = 50): string {
  const slug = text
    .toLowerCase()
    .replace(/[`'"“”‘’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return slug || "request";
}

function makeRequestId(target: string | undefined, body: string, date = new Date()): string {
  const slugSource = target ? `${target} ${body}` : body;
  return `${timestampForId(date)}-${slugify(slugSource)}`;
}

function requestPaths(root: string, id: string) {
  const dir = join(root, "requests");
  return {
    dir,
    md: join(dir, `${id}.md`),
    status: join(dir, `${id}.status.json`),
    log: join(dir, `${id}.log`),
    lock: join(dir, ".lock"),
  };
}

async function ensureRequestsDir(root: string): Promise<string> {
  const dir = join(root, "requests");
  await mkdir(dir, { recursive: true });
  return dir;
}

// ── Step 4: target (package) discovery ──

async function listPackages(root: string): Promise<string[]> {
  const packagesDir = join(root, "packages");
  if (!(await pathExists(packagesDir))) return [];
  const entries = await readdir(packagesDir, { withFileTypes: true });
  const names: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (await pathExists(join(packagesDir, e.name, "package.json"))) names.push(e.name);
  }
  return names.sort();
}

// ── Step 5: frontmatter + read/write request files ──

function renderFrontmatter(fm: RequestFrontmatter): string {
  const lines = ["---"];
  lines.push(`id: ${fm.id}`);
  lines.push(`created: ${fm.created}`);
  if (fm.target) lines.push(`target: ${fm.target}`);
  if (fm.origin_cwd) lines.push(`origin_cwd: ${fm.origin_cwd}`);
  lines.push("---");
  return lines.join("\n");
}

function parseFrontmatter(md: string): { frontmatter: RequestFrontmatter; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(md);
  if (!m) return { frontmatter: { id: "", created: "" }, body: md.trim() };
  const fm: Record<string, string> = {};
  for (const line of m[1].split(/\n/)) {
    const kv = /^(\w+):\s*(.*)$/.exec(line);
    if (kv) fm[kv[1]] = kv[2];
  }
  return {
    frontmatter: {
      id: fm.id ?? "",
      created: fm.created ?? "",
      target: fm.target || undefined,
      origin_cwd: fm.origin_cwd || undefined,
    },
    body: (m[2] ?? "").trim(),
  };
}

async function writeRequestAtomic(path: string, contents: string): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, contents, "utf8");
  await rename(tmp, path);
}

async function readStatus(root: string, id: string): Promise<RequestStatus> {
  const path = requestPaths(root, id).status;
  const raw = await readJson(path);
  if (!raw) return { status: "pending" };
  return raw as RequestStatus;
}

async function writeStatus(root: string, id: string, patch: Partial<RequestStatus>): Promise<RequestStatus> {
  const path = requestPaths(root, id).status;
  const current = await readStatus(root, id);
  const merged: RequestStatus = { ...current, ...patch };
  await writeRequestAtomic(path, JSON.stringify(merged, null, 2));
  return merged;
}

async function readRequest(root: string, id: string): Promise<RequestRecord | undefined> {
  const paths = requestPaths(root, id);
  if (!(await pathExists(paths.md))) return undefined;
  const md = await readFile(paths.md, "utf8");
  const { frontmatter, body } = parseFrontmatter(md);
  const status = await readStatus(root, id);
  return { id, frontmatter, body, status, paths: { md: paths.md, status: paths.status, log: paths.log } };
}

async function listRequestIds(root: string): Promise<string[]> {
  const dir = join(root, "requests");
  if (!(await pathExists(dir))) return [];
  const entries = await readdir(dir);
  return entries
    .filter((name) => name.endsWith(".md") && !name.startsWith("."))
    .map((name) => name.replace(/\.md$/, ""))
    .sort()
    .reverse();
}

async function resolveIdPrefix(root: string, prefix: string): Promise<string | undefined> {
  const ids = await listRequestIds(root);
  const matches = ids.filter((id) => id.startsWith(prefix));
  if (matches.length === 1) return matches[0];
  // Try a contains match if no prefix match
  if (matches.length === 0) {
    const contains = ids.filter((id) => id.includes(prefix));
    if (contains.length === 1) return contains[0];
  }
  return undefined;
}

// ── Locking ──

async function tryAcquireLock(root: string, id: string): Promise<boolean> {
  const lockPath = requestPaths(root, id).lock;
  try {
    const fd = openSync(lockPath, "wx");
    writeSync(fd, id);
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

async function readLock(root: string): Promise<string | undefined> {
  const lockPath = requestPaths(root, "_").lock;
  try {
    return (await readFile(lockPath, "utf8")).trim();
  } catch {
    return undefined;
  }
}

// ── Step 5 (continued): create handler ──

function parseCreateArgs(args: string, packages: string[]): { target?: string; body: string } {
  const trimmed = args.trim();
  if (!trimmed) return { body: "" };
  const space = trimmed.search(/\s/);
  if (space === -1) {
    // single token: only treat as target if it matches a package; otherwise it's a (very short) body
    if (packages.includes(trimmed)) return { target: trimmed, body: "" };
    return { body: trimmed };
  }
  const first = trimmed.slice(0, space);
  const rest = trimmed.slice(space + 1).trim();
  if (packages.includes(first)) return { target: first, body: rest };
  return { body: trimmed };
}

async function handleCreate(args: string, ctx: ExtensionContext, root: RepoRoot): Promise<void> {
  const packages = await listPackages(root.path);
  const { target, body } = parseCreateArgs(args, packages);

  if (!body) {
    ctx.ui.notify(
      [
        "Usage: /pi-req [target] <what to change>",
        target ? `Target '${target}' recognised, but the request body is empty.` : "Provide a description of the change.",
        packages.length ? `Known targets: ${packages.join(", ")}` : "",
      ].filter(Boolean).join("\n"),
      "warning",
    );
    return;
  }

  await ensureRequestsDir(root.path);

  const created = new Date();
  const id = makeRequestId(target, body, created);
  const paths = requestPaths(root.path, id);
  const fm: RequestFrontmatter = {
    id,
    created: created.toISOString(),
    target,
    origin_cwd: ctx.cwd,
  };
  const md = `${renderFrontmatter(fm)}\n${body.trim()}\n`;
  await writeRequestAtomic(paths.md, md);
  await writeStatus(root.path, id, { status: "pending", pid: null, branch: null });

  // Acquire the lock before spawning; if held, leave request pending and tell the user.
  const got = await tryAcquireLock(root.path, id);
  if (!got) {
    const holder = await readLock(root.path);
    ctx.ui.notify(
      [
        `Captured: ${id}`,
        `Repo: ${root.path}`,
        `Another request is currently holding the dispatch lock${holder ? ` (${holder})` : ""}.`,
        `This request stays pending. Re-run dispatch later, or run /pi-req reap if the lock is stale.`,
      ].join("\n"),
      "warning",
    );
    return;
  }

  // Dispatch (step 6).
  try {
    await dispatch(root.path, id);
  } catch (err) {
    await writeStatus(root.path, id, {
      status: "failed",
      finished_at: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
    });
    try {
      await unlink(paths.lock);
    } catch {}
    ctx.ui.notify(`Dispatch failed for ${id}: ${err instanceof Error ? err.message : String(err)}`, "error");
    return;
  }

  ctx.ui.notify(
    [
      `Captured and dispatched: ${id}`,
      target ? `Target: ${target}` : "Target: (freeform)",
      `Branch: req/${id}`,
      `Log:    ${paths.log}`,
      `Watch:  /pi-req tail ${id}`,
    ].join("\n"),
    "info",
  );
}

// ── Step 7: read-side helpers and subcommand handlers ──

function ageString(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "?";
  const seconds = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function shortId(id: string): string {
  // Strip the date prefix "YYYY-MM-DD-HHMM-" for compact listings
  return id.replace(/^\d{4}-\d{2}-\d{2}-\d{4}-/, "");
}

async function handleList(args: string, ctx: ExtensionContext, root: RepoRoot): Promise<void> {
  const filter = args.trim();
  const valid = new Set(["pending", "running", "done", "failed", ""]);
  if (!valid.has(filter)) {
    ctx.ui.notify(`Unknown status filter '${filter}'. Use one of: pending, running, done, failed (or no argument).`, "warning");
    return;
  }

  const ids = await listRequestIds(root.path);
  if (ids.length === 0) {
    ctx.ui.notify(`No requests in ${join(root.path, "requests")}`, "info");
    return;
  }

  const rows: string[] = [];
  for (const id of ids) {
    const rec = await readRequest(root.path, id);
    if (!rec) continue;
    if (filter && rec.status.status !== filter) continue;
    const target = rec.frontmatter.target ? `[${rec.frontmatter.target}]` : "";
    const age = ageString(rec.frontmatter.created);
    const firstLine = rec.body.split(/\n/)[0]?.trim() ?? "";
    const trimmedFirst = firstLine.length > 60 ? `${firstLine.slice(0, 59)}\u2026` : firstLine;
    rows.push(
      `${rec.status.status.padEnd(7)} ${age.padEnd(5)} ${target.padEnd(22)} ${shortId(id).padEnd(40)} ${trimmedFirst}`,
    );
  }

  if (rows.length === 0) {
    ctx.ui.notify(`No ${filter} requests found.`, "info");
    return;
  }

  const header = `${"status".padEnd(7)} ${"age".padEnd(5)} ${"target".padEnd(22)} ${"id (short)".padEnd(40)} body`;
  ctx.ui.notify(`Requests (newest first):\n\n${header}\n${"-".repeat(header.length)}\n${rows.join("\n")}`, "info");
}

async function handleShow(args: string, ctx: ExtensionContext, root: RepoRoot): Promise<void> {
  const prefix = args.trim();
  if (!prefix) {
    ctx.ui.notify("Usage: /pi-req show <id-or-prefix>", "warning");
    return;
  }
  const id = await resolveIdPrefix(root.path, prefix);
  if (!id) {
    ctx.ui.notify(`No request matches '${prefix}'. Try /pi-req list.`, "warning");
    return;
  }
  const rec = await readRequest(root.path, id);
  if (!rec) {
    ctx.ui.notify(`Could not read request ${id}.`, "error");
    return;
  }
  const lines = [
    `Id:        ${rec.id}`,
    `Created:   ${rec.frontmatter.created}`,
    `Target:    ${rec.frontmatter.target ?? "(none)"}`,
    `Origin:    ${rec.frontmatter.origin_cwd ?? "(unknown)"}`,
    `Status:    ${rec.status.status}`,
  ];
  if (rec.status.branch) lines.push(`Branch:    ${rec.status.branch}`);
  if (rec.status.pid) lines.push(`Pid:       ${rec.status.pid}`);
  if (rec.status.started_at) lines.push(`Started:   ${rec.status.started_at}`);
  if (rec.status.finished_at) lines.push(`Finished:  ${rec.status.finished_at}`);
  if (rec.status.exit_code !== undefined && rec.status.exit_code !== null) lines.push(`Exit code: ${rec.status.exit_code}`);
  if (rec.status.signal) lines.push(`Signal:    ${rec.status.signal}`);
  if (rec.status.commit) lines.push(`Commit:    ${rec.status.commit}`);
  if (rec.status.error) lines.push(`Error:     ${rec.status.error}`);
  lines.push("");
  lines.push("Request:");
  lines.push(rec.body);
  ctx.ui.notify(lines.join("\n"), "info");
}

async function handleLog(args: string, ctx: ExtensionContext, root: RepoRoot): Promise<void> {
  const prefix = args.trim();
  if (!prefix) {
    ctx.ui.notify("Usage: /pi-req log <id-or-prefix>", "warning");
    return;
  }
  const id = await resolveIdPrefix(root.path, prefix);
  if (!id) {
    ctx.ui.notify(`No request matches '${prefix}'. Try /pi-req list.`, "warning");
    return;
  }
  const logPath = requestPaths(root.path, id).log;
  if (!(await pathExists(logPath))) {
    ctx.ui.notify(`No log file yet at ${logPath}.`, "info");
    return;
  }
  const content = await readFile(logPath, "utf8");
  ctx.ui.notify(`Log: ${logPath}\n\n${content || "(empty)"}`, "info");
}

async function handleTail(args: string, ctx: ExtensionContext, root: RepoRoot): Promise<void> {
  const prefix = args.trim();
  if (!prefix) {
    ctx.ui.notify("Usage: /pi-req tail <id-or-prefix>", "warning");
    return;
  }
  const id = await resolveIdPrefix(root.path, prefix);
  if (!id) {
    ctx.ui.notify(`No request matches '${prefix}'. Try /pi-req list.`, "warning");
    return;
  }
  const logPath = requestPaths(root.path, id).log;
  if (!(await pathExists(logPath))) {
    ctx.ui.notify(`No log file yet at ${logPath}.`, "info");
    return;
  }
  const content = await readFile(logPath, "utf8");
  const lines = content.split(/\n/);
  const tail = lines.slice(-100).join("\n");
  ctx.ui.notify(
    [
      `Last 100 lines of ${logPath}:`,
      "",
      tail || "(empty)",
      "",
      `For live streaming, run in another terminal:`,
      `  tail -f "${logPath}"`,
    ].join("\n"),
    "info",
  );
}

async function handleDone(args: string, ctx: ExtensionContext, root: RepoRoot): Promise<void> {
  const prefix = args.trim();
  if (!prefix) {
    ctx.ui.notify("Usage: /pi-req done <id-or-prefix>", "warning");
    return;
  }
  const id = await resolveIdPrefix(root.path, prefix);
  if (!id) {
    ctx.ui.notify(`No request matches '${prefix}'. Try /pi-req list.`, "warning");
    return;
  }
  const status = await readStatus(root.path, id);
  if (status.status === "done") {
    ctx.ui.notify(`${id} is already done.`, "info");
    return;
  }
  await writeStatus(root.path, id, {
    status: "done",
    finished_at: status.finished_at ?? new Date().toISOString(),
  });
  ctx.ui.notify(`Marked ${id} as done.`, "info");
}

// ── Step 8: reap stale running requests and stale lock ──

function isPidAlive(pid: number | null | undefined): boolean {
  if (typeof pid !== "number" || pid <= 0) return false;
  try {
    // Signal 0 is a liveness probe; throws ESRCH if no such process.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function handleReap(_args: string, ctx: ExtensionContext, root: RepoRoot): Promise<void> {
  const ids = await listRequestIds(root.path);
  const reaped: string[] = [];

  for (const id of ids) {
    const status = await readStatus(root.path, id);
    if (status.status !== "running") continue;
    const runnerAlive = isPidAlive(status.pid ?? null);
    const piAlive = isPidAlive(status.pi_pid ?? null);
    if (runnerAlive || piAlive) continue;
    await writeStatus(root.path, id, {
      status: "failed",
      error: "reaped: runner process not alive",
      finished_at: status.finished_at ?? new Date().toISOString(),
    });
    reaped.push(id);
  }

  // Free stale lock if its holder is no longer running.
  const lockPath = requestPaths(root.path, "_").lock;
  let releasedLock = false;
  if (await pathExists(lockPath)) {
    let holderId = "";
    try {
      holderId = (await readFile(lockPath, "utf8")).trim();
    } catch {}
    const holderStatus = holderId ? await readStatus(root.path, holderId).catch(() => undefined) : undefined;
    const holderRunning = holderStatus?.status === "running"
      && (isPidAlive(holderStatus.pid ?? null) || isPidAlive(holderStatus.pi_pid ?? null));
    if (!holderRunning) {
      try {
        await unlink(lockPath);
        releasedLock = true;
      } catch {}
    }
  }

  const parts: string[] = [];
  if (reaped.length) parts.push(`Reaped ${reaped.length} stale running ${reaped.length === 1 ? "request" : "requests"}:\n  ${reaped.join("\n  ")}`);
  if (releasedLock) parts.push("Released stale lock.");
  if (parts.length === 0) parts.push("Nothing to reap. All running requests have live pids and the lock (if any) is fresh.");
  ctx.ui.notify(parts.join("\n"), "info");
}

// ── Step 6: dispatch ──

async function dispatch(root: string, id: string): Promise<void> {
  if (!existsSync(DISPATCH_RUNNER)) {
    throw new Error(`Dispatch runner missing at ${DISPATCH_RUNNER}`);
  }

  const args = [DISPATCH_RUNNER, id, root, EXECUTION_PREAMBLE];

  // Detached so the runner survives the parent pi session exiting.
  // stdio:'ignore' because the runner writes to its own log file.
  const child = spawn(process.execPath, args, {
    cwd: root,
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();

  // Record our best-guess pid early so /pi-req list/reap have something to
  // work with even before the runner gets its first writeStatus in.
  if (child.pid !== undefined && child.pid !== null) {
    await writeStatus(root, id, { status: "running", pid: child.pid, branch: `req/${id}`, started_at: new Date().toISOString() });
  }
}

// ── Extension entry point ──

export default function (pi: ExtensionAPI) {
  pi.registerCommand("pi-req", {
    description: "Capture a change request for pi-packages and dispatch a headless run to fulfil it",
    getArgumentCompletions: (prefix: string) => {
      // Subverbs only; package-name completion is best-effort and would require
      // sync access to the repo. Subverbs are the common case at depth 1.
      const trimmed = prefix.trimStart();
      if (trimmed.includes(" ")) return null;
      const subverbs = ["list", "show", "log", "tail", "done", "reap", "help"];
      const matches = subverbs.filter((s) => s.startsWith(trimmed));
      return matches.length ? matches.map((s) => ({ value: s, label: s })) : null;
    },
    handler: async (args, ctx) => {
      const root = await resolveRepoRoot(ctx);
      if (!root) {
        ctx.ui.notify(repoRootError(), "error");
        return;
      }

      const trimmed = args.trim();
      const firstSpace = trimmed.search(/\s/);
      const first = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
      const rest = firstSpace === -1 ? "" : trimmed.slice(firstSpace + 1).trim();

      switch (first) {
        case "":
          ctx.ui.notify(
            [
              "Usage:",
              "  /pi-req [target] <what to change>      capture and dispatch",
              "  /pi-req list [status]                  list requests",
              "  /pi-req show <id>                      show one request",
              "  /pi-req log <id>                       print dispatch log",
              "  /pi-req tail <id>                      tail -f the log",
              "  /pi-req done <id>                      mark as done",
              "  /pi-req reap                           reconcile stale running requests",
              `Repo: ${root.path} (${root.source})`,
              `Used asset: ${DISPATCH_RUNNER}`,
              `Preamble:   ${EXECUTION_PREAMBLE}`,
            ].join("\n"),
            "info",
          );
          return;
        case "help":
          ctx.ui.notify("See /pi-req with no args for usage.", "info");
          return;
        case "list":
          return handleList(rest, ctx, root);
        case "show":
          return handleShow(rest, ctx, root);
        case "log":
          return handleLog(rest, ctx, root);
        case "tail":
          return handleTail(rest, ctx, root);
        case "done":
          return handleDone(rest, ctx, root);
        case "reap":
          return handleReap(rest, ctx, root);
        default:
          return handleCreate(trimmed, ctx, root);
      }
    },
  });
}
