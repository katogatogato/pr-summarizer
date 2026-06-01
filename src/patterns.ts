/**
 * Pattern constants for categorizing files, detecting quality issues,
 * and identifying review-worthy changes in diffs.
 */

/** Categories used to group changed files by area */
export type ChangeCategory =
  | "API Changes"
  | "UI Changes"
  | "Bug Fixes"
  | "Refactoring"
  | "Tests"
  | "Documentation"
  | "Configuration"
  | "Database Changes"
  | "Security Changes"
  | "Dependencies"
  | "Other";

/** File-change status as reported by git */
export type FileStatus = "added" | "modified" | "deleted" | "renamed";

/** Result of analyzing a single file's diff */
export interface FileChange {
  readonly path: string;
  readonly status: FileStatus;
  readonly additions: number;
  readonly deletions: number;
  readonly category: ChangeCategory;
  readonly diffContent: string;
}

/** A single commit parsed from git log */
export interface CommitInfo {
  readonly hash: string;
  readonly message: string;
  readonly author: string;
  readonly date: string;
}

/** Complete result of diff analysis */
export interface DiffAnalysis {
  readonly files: readonly FileChange[];
  readonly commits: readonly CommitInfo[];
  readonly totalAdditions: number;
  readonly totalDeletions: number;
  readonly categories: ReadonlyMap<ChangeCategory, readonly FileChange[]>;
  readonly hasBreakingChanges: boolean;
  readonly breakingChangeMessages: readonly string[];
}

/** A review checklist item */
export interface ChecklistItem {
  readonly label: string;
  readonly status: "pass" | "warning" | "fail";
  readonly detail: string;
}

/** Quality check result */
export interface QualityResult {
  readonly label: string;
  readonly status: "pass" | "warning" | "fail";
  readonly detail: string;
  readonly filePath?: string;
  readonly line?: number;
}

/** A generated PR summary */
export interface PRSummary {
  readonly summaryParagraph: string;
  readonly categories: ReadonlyMap<ChangeCategory, readonly FileChange[]>;
  readonly files: readonly FileChange[];
  readonly checklist: readonly ChecklistItem[];
  readonly breakingChanges: readonly string[];
  readonly totalAdditions: number;
  readonly totalDeletions: number;
}

// ---------------------------------------------------------------------------
// Path-pattern → category mapping
// ---------------------------------------------------------------------------

interface CategoryPattern {
  readonly category: ChangeCategory;
  readonly patterns: readonly RegExp[];
}

const CATEGORY_PATTERNS: readonly CategoryPattern[] = [
  {
    category: "API Changes",
    patterns: [
      /\/api\//i,
      /\/routes\//i,
      /\/controllers?\//i,
      /\/endpoints?\//i,
      /\/resolvers?\//i,
      /\.router\./i,
      /\.controller\./i,
    ],
  },
  {
    category: "UI Changes",
    patterns: [
      /\/components?\//i,
      /\/ui\//i,
      /\/pages?\//i,
      /\/views?\//i,
      /\/layouts?\//i,
      /\.tsx$/i,
      /\.vue$/i,
      /\.svelte$/i,
      /\.css$/i,
      /\.scss$/i,
      /\.less$/i,
      /\.styled\./i,
    ],
  },
  {
    category: "Tests",
    patterns: [
      /\.test\./i,
      /\.spec\./i,
      /\/__tests__\//i,
      /\/tests?\//i,
      /\.e2e\./i,
      /\.integration\./i,
    ],
  },
  {
    category: "Documentation",
    patterns: [/\.md$/i, /\/docs?\//i, /\.rst$/i, /\.adoc$/i, /\.txt$/i],
  },
  {
    category: "Configuration",
    patterns: [
      /package\.json$/i,
      /tsconfig\.json$/i,
      /\.config\./i,
      /\.rc\./i,
      /\.env/i,
      /Dockerfile/i,
      /docker-compose/i,
      /\.yml$/i,
      /\.yaml$/i,
      /Makefile/i,
      /\.toml$/i,
    ],
  },
  {
    category: "Database Changes",
    patterns: [
      /\/db\//i,
      /\/migrations?\//i,
      /\.sql$/i,
      /\/models?\//i,
      /\/schemas?\//i,
      /\/prisma\//i,
      /\/drizzle\//i,
      /\/knex\//i,
    ],
  },
  {
    category: "Security Changes",
    patterns: [
      /\/auth\//i,
      /\/middleware\/auth/i,
      /\/security\//i,
      /\/permissions?\//i,
      /\/rbac\//i,
      /\.pem$/i,
      /\.key$/i,
      /\.crt$/i,
    ],
  },
  {
    category: "Dependencies",
    patterns: [/package\.json$/i, /package-lock\.json$/i, /yarn\.lock$/i, /pnpm-lock\.yaml$/i],
  },
];

/**
 * Categorize a file path into a change category.
 * Returns "Other" if no pattern matches.
 */
export function categorizeFile(filePath: string): ChangeCategory {
  for (const { category, patterns } of CATEGORY_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(filePath)) {
        return category;
      }
    }
  }
  return "Other";
}

