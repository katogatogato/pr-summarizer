/**
 * PR quality checker — scans diffs for common issues like debug leftovers,
 * TODO comments, secret patterns, large files, mixed concerns, weak commit
 * messages, and missing tests.
 */

import type { FileChange, CommitInfo, QualityResult } from "./patterns.js";
import {
  SECRET_PATTERNS,
  DEBUG_PATTERNS,
  DEBT_PATTERNS,
  WEAK_COMMIT_MESSAGES,
  LARGE_FILE_THRESHOLD,
  FRONTEND_PATTERNS,
  BACKEND_PATTERNS,
} from "./patterns.js";
import {
  hasTestChanges,
  hasCodeChanges,
  findLargeFiles,
} from "./analyzer.js";

// ---------------------------------------------------------------------------
// Individual check functions
// ---------------------------------------------------------------------------

/** Scan diff content for TODO / FIXME / HACK markers in added lines */
function checkDebtMarkers(files: readonly FileChange[]): QualityResult[] {
  const results: QualityResult[] = [];

  for (const file of files) {
    for (const line of file.diffContent.split("\n")) {
      // Only check added lines
      if (!line.startsWith("+")) continue;
      // Skip diff metadata lines
      if (line.startsWith("+++") || line.startsWith("+ ")) continue;

      const content = line.substring(1);
      for (const pattern of DEBT_PATTERNS) {
        if (pattern.test(content)) {
          results.push({
            label: "Technical debt marker found",
            status: "warning",
            detail: `Found "${content.trim()}" in ${file.path}`,
            filePath: file.path,
          });
          break; // One match per line is enough
        }
      }
    }
  }

  return results;
}

/** Scan diff content for console.log / print / debugger statements */
function checkDebugLeftovers(files: readonly FileChange[]): QualityResult[] {
  const results: QualityResult[] = [];

  for (const file of files) {
    for (const line of file.diffContent.split("\n")) {
      if (!line.startsWith("+")) continue;
      if (line.startsWith("+++") || line.startsWith("+ ")) continue;

      const content = line.substring(1);
      for (const pattern of DEBUG_PATTERNS) {
        if (pattern.test(content)) {
          results.push({
            label: "Debug leftover found",
            status: "fail",
            detail: `Found debug statement in ${file.path}: ${content.trim()}`,
            filePath: file.path,
          });
          break;
        }
      }
    }
  }

  return results;
}

/** Check for large files (too many lines changed in a single file) */
function checkLargeFiles(files: readonly FileChange[]): QualityResult[] {
  const results: QualityResult[] = [];
  const large = findLargeFiles(files, LARGE_FILE_THRESHOLD);

  for (const f of large) {
    results.push({
      label: "Large file change",
      status: "warning",
      detail:
        `${f.path} has ${f.additions + f.deletions} changed lines (threshold: ${LARGE_FILE_THRESHOLD}). ` +
        `Consider splitting into smaller PRs.`,
      filePath: f.path,
    });
  }

  return results;
}

/** Check for mixed frontend + backend concerns */
function checkMixedConcerns(files: readonly FileChange[]): QualityResult[] {
  let hasFrontend = false;
  let hasBackend = false;

  for (const file of files) {
    for (const p of FRONTEND_PATTERNS) {
      if (p.test(file.path)) {
        hasFrontend = true;
        break;
      }
    }
    for (const p of BACKEND_PATTERNS) {
      if (p.test(file.path)) {
        hasBackend = true;
        break;
      }
    }
    if (hasFrontend && hasBackend) break;
  }

  if (hasFrontend && hasBackend) {
    return [
      {
        label: "Mixed frontend/backend changes",
        status: "warning",
        detail:
          "This PR includes both frontend and backend file changes. " +
          "Consider splitting into separate PRs for focused review.",
      },
    ];
  }

  return [];
}

/** Check for missing test changes when code was changed */
function checkMissingTests(files: readonly FileChange[]): QualityResult[] {
  const codeChanged = hasCodeChanges(files);
  const testsChanged = hasTestChanges(files);

  if (codeChanged && !testsChanged) {
    return [
      {
        label: "No test changes",
        status: "warning",
        detail:
          "Code files were modified but no test files were changed. " +
          "Consider adding tests for the new/changed functionality.",
      },
    ];
  }

  return [];
}

/** Scan for secret / credential patterns in added lines */
function checkSecrets(files: readonly FileChange[]): QualityResult[] {
  const results: QualityResult[] = [];

  for (const file of files) {
    for (const line of file.diffContent.split("\n")) {
      if (!line.startsWith("+")) continue;
      if (line.startsWith("+++") || line.startsWith("+ ")) continue;

      const content = line.substring(1);
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.test(content)) {
          results.push({
            label: "Potential secret/credential detected",
            status: "fail",
            detail:
              `Possible secret found in ${file.path}. ` +
              `Do not commit credentials — use environment variables or secret managers.`,
            filePath: file.path,
          });
          break;
        }
      }
    }
  }

  return results;
}

/** Check commit message quality */
function checkCommitMessages(
  commits: readonly CommitInfo[],
): QualityResult[] {
  const results: QualityResult[] = [];

  for (const commit of commits) {
    const msg = commit.message.split("\n")[0] ?? "";
    for (const pattern of WEAK_COMMIT_MESSAGES) {
      if (pattern.test(msg.trim())) {
        results.push({
          label: "Weak commit message",
          status: "warning",
          detail:
            `Commit ${commit.hash.substring(0, 7)} has a non-descriptive message: "${msg.trim()}". ` +
            `Consider amending with a more descriptive summary.`,
        });
        break;
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Full quality check
// ---------------------------------------------------------------------------

/**
 * Run all quality checks and return aggregated results.
 * Exit code semantics: 0 if all pass, 1 if any failures.
 */
export function runQualityChecks(
  files: readonly FileChange[],
  commits: readonly CommitInfo[],
): {
  results: readonly QualityResult[];
  hasFailures: boolean;
  passCount: number;
  warningCount: number;
  failCount: number;
} {
  const allResults: QualityResult[] = [
    ...checkDebtMarkers(files),
    ...checkDebugLeftovers(files),
    ...checkLargeFiles(files),
    ...checkMixedConcerns(files),
    ...checkMissingTests(files),
    ...checkSecrets(files),
    ...checkCommitMessages(commits),
  ];

  // If nothing was flagged, emit a single passing result
  if (allResults.length === 0) {
    allResults.push({
      label: "All checks passed",
      status: "pass",
      detail: "No quality issues were detected in this diff.",
    });
  }

  const passCount = allResults.filter((r) => r.status === "pass").length;
  const warningCount = allResults.filter((r) => r.status === "warning").length;
  const failCount = allResults.filter((r) => r.status === "fail").length;

  return {
    results: allResults,
    hasFailures: failCount > 0,
    passCount,
    warningCount,
    failCount,
  };
}
