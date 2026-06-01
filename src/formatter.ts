/**
 * Output formatting — renders PRSummary and QualityResult in three formats:
 * terminal (colorized table), markdown (GitHub-compatible), and JSON.
 */

import chalk from "chalk";
import type {
  PRSummary,
  QualityResult,
  FileChange,
  ChangeCategory,
  ChecklistItem,
} from "./patterns.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pad or truncate a string to a fixed width */
function pad(str: string, width: number): string {
  if (str.length > width) return str.substring(0, width - 1) + "…";
  return str.padEnd(width);
}

/** Status icon for terminal output */
function statusIcon(status: ChecklistItem["status"] | QualityResult["status"]): string {
  switch (status) {
    case "pass":
      return chalk.green("✔");
    case "warning":
      return chalk.yellow("⚠");
    case "fail":
      return chalk.red("✘");
  }
}

/** Status badge for markdown output */
function statusBadge(status: ChecklistItem["status"] | QualityResult["status"]): string {
  switch (status) {
    case "pass":
      return "✅ **PASS**";
    case "warning":
      return "⚠️ **WARNING**";
    case "fail":
      return "❌ **FAIL**";
  }
}

// ---------------------------------------------------------------------------
// TERMINAL FORMAT
// ---------------------------------------------------------------------------

function formatFileTableTerminal(files: readonly FileChange[]): string {
  const lines: string[] = [];
  const colPath = 45;
  const colStatus = 10;
  const colAdd = 10;
  const colDel = 10;

  lines.push(
    chalk.bold(
      pad("File", colPath) +
        pad("Status", colStatus) +
        pad("Additions", colAdd) +
        pad("Deletions", colDel),
    ),
  );
  lines.push("─".repeat(colPath + colStatus + colAdd + colDel));

  for (const f of files) {
    const statusColor =
      f.status === "added"
        ? chalk.green
        : f.status === "deleted"
          ? chalk.red
          : f.status === "renamed"
            ? chalk.blue
            : chalk.white;

    lines.push(
      pad(f.path, colPath) +
        statusColor(pad(f.status, colStatus)) +
        chalk.green(pad(`+${f.additions}`, colAdd)) +
        chalk.red(pad(`-${f.deletions}`, colDel)),
    );
  }

  return lines.join("\n");
}

function formatCategoriesTerminal(
  categories: ReadonlyMap<ChangeCategory, readonly FileChange[]>,
): string {
  const lines: string[] = [];

  for (const [category, files] of categories) {
    lines.push(chalk.bold.cyan(`\n■ ${category}`));
    for (const f of files) {
      const changeSummary =
        f.additions + f.deletions > 0
          ? chalk.dim(` (+${f.additions}/-${f.deletions})`)
          : "";
      lines.push(`  ${f.path}${changeSummary}`);
    }
  }

  return lines.join("\n");
}

function formatChecklistTerminal(checklist: readonly ChecklistItem[]): string {
  const lines: string[] = [];

  for (const item of checklist) {
    lines.push(`${statusIcon(item.status)}  ${item.label}`);
    lines.push(chalk.dim(`   ${item.detail}`));
  }

  return lines.join("\n");
}

