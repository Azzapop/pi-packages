#!/usr/bin/env node
// Dispatch runner for /pi-req. Invoked detached by the extension:
//   node dispatch/run.mjs <id> <repoRoot> <preamblePath>
//
// Responsibilities:
//   1. Mark the request `running` with our pid and a started_at timestamp.
//   2. Create branch req/<id> from current HEAD.
//   3. Spawn `pi -p` with the request body as the prompt, cwd set to the repo,
//      stdout+stderr captured to requests/<id>.log.
//   4. On exit, auto-commit any working-tree changes on the branch.
//   5. Write the final status (done|failed, exit_code, finished_at, commit) and
//      release the lockfile.
//
// This script is independent of pi so a long-running dispatch survives the
// parent pi session being closed.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, openSync, closeSync, readFileSync, writeFileSync, unlinkSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const [, , id, repoRoot, preamblePath] = process.argv;

if (!id || !repoRoot) {
  console.error("usage: run.mjs <id> <repoRoot> [preamblePath]");
  process.exit(64);
}

const reqDir = join(repoRoot, "requests");
const statusPath = join(reqDir, `${id}.status.json`);
const requestPath = join(reqDir, `${id}.md`);
const logPath = join(reqDir, `${id}.log`);
const lockPath = join(reqDir, ".lock");
const branch = `req/${id}`;

function nowIso() {
  return new Date().toISOString();
}

function readStatus() {
  try {
    return JSON.parse(readFileSync(statusPath, "utf8"));
  } catch {
    return {};
  }
}

function writeStatus(patch) {
  const merged = { ...readStatus(), ...patch };
  writeFileSync(statusPath, JSON.stringify(merged, null, 2));
}

function appendLog(text) {
  try {
    appendFileSync(logPath, text);
  } catch {}
}

function logHeader(line) {
  appendLog(`\n──── ${line} @ ${nowIso()} ────\n`);
}

function releaseLock() {
  try {
    unlinkSync(lockPath);
  } catch {}
}

function git(args, { quiet = false } = {}) {
  const r = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  if (!quiet) {
    appendLog(`$ git ${args.join(" ")}\n`);
    if (r.stdout) appendLog(r.stdout);
    if (r.stderr) appendLog(r.stderr);
  }
  return r;
}

function extractBody(md) {
  const m = /^---\n[\s\S]*?\n---\n?([\s\S]*)$/.exec(md);
  return (m ? m[1] : md).trim();
}

// ── Session title generation ──
//
// The dispatched session used to be named `req:<id>`, where <id> is a long
// mechanical timestamp+slug. That reads poorly in session lists. Instead we ask
// a cheap model for a short human-readable title derived from the request body
// and use that as the session display name. Anything that goes wrong here is
// non-fatal: we just fall back to the old `req:<id>` name.

function readGlobalSettings() {
  try {
    return JSON.parse(readFileSync(join(homedir(), ".pi", "agent", "settings.json"), "utf8"));
  } catch {
    return {};
  }
}

// Cheap model used for title generation. Precedence:
//   1. PI_PACKAGES_TITLE_MODEL env var
//   2. `piPackagesTitleModel` in ~/.pi/agent/settings.json
//   3. unset → fall back to pi's configured default model
function resolveTitleModel() {
  const fromEnv = process.env.PI_PACKAGES_TITLE_MODEL;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  const setting = readGlobalSettings().piPackagesTitleModel;
  return typeof setting === "string" && setting.trim() ? setting.trim() : null;
}

