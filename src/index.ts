/**
 * CLI entry point + GitHub Action entry point.
 *
 * - CLI: Uses commander to expose `generate`, `post`, and `check` commands.
 * - GitHub Action: When GITHUB_ACTIONS env var is set, runs as a GitHub Action.
 */

import { Command } from "commander";
import chalk from "chalk";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { resolveBaseBranch, collectFileChanges, getCommitLog } from "./diff.js";
import { analyzeDiff } from "./analyzer.js";
import { buildPRSummary } from "./summary.js";
import { runQualityChecks } from "./quality.js";
import {
  getExistingPRNumber,
  postPRComment,
  createPR,
} from "./github.js";
import {
  formatTerminal,
  formatMarkdown,
  formatJson,
  formatQualityTerminal,
  formatQualityMarkdown,
  formatQualityJson,
} from "./formatter.js";

// ---------------------------------------------------------------------------
// Shared options type
// ---------------------------------------------------------------------------

interface GlobalOptions {
  base: string;
  format: "terminal" | "markdown" | "json";
  output?: string;
  draft?: boolean;
}

// ---------------------------------------------------------------------------
// "generate" command
// ---------------------------------------------------------------------------

async function generateCommand(
  path: string | undefined,
  options: GlobalOptions,
): Promise<void> {
  const cwd = path ? resolve(path) : process.cwd();

  console.log(chalk.dim(`Analyzing diff against "${options.base}"...\n`));

  const baseBranch = await resolveBaseBranch(options.base, cwd);
  const files = await collectFileChanges(baseBranch, cwd);
  const commits = await getCommitLog(baseBranch, cwd);

  if (files.length === 0) {
    console.log(chalk.yellow("No changes detected between HEAD and base branch."));
    return;
  }

  const summary = buildPRSummary(files, commits);

  let output: string;
  switch (options.format) {
    case "markdown":
      output = formatMarkdown(summary);
      break;
    case "json":
      output = formatJson(summary);
      break;
    case "terminal":
    default:
      output = formatTerminal(summary);
      break;
  }

  if (options.output) {
    writeFileSync(options.output, output, "utf-8");
    console.log(chalk.green(`Summary written to ${options.output}`));
  } else {
    console.log(output);
  }
}

// ---------------------------------------------------------------------------
// "post" command
// ---------------------------------------------------------------------------

async function postCommand(
  path: string | undefined,
  options: GlobalOptions,
): Promise<void> {
  const cwd = path ? resolve(path) : process.cwd();

  console.log(chalk.dim("Generating PR summary...\n"));

  const baseBranch = await resolveBaseBranch(options.base, cwd);
  const files = await collectFileChanges(baseBranch, cwd);
  const commits = await getCommitLog(baseBranch, cwd);

  if (files.length === 0) {
    console.log(chalk.yellow("No changes detected. Nothing to post."));
    return;
  }

  const summary = buildPRSummary(files, commits);
  const markdownBody = formatMarkdown(summary);

  // Try to find an existing PR
  const existingPR = await getExistingPRNumber(cwd);

  if (existingPR) {
    console.log(chalk.dim(`Found existing PR #${existingPR}. Posting comment...`));
    await postPRComment(existingPR, markdownBody, cwd);
    console.log(chalk.green(`✅ Summary posted as comment on PR #${existingPR}`));
  } else {
    // Create a new PR
    const title = generatePRTitle(commits, files);
    console.log(chalk.dim("No existing PR found. Creating a new one..."));

    const prUrl = await createPR(title, markdownBody, {
      baseBranch: options.base,
      draft: options.draft,
      cwd,
    });

    console.log(chalk.green(`✅ PR created: ${prUrl}`));
  }
}

/**
 * Generate a sensible default PR title from commits or file changes.
 */
function generatePRTitle(
  commits: readonly { message: string }[],
  files: readonly { path: string }[],
): string {
  if (commits.length === 1) {
    const msg = commits[0]!.message.split("\n")[0]!;
    return msg.length > 72 ? msg.substring(0, 69) + "..." : msg;
  }

  // Try to find a common theme from commit messages
  const subjects = commits.map((c) => c.message.split("\n")[0]!);
  if (subjects.length > 0 && subjects.length <= 3) {
    return subjects.join(" + ");
  }

  // Fallback: describe the scope
  const dirSet = new Set<string>();
  for (const f of files) {
    const parts = f.path.split("/");
    if (parts.length > 1) {
      dirSet.add(parts[0]!);
    }
  }

  if (dirSet.size === 1) {
    const dir = dirSet.values().next().value!;
    return `Update ${dir}/ (${files.length} files)`;
  }

  return `Update ${files.length} files across ${dirSet.size} directories`;
}

// ---------------------------------------------------------------------------
// "check" command
// ---------------------------------------------------------------------------