export function formatTerminal(summary: PRSummary): string {
  const sections: string[] = [];

  // Header
  sections.push(
    chalk.bold.white("━".repeat(60)),
    chalk.bold.white("  PR Summary"),
    chalk.bold.white("━".repeat(60)),
  );

  // Summary paragraph
  sections.push(chalk.bold("\n📝 Summary"));
  sections.push(summary.summaryParagraph);

  // Stats
  sections.push(chalk.bold("\n📊 Stats"));
  sections.push(
    `  Files changed: ${summary.files.length}  |  ` +
      chalk.green(`+${summary.totalAdditions}`) +
      "  " +
      chalk.red(`-${summary.totalDeletions}`),
  );

  // Breaking changes
  if (summary.breakingChanges.length > 0) {
    sections.push(chalk.bold.red("\n⚠️  Breaking Changes"));
    for (const msg of summary.breakingChanges) {
      sections.push(chalk.red(`  • ${msg}`));
    }
  }

  // Categories
  sections.push(chalk.bold("\n📂 Change Categories"));
  sections.push(formatCategoriesTerminal(summary.categories));

  // Files table
  sections.push(chalk.bold("\n📄 Files Changed"));
  sections.push(formatFileTableTerminal(summary.files));

  // Checklist
  sections.push(chalk.bold("\n✅ Review Checklist"));
  sections.push(formatChecklistTerminal(summary.checklist));

  sections.push(chalk.bold.white("\n" + "━".repeat(60)));

  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// MARKDOWN FORMAT
// ---------------------------------------------------------------------------

function formatFileTableMarkdown(files: readonly FileChange[]): string {
  const lines: string[] = [
    "| File | Status | Additions | Deletions |",
    "|------|--------|-----------|-----------|",
  ];

  for (const f of files) {
    lines.push(
      `| \`${f.path}\` | ${f.status} | +${f.additions} | -${f.deletions} |`,
    );
  }

  return lines.join("\n");
}

function formatCategoriesMarkdown(
  categories: ReadonlyMap<ChangeCategory, readonly FileChange[]>,
): string {
  const lines: string[] = [];

  for (const [category, files] of categories) {
    lines.push(`### ${category}`);
    for (const f of files) {
      lines.push(
        `- \`${f.path}\` (+${f.additions}/-${f.deletions}, ${f.status})`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function formatMarkdown(summary: PRSummary): string {
  const sections: string[] = [];

  sections.push("## 🤖 PR Summary\n");
  sections.push(summary.summaryParagraph);

  // Stats
  sections.push(
    `**Stats:** ${summary.files.length} files changed | ` +
      `+${summary.totalAdditions} additions | -${summary.totalDeletions} deletions\n`,
  );

  // Breaking changes
  if (summary.breakingChanges.length > 0) {
    sections.push("### ⚠️ Breaking Changes\n");
    for (const msg of summary.breakingChanges) {
      sections.push(`- ${msg}`);
    }
    sections.push("");
  }

  // Categories
  sections.push("## 📂 Changes by Category\n");
  sections.push(formatCategoriesMarkdown(summary.categories));

  // Files table
  sections.push("## 📄 Files Changed\n");
  sections.push(formatFileTableMarkdown(summary.files));
  sections.push("");

  // Checklist
  sections.push("## ✅ Review Checklist\n");
  for (const item of summary.checklist) {
    sections.push(
      `- ${statusBadge(item.status)} ${item.label} — ${item.detail}`,
    );
  }
  sections.push("");

  sections.push(
    "---\n*Generated by [pr-summarizer](https://github.com/katogatogato/pr-summarizer)*",
  );

  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// JSON FORMAT
// ---------------------------------------------------------------------------

interface JsonOutput {
  summary: string;
  stats: {
    filesChanged: number;
    totalAdditions: number;
    totalDeletions: number;
  };
  breakingChanges: readonly string[];
  categories: Record<string, readonly FileChange[]>;
  files: readonly FileChange[];
  checklist: readonly ChecklistItem[];
}

export function formatJson(summary: PRSummary): string {
  // Convert Map to plain object for JSON serialization
  const categoriesObj: Record<string, FileChange[]> = {};
  for (const [category, files] of summary.categories) {
    categoriesObj[category] = [...files];
  }

  const output: JsonOutput = {
    summary: summary.summaryParagraph,
    stats: {
      filesChanged: summary.files.length,
      totalAdditions: summary.totalAdditions,
      totalDeletions: summary.totalDeletions,
    },
    breakingChanges: summary.breakingChanges,
    categories: categoriesObj,
    files: [...summary.files],
    checklist: [...summary.checklist],
  };

  return JSON.stringify(output, null, 2);
}

// ---------------------------------------------------------------------------
// Quality check formatting
// ---------------------------------------------------------------------------

export function formatQualityTerminal(
  results: readonly QualityResult[],
  passCount: number,
  warningCount: number,
  failCount: number,
): string {
  const lines: string[] = [];

  lines.push(chalk.bold.white("━".repeat(60)));
  lines.push(chalk.bold.white("  PR Quality Check"));
  lines.push(chalk.bold.white("━".repeat(60)));

  for (const r of results) {
    lines.push(`${statusIcon(r.status)}  ${r.label}`);
    lines.push(chalk.dim(`   ${r.detail}`));
    if (r.filePath) {
      lines.push(chalk.dim(`   File: ${r.filePath}`));
    }
  }

  lines.push("");
  lines.push(
    chalk.bold("Summary: ") +
      chalk.green(`${passCount} pass`) +
      "  " +
      chalk.yellow(`${warningCount} warnings`) +
      "  " +
      chalk.red(`${failCount} failures`),
  );

  if (failCount > 0) {
    lines.push(chalk.red("\n❌ Quality check failed. Fix the issues above."));
  } else {
    lines.push(chalk.green("\n✅ Quality check passed."));
  }

  return lines.join("\n");
}

export function formatQualityMarkdown(
  results: readonly QualityResult[],
  passCount: number,
  warningCount: number,
  failCount: number,
): string {
  const lines: string[] = [];

  lines.push("## 🔍 PR Quality Check\n");

  for (const r of results) {
    lines.push(
      `- ${statusBadge(r.status)} **${r.label}** — ${r.detail}${r.filePath ? ` (${r.filePath})` : ""}`,
    );
  }

  lines.push(
    `\n**Summary:** ${passCount} pass · ${warningCount} warnings · ${failCount} failures`,
  );

  return lines.join("\n");
}

export function formatQualityJson(
  results: readonly QualityResult[],
  passCount: number,
  warningCount: number,
  failCount: number,
): string {
  return JSON.stringify(
    {
      results,
      summary: { passCount, warningCount, failCount },
      passed: failCount === 0,
    },
    null,
    2,
  );
}
