/**
 * phase2s conduct-audit — quality gate for the conductor spec generation pipeline.
 *
 * Mirrors phase2s search-audit: runs a fixed set of natural-language goals through
 * conductorGenSpec() and validates the generated spec structure.
 *
 * Validation per case:
 *   1. conductorGenSpec() must not throw and must return a non-empty specPath
 *   2. spec.decomposition.length must be within [minSubtasks, maxSubtasks]
 *   3. lintSpec() must return ok:true
 *   4. All requiredRoles must appear in at least one subtask's .role field
 *   5. expectedKeywords must appear (case-insensitive) in at least one subtask name (WARN only)
 *
 * Special case "empty-goal": conductorGenSpec("") must return the graceful-failure
 * sentinel { specPath: "", specContent: "" } without throwing.
 *
 * Usage:
 *   phase2s conduct-audit                 run all 10 cases
 *   phase2s conduct-audit --ci            exit 1 on any failure
 *   phase2s conduct-audit --fast          use config.fast_model (cheaper for CI)
 *   phase2s conduct-audit --case add-endpoint   run a single case
 *   phase2s conduct-audit --json          emit JSON result to stdout
 */

import chalk from "chalk";
import { loadConfig } from "../core/config.js";
import { parseSpec } from "../core/spec-parser.js";
import { lintSpec } from "./lint.js";
import { conductorGenSpec, CONDUCTOR_MIN_SUBTASKS, CONDUCTOR_MAX_SUBTASKS } from "./conductor-prompt.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditCase {
  id: string;                // short slug, e.g. "add-endpoint"
  goal: string;              // the input goal string
  minSubtasks: number;       // minimum acceptable subtask count
  maxSubtasks: number;       // maximum acceptable subtask count — baseline cases use 8 (LLM variance headroom); ciGate cases use CONDUCTOR_MAX_SUBTASKS (strict prompt-quality enforcement)
  requiredRoles: string[];   // roles that must appear in at least one subtask
  expectedKeywords: string[]; // words that should appear in a subtask name (WARN, not fail)
  /** When true, the goal is expected to fail gracefully (empty sentinel), not produce a spec. */
  expectFailure?: boolean;
  /**
   * When true, this case validates a prompt-quality constraint enforced by CONDUCTOR_PROMPT
   * (e.g. subtask count within CONDUCTOR_MAX_SUBTASKS, no duplicate roles).
   * --ci-only runs only these cases (local pre-push gate, no GitHub Actions LLM key needed).
   */
  ciGate?: boolean;
  /**
   * When true, validates that no role appears more than once in the generated spec.
   * Enforces the "each role must be UNIQUE" rule added to CONDUCTOR_PROMPT in Sprint 89.
   */
  noDuplicateRoles?: boolean;
}

export interface AuditOptions {
  /** Use config.fast_model instead of smart_model (cheaper for CI). */
  fast?: boolean;
  /** Run a single case by ID (for debugging). */
  caseId?: string;
  /** Exit 1 if any case fails. */
  ci?: boolean;
  /** Output results as JSON to stdout instead of a table. */
  json?: boolean;
  /**
   * Run only ciGate:true cases (local pre-push gate).
   * Filters to the 5 prompt-quality validation cases that enforce CONDUCTOR_PROMPT constraints.
   */
  ciOnly?: boolean;
  /**
   * Per-case timeout in seconds. Cases that exceed this limit are marked as failed
   * with a "timed out after Ns" error rather than waiting indefinitely.
   */
  timeout?: number;
}

export interface CaseResult {
  id: string;
  goal: string;
  passed: boolean;
  durationMs: number;
  subtaskCount?: number;
  roles?: string[];
  /** Non-fatal warnings (keyword hints, etc.) */
  warnings: string[];
  /** Failure reason when passed is false. */
  error?: string;
  /** Path of generated spec (for inspection). */
  specPath?: string;
}

export interface AuditResult {
  cases: CaseResult[];
  passed: number;
  total: number;
  avgDurationMs: number;
}

// ---------------------------------------------------------------------------
// Built-in audit cases (10)
// ---------------------------------------------------------------------------