function sanitizeTitle(raw) {
  if (!raw) return "";
  // First non-empty line only; models sometimes add a preamble or trailing notes.
  let line = raw.split(/\r?\n/).map((s) => s.trim()).find(Boolean) || "";
  line = line.replace(/^["'`*#\s>\-]+/, "").replace(/["'`*\s]+$/, "");
  line = line.replace(/\s+/g, " ").trim();
  line = line.replace(/[.!?,;:]+$/, "").trim();
  if (line.length > 60) line = `${line.slice(0, 57).trimEnd()}\u2026`;
  return line;
}

function generateTitle(body) {
  const model = resolveTitleModel();
  const snippet = body.length > 4000 ? body.slice(0, 4000) : body;
  const prompt = [
    "Write a concise, human-readable title for the following change request.",
    "Requirements: imperative mood, at most 8 words, no quotes, no trailing punctuation,",
    "plain text only. Output the title and nothing else.",
    "",
    "Change request:",
    snippet,
  ].join("\n");

  // Keep the title call fast and side-effect-free: ephemeral session, no tools,
  // no extensions/skills/context discovery, thinking off.
  const args = [
    "-p",
    "--no-session",
    "--no-tools",
    "--no-extensions",
    "--no-skills",
    "--no-context-files",
    "--no-prompt-templates",
    "--no-themes",
    "--thinking",
    "off",
  ];
  if (model) args.push("--model", model);
  args.push(prompt);

  logHeader(`title generation (model=${model ?? "default"})`);
  const res = spawnSync("pi", args, { cwd: repoRoot, encoding: "utf8", timeout: 60000, env: process.env });
  if (res.error) {
    appendLog(`title generation error: ${res.error.message}\n`);
    return null;
  }
  if (res.status !== 0) {
    appendLog(`title generation exited code=${res.status}\n`);
    if (res.stderr) appendLog(res.stderr);
    return null;
  }
  const title = sanitizeTitle(res.stdout);
  if (!title) {
    appendLog("title generation produced empty output; falling back\n");
    return null;
  }
  appendLog(`generated title: ${title}\n`);
  return title;
}

async function main() {
  writeStatus({ status: "running", pid: process.pid, branch, started_at: nowIso(), exit_code: null, finished_at: null });

  logHeader(`dispatch start ${id}`);
  appendLog(`repo: ${repoRoot}\nbranch: ${branch}\npid: ${process.pid}\n`);

  // Create branch from current HEAD
  logHeader("branch creation");
  const branchRes = git(["switch", "-c", branch]);
  if (branchRes.status !== 0) {
    logHeader("branch creation failed; aborting");
    writeStatus({
      status: "failed",
      error: "branch_create_failed",
      exit_code: branchRes.status,
      finished_at: nowIso(),
    });
    releaseLock();
    process.exit(2);
  }

  // Read request body
  const md = readFileSync(requestPath, "utf8");
  const body = extractBody(md);
  if (!body) {
    logHeader("request body is empty; aborting");
    writeStatus({ status: "failed", error: "empty_body", exit_code: 64, finished_at: nowIso() });
    releaseLock();
    process.exit(64);
  }

  // Spawn pi -p
  // Derive a short, readable session title from the request body via a cheap
  // model; fall back to the old `req:<id>` name on any failure.
  const title = generateTitle(body);
  const sessionName = title ? `req: ${title}` : `req:${id}`;
  writeStatus({ title: title ?? null });

  logHeader("pi -p");
  const args = ["-p"];
  if (preamblePath && existsSync(preamblePath)) {
    args.push("--append-system-prompt", `@${preamblePath}`);
  }
  args.push("--name", sessionName, body);

  const logFd = openSync(logPath, "a");
  const child = spawn("pi", args, {
    cwd: repoRoot,
    stdio: ["ignore", logFd, logFd],
    env: process.env,
  });

  const piPid = child.pid ?? null;
  writeStatus({ pi_pid: piPid });

  child.on("error", (err) => {
    try {
      closeSync(logFd);
    } catch {}
    logHeader(`pi spawn error: ${err.message}`);
    writeStatus({ status: "failed", error: `spawn_error: ${err.message}`, exit_code: -1, finished_at: nowIso() });
    releaseLock();
    process.exit(70);
  });

  child.on("exit", (code, signal) => {
    try {
      closeSync(logFd);
    } catch {}
    logHeader(`pi exited code=${code} signal=${signal ?? ""}`);

    // Auto-commit any changes the run produced
    logHeader("auto-commit");
    git(["add", "-A"]);
    const diff = spawnSync("git", ["diff", "--cached", "--quiet"], { cwd: repoRoot });
    let commit = null;
    if (diff.status !== 0) {
      git(["commit", "-m", `req: ${id}\n\nAuto-commit from /pi-req dispatch.`]);
      const rev = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" });
      commit = rev.stdout.trim() || null;
    } else {
      appendLog("(no changes to commit)\n");
    }

    const status = code === 0 ? "done" : "failed";
    writeStatus({
      status,
      exit_code: code,
      signal: signal ?? null,
      finished_at: nowIso(),
      commit,
    });
    releaseLock();
    logHeader(`dispatch end ${id} → ${status}`);
    process.exit(0);
  });
}

main().catch((err) => {
  logHeader(`runner crashed: ${err?.message ?? String(err)}`);
  writeStatus({
    status: "failed",
    error: `runner_crash: ${err?.message ?? String(err)}`,
    finished_at: nowIso(),
  });
  releaseLock();
  process.exit(70);
});
