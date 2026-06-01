/**
 * Summary generation — produces the PR description paragraph,
 * categorized change list, and an auto-generated review checklist.
 */

import type {
  FileChange,
  ChangeCategory,
  CommitInfo,
  ChecklistItem,
  PRSummary,
} from "./patterns.js";
import {
  VERY_LARGE_FILE_THRESHOLD,
  LARGE_FILE_THRESHOLD,
} from "./patterns.js";
import {
  groupByCategory,
  computeTotals,
  detectBreakingChanges,
  hasMixedConcerns,
  hasTestChanges,
  hasCodeChanges,
  findLargeFiles,
} from "./analyzer.js";

// ---------------------------------------------------------------------------
// Summary paragraph generation (heuristic)
// ---------------------------------------------------------------------------

/**
 * Generate a 2-3 sentence summary paragraph based on the diff analysis.
 * Uses heuristics: file categories, addition/deletion ratio, commit messages.
 */
export function generateSummaryParagraph(
  files: readonly FileChange[],
  commits: readonly CommitInfo[],
  totalAdditions: number,
  totalDeletions: number,
): string {
  const categories = groupByCategory(files);
  const categoryNames = Array.from(categories.keys());

  // Build a sentence about scope
  const fileCount = files.length;
  const netLines = totalAdditions - totalDeletions;
  const isNetPositive = netLines >= 0;

  // Identify primary areas of change
  const primaryAreas = categoryNames.filter(
    (c) => c !== "Other" && c !== "Dependencies",
  );
  const areaPhrase =
    primaryAreas.length > 0
      ? primaryAreas.join(", ").toLowerCase()
      : "the codebase";

  // Sentence 1: What and how much
  const linesPhrase = isNetPositive
    ? `+${netLines} net lines`
    : `${Math.abs(netLines)} net lines removed`;
  const sentence1 =
    `This PR modifies ${fileCount} file${fileCount === 1 ? "" : "s"} across ${areaPhrase}, ` +
    `with ${totalAdditions} additions and ${totalDeletions} deletions (${linesPhrase}).`;

  // Sentence 2: What it does (derived from commit messages)
  const commitSubjects = commits.map((c) => {
    // Take first line / first 80 chars of message
    const firstLine = c.message.split("\n")[0] ?? c.message;
    return firstLine.length > 80 ? firstLine.substring(0, 77) + "..." : firstLine;
  });

  let sentence2: string;
  if (commitSubjects.length === 0) {
    sentence2 = "The changes include updates to the areas listed above.";
  } else if (commitSubjects.length === 1) {
    sentence2 = `The primary change: ${commitSubjects[0]}.`;
  } else {
    // Pick the most representative commit messages (up to 3)
    const representative = commitSubjects.slice(0, 3);
    sentence2 =
      `Key changes include: ${representative.join("; ")}.`;
  }

  // Sentence 3: Risk / impact signal
  const breaking = detectBreakingChanges(commits);
  let sentence3: string;
  if (breaking.length > 0) {
    sentence3 =
      `⚠️ This PR includes breaking changes — review carefully for migration requirements.`;
  } else if (findLargeFiles(files, VERY_LARGE_FILE_THRESHOLD).length > 0) {
    sentence3 =
      `Some files have substantial changes (>500 lines); consider reviewing in sections.`;
  } else if (totalAdditions + totalDeletions > 1000) {
    sentence3 = `This is a moderately large change set; thorough review is recommended.`;
  } else {
    sentence3 = `This is a focused change set with a clear scope.`;
  }

  return `${sentence1} ${sentence2} ${sentence3}`;
}

// ---------------------------------------------------------------------------
// Review checklist generation
// ---------------------------------------------------------------------------

/**
 * Auto-generate review checklist items based on patterns found in the diff.
 */
export function generateChecklist(
  files: readonly FileChange[],
  commits: readonly CommitInfo[],
): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const categories = groupByCategory(files);

  // New dependencies
  const depFiles = categories.get("Dependencies");
  if (depFiles && depFiles.length > 0) {
    // Check if package.json actually changed (not just lockfile)
    const hasPackageJson = depFiles.some((f) =>
      f.path.endsWith("package.json"),
    );
    if (hasPackageJson) {
      items.push({
        label: "Review new dependencies",
        status: "warning",
        detail:
          "New dependencies were added — verify security, license compatibility, and bundle size impact.",
      });
    }
  }

  // Database changes
  const dbFiles = categories.get("Database Changes");
  if (dbFiles && dbFiles.length > 0) {
    items.push({
      label: "Verify database migrations",
      status: "warning",
      detail:
        "Database-related files were modified — ensure migrations are reversible and data loss is not introduced.",
    });
  }

  // Security / auth changes
  const secFiles = categories.get("Security Changes");
  if (secFiles && secFiles.length > 0) {
    items.push({
      label: "Security review required",
      status: "fail",
      detail:
        "Authentication or security-related files were changed — require thorough security review.",
    });
  }

  // Config changes
  const cfgFiles = categories.get("Configuration");
  if (cfgFiles && cfgFiles.length > 0) {
    items.push({
      label: "Check configuration changes",
      status: "warning",
      detail:
        "Configuration files were modified — verify environment-specific settings are correct.",
    });
  }

  // Large files (>500 lines)
  const veryLargeFiles = findLargeFiles(files, VERY_LARGE_FILE_THRESHOLD);
  if (veryLargeFiles.length > 0) {
    for (const f of veryLargeFiles) {
      items.push({
        label: `Large file: ${f.path}`,
        status: "warning",
        detail:
          `This file has ${f.additions + f.deletions} changed lines (>500). Consider breaking into smaller PRs.`,
      });
    }
  }

  // Missing tests
  const codeChanged = hasCodeChanges(files);
  const testsChanged = hasTestChanges(files);
  if (codeChanged && !testsChanged) {
    items.push({
      label: "Consider adding tests",
      status: "warning",
      detail:
        "Code was changed but no test files were modified — consider adding test coverage.",
    });
  }

  // Mixed concerns
  if (hasMixedConcerns(files)) {
    items.push({
      label: "Mixed frontend/backend changes",
      status: "warning",
      detail:
        "This PR includes both frontend and backend changes — consider splitting into separate PRs for easier review.",
    });
  }

  // Breaking changes
  const breaking = detectBreakingChanges(commits);
  if (breaking.length > 0) {
    items.push({
      label: "Breaking changes detected",
      status: "fail",
      detail:
        `Found ${breaking.length} commit(s) with breaking-change indicators. Verify migration paths are documented.`,
    });
  }

  // Default pass if nothing triggered
  if (items.length === 0) {
    items.push({
      label: "No issues detected",
      status: "pass",
      detail: "No automated review concerns were identified.",
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// Full summary
// ---------------------------------------------------------------------------

/**
 * Build a complete PRSummary from files and commits.
 */
export function buildPRSummary(
  files: readonly FileChange[],
  commits: readonly CommitInfo[],
): PRSummary {
  const { totalAdditions, totalDeletions } = computeTotals(files);
  const categories = groupByCategory(files);
  const summaryParagraph = generateSummaryParagraph(
    files,
    commits,
    totalAdditions,
    totalDeletions,
  );
  const checklist = generateChecklist(files, commits);
  const breakingChanges = detectBreakingChanges(commits);

  return {
    summaryParagraph,
    categories,
    files,
    checklist,
    breakingChanges,
    totalAdditions,
    totalDeletions,
  };
}