export const AUDIT_CASES: AuditCase[] = [
  {
    id: "add-endpoint",
    goal: "add a GET /health endpoint that returns uptime",
    minSubtasks: 2,
    maxSubtasks: 8,
    requiredRoles: ["architect"],
    expectedKeywords: ["health", "endpoint"],
  },
  {
    id: "auth-system",
    goal: "add JWT authentication with refresh tokens",
    minSubtasks: 3,
    maxSubtasks: 8,
    requiredRoles: ["architect", "reviewer"],
    expectedKeywords: ["jwt", "auth"],
  },
  {
    id: "fix-null-check",
    goal: "add null check to the user lookup in auth.ts",
    minSubtasks: 2,
    maxSubtasks: 8,
    requiredRoles: ["architect"],
    expectedKeywords: ["null", "auth"],
  },
  {
    id: "add-tests",
    goal: "write missing unit tests for the config loader",
    minSubtasks: 2,
    maxSubtasks: 8,
    requiredRoles: ["architect"],
    expectedKeywords: ["test", "config"],
  },
  {
    id: "refactor-module",
    goal: "refactor the database connection pool to use a singleton pattern",
    minSubtasks: 2,
    maxSubtasks: 8,
    requiredRoles: ["architect", "reviewer"],
    expectedKeywords: ["singleton", "database"],
  },
  {
    id: "cli-flag",
    goal: "add a --verbose flag to the main CLI command",
    minSubtasks: 2,
    maxSubtasks: 8,
    requiredRoles: ["architect"],
    expectedKeywords: ["verbose", "flag"],
  },
  {
    id: "cache-layer",
    goal: "add Redis caching for the user session store",
    minSubtasks: 3,
    maxSubtasks: 8,
    requiredRoles: ["architect", "reviewer"],
    expectedKeywords: ["redis", "cache"],
  },
  {
    id: "rate-limit",
    goal: "add rate limiting to all public API endpoints",
    minSubtasks: 3,
    maxSubtasks: 8,
    requiredRoles: ["architect", "reviewer"],
    expectedKeywords: ["rate", "limit"],
  },
  {
    id: "migration",
    goal: "add a database migration to add created_at to users table",
    minSubtasks: 2,
    maxSubtasks: 8,
    requiredRoles: ["architect"],
    expectedKeywords: ["migration", "created_at"],
  },
  {
    id: "empty-goal",
    goal: "",
    minSubtasks: 0,
    maxSubtasks: 0,
    requiredRoles: [],
    expectedKeywords: [],
    expectFailure: true, // expects graceful sentinel, not a valid spec
  },

  // ---------------------------------------------------------------------------
  // CI-gate cases — validate CONDUCTOR_PROMPT quality constraints (Sprint 89)
  // Run locally via `.githooks/pre-push` with `phase2s conduct-audit --ci-only`.
  // TODO: CI gate (deferred) — add GH Actions step once a model API key is available
  // ---------------------------------------------------------------------------
  {
    id: "subtask-count-within-bounds",
    goal: "add a configuration file parser that reads TOML settings from disk",
    minSubtasks: CONDUCTOR_MIN_SUBTASKS,
    maxSubtasks: CONDUCTOR_MAX_SUBTASKS,
    requiredRoles: ["architect"],
    expectedKeywords: ["config", "toml"],
    ciGate: true,
  },
  {
    id: "architect-role-present",
    goal: "implement a publish-subscribe event bus for inter-module communication",
    minSubtasks: CONDUCTOR_MIN_SUBTASKS,
    maxSubtasks: CONDUCTOR_MAX_SUBTASKS,
    requiredRoles: ["architect"],
    expectedKeywords: ["event", "publish"],
    ciGate: true,
  },
  {
    id: "tester-role-present",
    goal: "write comprehensive unit and integration tests for the user authentication service",
    minSubtasks: CONDUCTOR_MIN_SUBTASKS,
    maxSubtasks: CONDUCTOR_MAX_SUBTASKS,
    requiredRoles: ["architect", "tester"],
    expectedKeywords: ["test", "auth"],
    ciGate: true,
  },
  {
    id: "reviewer-role-present",
    goal: "add end-to-end encryption for user messages with automatic key rotation",
    minSubtasks: CONDUCTOR_MIN_SUBTASKS,
    maxSubtasks: CONDUCTOR_MAX_SUBTASKS,
    requiredRoles: ["architect", "reviewer"],
    expectedKeywords: ["encrypt", "key"],
    ciGate: true,
  },
  {
    id: "no-duplicate-roles-in-small-spec",
    goal: "add input validation to the user registration form fields",
    minSubtasks: CONDUCTOR_MIN_SUBTASKS,
    maxSubtasks: CONDUCTOR_MAX_SUBTASKS,
    requiredRoles: ["architect"],
    expectedKeywords: ["validation", "form"],
    ciGate: true,
    noDuplicateRoles: true,
  },
];

