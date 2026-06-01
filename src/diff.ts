/**
 * Git diff parsing — spawns git commands via child_process and parses
 * unified diff output into structured data.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FileChange, FileStatus, CommitInfo } from "./patterns.js";
import { categorizeFile } from "./patterns.js";

const execFileAsync = promisify(execFile);

/** Options for running git commands */
export interface GitOptions {
  readonly cwd?: string;
  readonly baseBranch?: string;
}

// ---------------------------------------------------------------------------
// Git command helpers
// ---------------------------------------------------------------------------

/**
 * Run a git command and return its stdout.
 * Throws a friendly error if the command fails.
 */
async function git(
  args: readonly string[],
  options?: GitOptions,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: options?.cwd,
      maxBuffer: 50 * 1024 * 1024, // 50 MB — large diffs
    });
    return stdout;
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Unknown git command failure";
    throw new Error(`Git command failed: git ${args.join(" ")}\n${message}`);
  }
}

/**
 * Determine the current branch name.
 */
export async function getCurrentBranch(cwd?: string): Promise<string> {
  return git(["branch", "--show-current"], { cwd }).then((s) => s.trim());
}

/**
 * Check whether baseBranch exists in the repo (local or remote).
 * Falls back to origin/<baseBranch> if the local ref is missing.
 */
export async function resolveBaseBranch(
  baseBranch: string,
  cwd?: string,
): Promise<string> {
  try {
    await git(["rev-parse", "--verify", baseBranch], { cwd });
    return baseBranch;
  } catch {
    // Try remote ref
    const remote = `origin/${baseBranch}`;
    try {
      await git(["rev-parse", "--verify", remote], { cwd });
      return remote;
    } catch {
      throw new Error(
        `Could not resolve base branch "${baseBranch}". ` +
          "Make sure it exists locally or run 'git fetch origin'.",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Diff stat parsing (numstat for +/− counts)
// ---------------------------------------------------------------------------

interface RawFileEntry {
  readonly path: string;
  readonly status: FileStatus;
  readonly additions: number;
  readonly deletions: number;
}

/**
 * Parse git diff --numstat and git diff --name-status together.
 * Returns one entry per changed file with additions/deletions and status.
 */
export async function getDiffEntries(
  baseBranch: string,
  cwd?: string,
): Promise<readonly RawFileEntry[]> {
  // numstat gives us additions and deletions per file
  const numstat = await git(
    ["diff", "--numstat", `${baseBranch}...HEAD`],
    { cwd },
  );

  // name-status gives us the rename / add / delete info
  const nameStatus = await git(
    ["diff", "--name-status", `${baseBranch}...HEAD`],
    { cwd },
  );

  const statusMap = new Map<string, FileStatus>();
  for (const line of nameStatus.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Format: "STATUS\tPATH" or "STATUS\tOLD_PATH\tNEW_PATH" for renames
    const parts = trimmed.split("\t");
    const code = parts[0]!.substring(0, 1);
    const filePath = parts.length >= 3 ? parts[2]! : parts[1]!;

    let status: FileStatus;
    switch (code) {
      case "A":
        status = "added";
        break;
      case "D":
        status = "deleted";
        break;
      case "R":
        status = "renamed";
        break;
      default:
        status = "modified";
        break;
    }
    statusMap.set(filePath, status);
  }

  const entries: RawFileEntry[] = [];
  for (const line of numstat.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split("\t");
    if (parts.length < 3) continue;

    const additions = parts[0] === "-" ? 0 : parseInt(parts[0]!, 10);
    const deletions = parts[1] === "-" ? 0 : parseInt(parts[1]!, 10);
    const filePath = parts[2]!;

    // For renames, numstat uses the new path; name-status may list both
    const status = statusMap.get(filePath) ?? "modified";

    entries.push({ path: filePath, status, additions, deletions });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Full diff content (for pattern scanning)
// ---------------------------------------------------------------------------

/**
 * Get the full unified diff between base and HEAD.
 */
export async function getFullDiff(
  baseBranch: string,
  cwd?: string,
): Promise<string> {
  return git(["diff", `${baseBranch}...HEAD`], { cwd });
}

/**
 * Get the diff for a specific file.
 */
export async function getFileDiff(
  baseBranch: string,
  filePath: string,
  cwd?: string,
): Promise<string> {
  return git(["diff", baseBranch + "...HEAD", "--", filePath], { cwd });
}

// ---------------------------------------------------------------------------
// Commit log parsing
// ---------------------------------------------------------------------------

/**
 * Get commit log between base and HEAD in a structured format.
 */
export async function getCommitLog(
  baseBranch: string,
  cwd?: string,
): Promise<readonly CommitInfo[]> {
  const logFormat = "%H%x00%s%x00%an%x00%ai";
  const prettyArg = "--pretty=format:" + logFormat;
  const raw = await git(
    ["log", baseBranch + "...HEAD", prettyArg],
    { cwd },
  );

  if (!raw.trim()) return [];

  const commits: CommitInfo[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const [hash, message, author, date] = trimmed.split("\0") as [
      string,
      string,
      string,
      string,
    ];

    commits.push({ hash, message, author, date });
  }

  return commits;
}

// ---------------------------------------------------------------------------
// Combined: build FileChange[] with diff content
// ---------------------------------------------------------------------------

/**
 * Collect a complete list of FileChange objects for all changes between
 * baseBranch and HEAD. Each entry includes its diff content.
 */
export async function collectFileChanges(
  baseBranch: string,
  cwd?: string,
): Promise<readonly FileChange[]> {
  const entries = await getDiffEntries(baseBranch, cwd);

  // Fetch per-file diffs in parallel (bounded to 20 concurrent)
  const fileChanges: FileChange[] = [];
  const batchSize = 20;

  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    const diffs = await Promise.all(
      batch.map((entry) => getFileDiff(baseBranch, entry.path, cwd)),
    );

    for (let j = 0; j < batch.length; j++) {
      const entry = batch[j]!;
      const diffContent = diffs[j] ?? "";
      fileChanges.push({
        path: entry.path,
        status: entry.status,
        additions: entry.additions,
        deletions: entry.deletions,
        category: categorizeFile(entry.path),
        diffContent,
      });
    }
  }

  return fileChanges;
}