async function checkCommand(
  path: string | undefined,
  options: GlobalOptions,
): Promise<void> {
  const cwd = path ? resolve(path) : process.cwd();

  console.log(chalk.dim(`Running quality checks against "${options.base}"...\n`));

  const baseBranch = await resolveBaseBranch(options.base, cwd);
  const files = await collectFileChanges(baseBranch, cwd);
  const commits = await getCommitLog(baseBranch, cwd);

  if (files.length === 0) {
    console.log(chalk.yellow("No changes detected. Nothing to check."));
    process.exit(0);
    return;
  }

  const { results, hasFailures, passCount, warningCount, failCount } =
    runQualityChecks(files, commits);

  let output: string;
  switch (options.format) {
    case "markdown":
      output = formatQualityMarkdown(results, passCount, warningCount, failCount);
      break;
    case "json":
      output = formatQualityJson(results, passCount, warningCount, failCount);
      break;
    case "terminal":
    default:
      output = formatQualityTerminal(results, passCount, warningCount, failCount);
      break;
  }

  if (options.output) {
    writeFileSync(options.output, output, "utf-8");
    console.log(chalk.green(`Quality report written to ${options.output}`));
  } else {
    console.log(output);
  }

  process.exit(hasFailures ? 1 : 0);
}

// ---------------------------------------------------------------------------
// GitHub Action entry
// ---------------------------------------------------------------------------

async function runGitHubAction(): Promise<void> {
  const githubToken = process.env.INPUT_GITHUB_TOKEN ?? "";
  const baseBranch =
    process.env.INPUT_BASE_BRANCH ?? "main";
  const shouldPost =
    (process.env.INPUT_POST_COMMENT ?? "true") === "true";

  if (!githubToken) {
    console.error("Error: github-token input is required.");
    process.exit(1);
  }

  // Set token for gh CLI
  process.env.GH_TOKEN = githubToken;

  console.log(`Running PR Summarizer against "${baseBranch}"...`);

  const files = await collectFileChanges(baseBranch);
  const commits = await getCommitLog(baseBranch);

  if (files.length === 0) {
    console.log("No changes detected. Nothing to summarize.");
    return;
  }

  const summary = buildPRSummary(files, commits);
  const markdownBody = formatMarkdown(summary);

  if (shouldPost) {
    const existingPR = await getExistingPRNumber();
    if (existingPR) {
      await postPRComment(existingPR, markdownBody);
      console.log(`Summary posted as comment on PR #${existingPR}`);
    } else {
      console.log("No existing PR found. Skipping comment.");
    }
  } else {
    // Output to GitHub Actions summary
    const fs = await import("node:fs");
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (summaryPath) {
      fs.appendFileSync(summaryPath, markdownBody + "\n");
    } else {
      console.log(markdownBody);
    }
  }
}

// ---------------------------------------------------------------------------
// CLI setup
// ---------------------------------------------------------------------------

export function createProgram(): Command {
  const program = new Command();

  program
    .name("pr-summarizer")
    .description(
      "Auto-generate PR descriptions and review checklists from git diffs",
    )
    .version("1.0.0");

  // generate
  program
    .command("generate")
    .description("Generate a PR summary from the current diff")
    .argument("[path]", "Path to the git repository", ".")
    .option("--base <branch>", "Base branch to diff against", "main")
    .option(
      "--format <fmt>",
      "Output format: terminal, markdown, json",
      "terminal",
    )
    .option("--output <file>", "Write output to file instead of stdout")
    .action(async (path: string, opts: GlobalOptions) => {
      try {
        await generateCommand(path, opts);
      } catch (err: unknown) {
        console.error(
          chalk.red("Error:"),
          err instanceof Error ? err.message : String(err),
        );
        process.exit(1);
      }
    });

  // post
  program
    .command("post")
    .description("Generate summary and post/create a PR on GitHub")
    .argument("[path]", "Path to the git repository", ".")
    .option("--base <branch>", "Base branch to diff against", "main")
    .option("--draft", "Create as draft PR", false)
    .option(
      "--format <fmt>",
      "Output format (unused for post — always markdown)",
      "markdown",
    )
    .action(async (path: string, opts: GlobalOptions) => {
      try {
        await postCommand(path, opts);
      } catch (err: unknown) {
        console.error(
          chalk.red("Error:"),
          err instanceof Error ? err.message : String(err),
        );
        process.exit(1);
      }
    });

  // check
  program
    .command("check")
    .description("Run quality checks on the current diff")
    .argument("[path]", "Path to the git repository", ".")
    .option("--base <branch>", "Base branch to diff against", "main")
    .option(
      "--format <fmt>",
      "Output format: terminal, markdown, json",
      "terminal",
    )
    .option("--output <file>", "Write output to file instead of stdout")
    .action(async (path: string, opts: GlobalOptions) => {
      try {
        await checkCommand(path, opts);
      } catch (err: unknown) {
        console.error(
          chalk.red("Error:"),
          err instanceof Error ? err.message : String(err),
        );
        process.exit(1);
      }
    });

  return program;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // GitHub Action mode
  if (process.env.GITHUB_ACTIONS === "true" && process.env.INPUT_GITHUB_TOKEN) {
    await runGitHubAction();
    return;
  }

  // CLI mode
  const program = createProgram();
  program.parse();
}

main().catch((err: unknown) => {
  console.error(
    chalk.red("Fatal:"),
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
});