// ---------------------------------------------------------------------------
// runConductAudit
// ---------------------------------------------------------------------------

export async function runConductAudit(options: AuditOptions = {}): Promise<AuditResult> {
  const config = await loadConfig();

  // Resolve model override: fast flag switches to fast_model for CI cost savings
  const modelOverride = options.fast ? "fast" : undefined;

  // Filter to single case if --case was passed, or to ciGate cases if --ci-only
  let cases: AuditCase[];
  if (options.caseId) {
    cases = AUDIT_CASES.filter(c => c.id === options.caseId);
    if (cases.length === 0) {
      throw new Error(
        `Unknown case id: "${options.caseId}". Available: ${AUDIT_CASES.map(c => c.id).join(", ")}`,
      );
    }
  } else if (options.ciOnly) {
    cases = AUDIT_CASES.filter(c => c.ciGate === true);
    if (cases.length === 0) {
      throw new Error(
        "No ciGate cases defined — add at least one case with ciGate: true to AUDIT_CASES before using --ci-only",
      );
    }
  } else {
    cases = AUDIT_CASES;
  }

  const results: CaseResult[] = [];

  for (const auditCase of cases) {
    const start = Date.now();

    if (!options.json) {
      process.stdout.write(`  running ${chalk.dim(auditCase.id)}...`);
    }

    let caseResult: CaseResult;
    if (options.timeout !== undefined) {
      const timeoutMs = options.timeout * 1000;
      const timeoutResult: CaseResult = {
        id: auditCase.id,
        goal: auditCase.goal,
        passed: false,
        durationMs: timeoutMs,
        warnings: [],
        error: `timed out after ${options.timeout}s`,
      };
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      caseResult = await Promise.race([
        runOneCase(auditCase, config, modelOverride).finally(() => clearTimeout(timeoutHandle)),
        new Promise<CaseResult>(resolve => {
          timeoutHandle = setTimeout(() => resolve(timeoutResult), timeoutMs);
        }),
      ]);
    } else {
      caseResult = await runOneCase(auditCase, config, modelOverride);
    }
    caseResult.durationMs = Date.now() - start;

    results.push(caseResult);

    if (!options.json) {
      const icon = caseResult.passed ? chalk.green("✓") : chalk.red("✗");
      const dur = `(${(caseResult.durationMs / 1000).toFixed(1)}s)`;
      const detail = caseResult.passed
        ? `${caseResult.subtaskCount} subtasks, roles: ${(caseResult.roles ?? []).join(" ")}`
        : `FAIL: ${caseResult.error}`;
      // Clear the "running..." line and print result
      process.stdout.write(`\r  ${icon} ${auditCase.id.padEnd(20)} ${dur.padEnd(8)}  ${detail}\n`);

      // Print warnings
      for (const w of caseResult.warnings) {
        console.log(chalk.yellow(`    ⚠ ${w}`));
      }
    }
  }

  const passedCount = results.filter(r => r.passed).length;
  const avgMs = results.length > 0
    ? results.reduce((s, r) => s + r.durationMs, 0) / results.length
    : 0;

  return {
    cases: results,
    passed: passedCount,
    total: results.length,
    avgDurationMs: avgMs,
  };
}

// ---------------------------------------------------------------------------
// runOneCase
// ---------------------------------------------------------------------------