// ---------------------------------------------------------------------------
// Secret / credential patterns (lightweight detector)
// ---------------------------------------------------------------------------

/** Patterns that look like secrets or credentials in source code */
export const SECRET_PATTERNS: readonly RegExp[] = [
  /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}/i,
  /(?:api[_-]?key|apikey)\s*[:=]\s*['"][^'"]{8,}/i,
  /(?:secret|token|auth[_-]?token)\s*[:=]\s*['"][^'"]{8,}/i,
  /(?:private[_-]?key)\s*[:=]\s*['"][^'"]{8,}/i,
  /AKIA[0-9A-Z]{16}/,
  /ghp_[0-9a-zA-Z]{36}/,
  /gho_[0-9a-zA-Z]{36}/,
  /sk-[a-zA-Z0-9]{20,}/,
  /eyJ[A-Za-z0-9-_]{20,}\.eyJ[A-Za-z0-9-_]{20,}/,
  /\bBEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY\b/,
];

// ---------------------------------------------------------------------------
// Debug leftover patterns
// ---------------------------------------------------------------------------

/** Patterns that indicate debug leftovers in code */
export const DEBUG_PATTERNS: readonly RegExp[] = [
  /\bconsole\.log\s*\(/,
  /\bconsole\.debug\s*\(/,
  /\bconsole\.info\s*\(/,
  /\bprint\s*\(/,
  /\bdebugger\b/,
  /\bprintln\s*\(/,
];

// ---------------------------------------------------------------------------
// TODO / FIXME / HACK patterns
// ---------------------------------------------------------------------------

/** Patterns for technical debt markers */
export const DEBT_PATTERNS: readonly RegExp[] = [
  /\bTODO\b/i,
  /\bFIXME\b/i,
  /\bHACK\b/i,
  /\bXXX\b/i,
  /\bTEMP\b/i,
  /\bWORKAROUND\b/i,
];

// ---------------------------------------------------------------------------
// Commit message quality
// ---------------------------------------------------------------------------

/** Commit messages that are too short or non-descriptive */
export const WEAK_COMMIT_MESSAGES: readonly RegExp[] = [
  /^(fix|wip|update|changes?|misc|stuff|tmp|temp|test|lint|fmt|format|cleanup|clean up)\s*$/i,
  /^\w{1,3}$/,
  /^\./,
  /^merged?\s/i,
];

// ---------------------------------------------------------------------------
// Breaking-change indicators
// ---------------------------------------------------------------------------

/** Patterns that suggest breaking changes in commits */
export const BREAKING_PATTERNS: readonly RegExp[] = [
  /\bBREAKING\b/i,
  /\bBREAKING\s+CHANGE\b/i,
  /!:/,
  /\bbi[kt]ing\b/i,
];

// ---------------------------------------------------------------------------
// Frontend / backend heuristics (for mixed-concerns detection)
// ---------------------------------------------------------------------------

/** File patterns that suggest frontend code */
export const FRONTEND_PATTERNS: readonly RegExp[] = [
  /\.tsx?$/i,
  /\.vue$/i,
  /\.svelte$/i,
  /\.css$/i,
  /\.scss$/i,
  /\.less$/i,
  /\.html$/i,
  /\/components?\//i,
  /\/pages?\//i,
  /\/ui\//i,
];

/** File patterns that suggest backend code */
export const BACKEND_PATTERNS: readonly RegExp[] = [
  /\/api\//i,
  /\/routes?\//i,
  /\/controllers?\//i,
  /\/services?\//i,
  /\/models?\//i,
  /\/middleware\//i,
  /\.sql$/i,
  /\/migrations?\//i,
];

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/** Lines changed in a single file that triggers a "large file" warning */
export const LARGE_FILE_THRESHOLD = 300;

/** Lines changed in a single file that triggers a "consider splitting" review item */
export const VERY_LARGE_FILE_THRESHOLD = 500;

/** Minimum commit message length to be considered descriptive */
export const MIN_COMMIT_MESSAGE_LENGTH = 10;
