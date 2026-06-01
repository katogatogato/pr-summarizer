/**
 * Diff analysis — categorizes changes, detects patterns (breaking changes,
 * mixed concerns, large files, missing tests, etc.).
 */

import type {
  FileChange,
  ChangeCategory,
  CommitInfo,
  DiffAnalysis,
} from "./patterns.js";
import {
  categorizeFile,
  BREAKING_PATTERNS,
  FRONTEND_PATTERNS,
  BACKEND_PATTERNS,
} from "./patterns.js";

// ---------------------------------------------------------------------------
// Categorization
// ---------------------------------------------------------------------------

/**
 * Group a flat list of FileChange objects by their change category.
 */
export function groupByCategory(
  files: readonly FileChange[],
): Map<ChangeCategory, FileChange[]> {
  const groups = new Map<ChangeCategory, FileChange[]>();

  for (const file of files) {
    const category = file.category;
    const existing = groups.get(category);
    if (existing) {
      existing.push(file);
    } else {
      groups.set(category, [file]);
    }
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

/**
 * Sum additions and deletions across all files.
 */
export function computeTotals(files: readonly FileChange[]): {
  totalAdditions: number;
  totalDeletions: number;
} {
  let totalAdditions = 0;
  let totalDeletions = 0;
  for (const f of files) {
    totalAdditions += f.additions;
    totalDeletions += f.deletions;
  }
  return { totalAdditions, totalDeletions };
}

// ---------------------------------------------------------------------------
// Breaking-change detection
// ---------------------------------------------------------------------------

/**
 * Scan commit messages for breaking-change indicators.
 * Returns the list of commit messages that indicate breaking changes.
 */
export function detectBreakingChanges(
  commits: readonly CommitInfo[],
): string[] {
  const breaking: string[] = [];

  for (const commit of commits) {
    for (const pattern of BREAKING_PATTERNS) {
      if (pattern.test(commit.message)) {
        breaking.push(commit.message);
        break;
      }
    }
  }

  return breaking;
}

// ---------------------------------------------------------------------------
// Mixed-concerns detection
// ---------------------------------------------------------------------------

/**
 * Detect whether the diff includes both frontend and backend changes.
 */
export function hasMixedConcerns(
  files: readonly FileChange[],
): boolean {
  let hasFrontend = false;
  let hasBackend = false;

  for (const file of files) {
    const p = file.path;
    for (const pattern of FRONTEND_PATTERNS) {
      if (pattern.test(p)) {
        hasFrontend = true;
        break;
      }
    }
    for (const pattern of BACKEND_PATTERNS) {
      if (pattern.test(p)) {
        hasBackend = true;
        break;
      }
    }
    if (hasFrontend && hasBackend) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Missing-test detection
// ---------------------------------------------------------------------------

/**
 * Check whether the changes include any test files.
 */
export function hasTestChanges(files: readonly FileChange[]): boolean {
  return files.some((f) => {
    const cat = categorizeFile(f.path);
    return cat === "Tests";
  });
}

/**
 * Check whether the changes include any non-test, non-doc, non-config code.
 */
export function hasCodeChanges(files: readonly FileChange[]): boolean {
  return files.some((f) => {
    const cat = categorizeFile(f.path);
    return cat !== "Tests" && cat !== "Documentation" && cat !== "Configuration" && cat !== "Dependencies";
  });
}

// ---------------------------------------------------------------------------
// Large-file detection
// ---------------------------------------------------------------------------

/** Files with more than `threshold` lines changed */
export function findLargeFiles(
  files: readonly FileChange[],
  threshold: number,
): readonly FileChange[] {
  return files.filter(
    (f) => f.additions + f.deletions > threshold,
  );
}

// ---------------------------------------------------------------------------
// Full analysis
// ---------------------------------------------------------------------------

/**
 * Run the complete analysis pipeline on files and commits.
 */
export function analyzeDiff(
  files: readonly FileChange[],
  commits: readonly CommitInfo[],
): DiffAnalysis {
  const { totalAdditions, totalDeletions } = computeTotals(files);
  const categories = groupByCategory(files);
  const breakingChangeMessages = detectBreakingChanges(commits);

  return {
    files,
    commits,
    totalAdditions,
    totalDeletions,
    categories,
    hasBreakingChanges: breakingChangeMessages.length > 0,
    breakingChangeMessages,
  };
}
