/**
 * GitHub integration — post PR comments and create PRs using the `gh` CLI.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Run a `gh` CLI command.
 */
async function gh(
  args: readonly string[],
  cwd?: string,
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync("gh", args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
    });
    return result;
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Unknown gh CLI failure";
    throw new Error(`gh command failed: gh ${args.join(" ")}\n${message}`);
  }
}

/**
 * Check if the current branch has an associated PR.
 * Returns the PR number or null if none exists.
 */
export async function getExistingPRNumber(
  cwd?: string,
): Promise<number | null> {
  try {
    const { stdout } = await gh(
      ["pr", "list", "--head", "HEAD", "--json", "number", "--limit", "1"],
      cwd,
    );
    const parsed = JSON.parse(stdout) as Array<{ number: number }>;
    if (parsed.length > 0) {
      return parsed[0]!.number;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Post a comment on an existing PR.
 */
export async function postPRComment(
  prNumber: number,
  body: string,
  cwd?: string,
): Promise<void> {
  // Write the comment body to a temp file to avoid shell escaping issues
  const { writeFile, unlink } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");

  const tmpFile = join(tmpdir(), `pr-summarizer-comment-${Date.now()}.md`);
  try {
    await writeFile(tmpFile, body, "utf-8");
    await gh(
      ["pr", "comment", String(prNumber), "--body-file", tmpFile],
      cwd,
    );
  } finally {
    try {
      await unlink(tmpFile);
    } catch {
      // Best-effort cleanup
    }
  }
}

/**
 * Create a new PR with the summary as the body.
 * Returns the PR URL.
 */
export async function createPR(
  title: string,
  body: string,
  options?: { baseBranch?: string; draft?: boolean; cwd?: string },
): Promise<string> {
  const { writeFile, unlink } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");

  const tmpFile = join(tmpdir(), `pr-summarizer-body-${Date.now()}.md`);
  try {
    await writeFile(tmpFile, body, "utf-8");

    const args = [
      "pr",
      "create",
      "--title",
      title,
      "--body-file",
      tmpFile,
    ];

    if (options?.baseBranch) {
      args.push("--base", options.baseBranch);
    }

    if (options?.draft) {
      args.push("--draft");
    }

    const { stdout } = await gh(args, options?.cwd);
    return stdout.trim();
  } finally {
    try {
      await unlink(tmpFile);
    } catch {
      // Best-effort cleanup
    }
  }
}

/**
 * Get the current branch name via gh CLI (fallback to git).
 */
export async function getBranchName(cwd?: string): Promise<string> {
  try {
    const { execFile: exec } = await import("node:child_process");
    const { promisify: prom } = await import("node:util");
    const execAsync = prom(exec);
    const { stdout } = await execAsync("git", ["branch", "--show-current"], {
      cwd,
    });
    return stdout.trim();
  } catch {
    return "main";
  }
}