async function runOneCase(
  auditCase: AuditCase,
  config: Awaited<ReturnType<typeof loadConfig>>,
  modelOverride: string | undefined,
): Promise<CaseResult> {
  const warnings: string[] = [];

  // --- Special case: empty-goal expects graceful failure sentinel ---
  if (auditCase.expectFailure) {
    try {
      const out = await conductorGenSpec(auditCase.goal, config, {
        model: modelOverride,
        _skipModelWarn: true,
      });
      // Graceful failure returns empty sentinel { specPath: "", specContent: "" }
      if (out.specPath === "" && out.specContent === "") {
        return { id: auditCase.id, goal: auditCase.goal, passed: true, durationMs: 0, warnings };
      }
      return {
        id: auditCase.id, goal: auditCase.goal, passed: false, durationMs: 0, warnings,
        error: `Expected graceful failure sentinel but got specPath: "${out.specPath}"`,
      };
    } catch (err) {
      return {
        id: auditCase.id, goal: auditCase.goal, passed: false, durationMs: 0, warnings,
        error: `Expected graceful failure but conductorGenSpec threw: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // --- Normal case ---
  let specPath: string;
  let specContent: string;

  try {
    const out = await conductorGenSpec(auditCase.goal, config, {
      model: modelOverride,
      _skipModelWarn: true,
    });
    if (!out.specPath) {
      return {
        id: auditCase.id, goal: auditCase.goal, passed: false, durationMs: 0, warnings,
        error: "conductorGenSpec returned empty specPath (spec generation failed)",
      };
    }
    specPath = out.specPath;
    specContent = out.specContent;
  } catch (err) {
    return {
      id: auditCase.id, goal: auditCase.goal, passed: false, durationMs: 0, warnings,
      error: `conductorGenSpec threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Parse the spec
  const spec = parseSpec(specContent);

  // Validate subtask count bounds
  const count = spec.decomposition.length;
  if (count < auditCase.minSubtasks || count > auditCase.maxSubtasks) {
    return {
      id: auditCase.id, goal: auditCase.goal, passed: false, durationMs: 0, warnings,
      subtaskCount: count,
      specPath,
      error: count < auditCase.minSubtasks
        ? `subtask count ${count} < min ${auditCase.minSubtasks}`
        : `subtask count ${count} > max ${auditCase.maxSubtasks}`,
    };
  }

  // Lint check
  const lintResult = lintSpec(spec);
  if (!lintResult.ok) {
    const errors = lintResult.issues
      .filter(i => i.severity === "error")
      .map(i => i.message)
      .join("; ");
    return {
      id: auditCase.id, goal: auditCase.goal, passed: false, durationMs: 0, warnings,
      subtaskCount: count,
      specPath,
      error: `lintSpec failed: ${errors}`,
    };
  }

  // Role check
  const presentRoles = new Set(
    spec.decomposition.map(st => st.role).filter(Boolean) as string[],
  );
  for (const required of auditCase.requiredRoles) {
    if (!presentRoles.has(required)) {
      return {
        id: auditCase.id, goal: auditCase.goal, passed: false, durationMs: 0, warnings,
        subtaskCount: count,
        roles: [...presentRoles],
        specPath,
        error: `required role "${required}" not found in spec (found: ${[...presentRoles].join(", ") || "none"})`,
      };
    }
  }

  // Duplicate-role check (optional — validates CONDUCTOR_PROMPT uniqueness rule)
  if (auditCase.noDuplicateRoles) {
    const roleCounts: Record<string, number> = {};
    for (const st of spec.decomposition) {
      if (st.role) roleCounts[st.role] = (roleCounts[st.role] ?? 0) + 1;
    }
    const dupes = Object.entries(roleCounts).filter(([, n]) => n > 1).map(([r]) => r);
    if (dupes.length > 0) {
      return {
        id: auditCase.id, goal: auditCase.goal, passed: false, durationMs: 0, warnings,
        subtaskCount: count, roles: [...presentRoles], specPath,
        error: `duplicate roles found: ${dupes.join(", ")} — each role must be unique in a small spec`,
      };
    }
  }

  // Keyword check (WARN only — not a failure)
  const allNames = spec.decomposition.map(st => st.name.toLowerCase()).join(" ");
  for (const kw of auditCase.expectedKeywords) {
    if (!allNames.includes(kw.toLowerCase())) {
      warnings.push(`expected keyword "${kw}" not found in any subtask name`);
    }
  }

  return {
    id: auditCase.id,
    goal: auditCase.goal,
    passed: true,
    durationMs: 0,
    subtaskCount: count,
    roles: [...presentRoles],
    specPath,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// formatAuditResult — console output
// ---------------------------------------------------------------------------

export function formatAuditResult(result: AuditResult, options: { json?: boolean } = {}): void {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const avgSec = (result.avgDurationMs / 1000).toFixed(1);
  const passIcon = result.passed === result.total ? chalk.green("✓") : chalk.red("✗");
  console.log();
  console.log(`${passIcon} Results: ${result.passed}/${result.total} passed  (avg ${avgSec}s/case)`);

  const failures = result.cases.filter(c => !c.passed);
  if (failures.length > 0) {
    console.log();
    console.log("Failures:");
    for (const f of failures) {
      console.log(chalk.red(`  ${f.id}: ${f.error}`));
      console.log(chalk.dim(`    Goal: "${f.goal}"`));
      if (f.specPath) {
        console.log(chalk.dim(`    Spec: ${f.specPath} (inspect with \`cat\`)`));
      }
    }
  }
  console.log();
}
