import { execFile } from "node:child_process";
import type { Theme, ThemeColor } from "@mariozechner/pi-coding-agent";
import type { Icons } from "./icons.ts";

export type GitInfo = {
  branch: string;
  staged: number;
  unstaged: number;
  untracked: number;
  ahead: number;
  behind: number;
  stashed: number;
  isWorktree: boolean;
};

const GIT_CACHE_TTL_MS = 2000;
let cachedGitInfo: GitInfo | null | undefined;
let cachedCwd: string | undefined;
let cachedAt = 0;
let fetchInFlight = false;
let onUpdate: (() => void) | undefined;

export function setGitUpdateCallback(cb: () => void): void {
  onUpdate = cb;
}

export function resetGitCache(): void {
  cachedGitInfo = undefined;
  cachedCwd = undefined;
  cachedAt = 0;
  fetchInFlight = false;
}

function runGitAsync(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, {
      cwd,
      encoding: "utf8",
      timeout: 1000,
    }, (err, stdout) => {
      if (err) reject(err);
      else resolve((stdout ?? "").trimEnd());
    });
  });
}

function parseBranchHeader(header: string): Pick<GitInfo, "branch" | "ahead" | "behind"> {
  const body = header.replace(/^##\s+/, "");
  const [branchPart = "detached", statusPart = ""] = body.split(" [", 2);
  const branch = branchPart.split("...")[0] || "detached";
  const ahead = Number(statusPart.match(/ahead (\d+)/)?.[1] ?? 0);
  const behind = Number(statusPart.match(/behind (\d+)/)?.[1] ?? 0);
  return { branch, ahead, behind };
}

async function fetchGitInfo(cwd: string): Promise<GitInfo | null> {
  try {
    const status = await runGitAsync(cwd, ["status", "--porcelain=v1", "--branch"]);
    const lines = status.split("\n").filter(Boolean);
    const header = lines.find((line) => line.startsWith("## ")) ?? "## detached";
    const branchInfo = parseBranchHeader(header);

    let staged = 0;
    let unstaged = 0;
    let untracked = 0;

    for (const line of lines) {
      if (line.startsWith("## ")) continue;
      const indexStatus = line[0];
      const worktreeStatus = line[1];

      if (indexStatus === "?" && worktreeStatus === "?") {
        untracked++;
        continue;
      }

      if (indexStatus && indexStatus !== " ") staged++;
      if (worktreeStatus && worktreeStatus !== " ") unstaged++;
    }

    const stashOutput = await runGitAsync(cwd, ["stash", "list"]);
    const stashed = stashOutput ? stashOutput.split("\n").filter(Boolean).length : 0;
    const gitDir = await runGitAsync(cwd, ["rev-parse", "--git-dir"]);
    const commonDir = await runGitAsync(cwd, ["rev-parse", "--git-common-dir"]);
    const isWorktree = gitDir !== commonDir && gitDir.includes("/worktrees/");

    return { ...branchInfo, staged, unstaged, untracked, stashed, isWorktree };
  } catch {
    return null;
  }
}

export function getGitInfo(cwd: string | undefined): GitInfo | null {
  if (!cwd) return null;

  const now = Date.now();
  const cacheValid = cachedCwd === cwd && now - cachedAt < GIT_CACHE_TTL_MS;

  if (!cacheValid && !fetchInFlight) {
    fetchInFlight = true;
    fetchGitInfo(cwd).then((info) => {
      cachedGitInfo = info;
      cachedCwd = cwd;
      cachedAt = Date.now();
      fetchInFlight = false;
      onUpdate?.();
    });
  }

  if (cachedCwd === cwd && cachedGitInfo !== undefined) {
    return cachedGitInfo;
  }

  return null;
}

function formatGitCount(symbol: string, count: number, color: ThemeColor, theme: Theme): string | undefined {
  if (count <= 0) return undefined;
  return theme.fg(color, `${symbol} ${count}`);
}

export function formatGitInfo(info: GitInfo, icons: Icons, theme: Theme, icon: (text: string) => string): string {
  const branchIcon = info.isWorktree ? icons.worktreeBranch : icons.branch;
  const branch = `${icon(branchIcon)} ${info.branch}`;
  const divergence = [
    info.ahead > 0 && info.behind > 0 ? formatGitCount(icons.diverged, 1, "error", theme) : undefined,
    formatGitCount(icons.ahead, info.ahead, "success", theme),
    formatGitCount(icons.behind, info.behind, "warning", theme),
  ].filter((part): part is string => Boolean(part));
  const fileStatuses = [
    formatGitCount(icons.staged, info.staged, "success", theme),
    formatGitCount(icons.unstaged, info.unstaged, "warning", theme),
    formatGitCount(icons.untracked, info.untracked, "error", theme),
    formatGitCount(icons.stashed, info.stashed, "warning", theme),
  ].filter((part): part is string => Boolean(part));

  const groups = [branch];
  if (divergence.length) groups.push(divergence.join(" "));
  if (fileStatuses.length) groups.push(fileStatuses.join(" "));
  return groups.join(` ${icon(icons.separator)} `);
}
