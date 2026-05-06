/**
 * phase2s search-audit — benchmark semantic search quality.
 *
 * Runs a curated set of natural-language queries against the live code index
 * and reports hit@1, hit@3, and MRR (Mean Reciprocal Rank).
 *
 * The default query set is self-referential: Phase2S searching its own
 * codebase. Zero user setup required after `phase2s sync`.
 *
 * Pipeline:
 *   1. Load config + validate Ollama configured
 *   2. Load index via readCodeIndex (ENOENT → friendly exit)
 *   3. Model mismatch check (interactive: warn; --ci: exit 1)
 *   4. Per-query: embed → findTopKCode → hit check
 *   5. Compute hit@1, hit@3, MRR (skip known-weak from denominator)
 *   6. CI gate: exit 1 if below thresholds
 *   7. Format output: table to stdout (or JSON if --json)
 */

import chalk from "chalk";
import { readFile } from "node:fs/promises";
import { generateEmbedding } from "../core/embeddings.js";
import { readCodeIndex, findTopKCode } from "../core/code-index.js";
import { BUILT_IN_CASES, type AuditCase } from "../data/search-audit-cases.js";
import type { Config } from "../core/config.js";

// ---------------------------------------------------------------------------
// CI thresholds
// ---------------------------------------------------------------------------

export const CI_HIT1_THRESHOLD = 0.70;
export const CI_HIT3_THRESHOLD = 0.85;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AuditOptions {
  /** Path to a user-provided JSON or JSONL cases file */
  casesFile?: string;
  /** Skip built-in cases, only run the --cases file */
  casesOnly?: boolean;
  /** Skip user cases, only run built-in cases */
  builtInOnly?: boolean;
  /** Top-K to retrieve per query (default: 10) */
  k?: number;
  /** Exit 1 if hit@1 < CI_HIT1_THRESHOLD or hit@3 < CI_HIT3_THRESHOLD */
  ci?: boolean;
  /** Output results as JSON to stdout instead of a table */
  json?: boolean;
  /** Show per-query top-3 results in addition to pass/fail */
  verbose?: boolean;
}

export interface CaseResult {
  query: string;
  expectedPath: string;
  expectedChunk?: string;
  expectedHit: boolean;
  note?: string;
  /** 1-based rank of the matching result, or null if not found */
  rank: number | null;
  /** Path of the matched result at the matching rank (if found) */
  matchedPath?: string;
  /** chunkName of the matched result at the matching rank (if found) */
  matchedChunk?: string;
  /** True if embed failed for this case — excluded from denominator */
  skipped: boolean;
  hit1: boolean;
  hit3: boolean;
}

export interface AuditSummary {
  hit1: number;
  hit3: number;
  mrr: number;
  totalCases: number;
  expectedHitCases: number;
  skippedCases: number;
  knownWeakCases: number;
  indexChunks: number;
}

export interface AuditResult {
  summary: AuditSummary;
  cases: CaseResult[];
}

// ---------------------------------------------------------------------------
// Path normalization
// ---------------------------------------------------------------------------

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

// ---------------------------------------------------------------------------
// Case file loading
// ---------------------------------------------------------------------------

async function loadCasesFile(filePath: string): Promise<AuditCase[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err) {
    throw new Error(
      `Cannot read cases file "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Try JSON array first, then JSONL
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error(
        `Cases file "${filePath}" looks like JSON but failed to parse. Check for syntax errors.`,
      );
    }
    if (!Array.isArray(parsed)) {
      throw new Error(`Cases file "${filePath}" must be a JSON array of case objects.`);
    }
    return parsed as AuditCase[];
  }

  // JSONL: one JSON object per line, skip empty lines and comments
  const cases: AuditCase[] = [];
  for (const line of trimmed.split("\n")) {
    const l = line.trim();
    if (!l || l.startsWith("//") || l.startsWith("#")) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(l);
    } catch {
      throw new Error(
        `Cases file "${filePath}" contains a malformed JSONL line:\n  ${l}`,
      );
    }
    cases.push(obj as AuditCase);
  }
  return cases;
}

// ---------------------------------------------------------------------------
// Hit check
// ---------------------------------------------------------------------------

/**
 * Returns the 1-based rank of the expected result in the top-K results,
 * or null if not found.
 *
 * Path match: forward-slash normalized equality.
 * Chunk match: if expectedChunk is provided, chunkName.includes(expectedChunk).
 * This handles both regular functions (chunkName = first 80 chars of source text)
 * and arrow functions (chunkName = binding identifier).
 */
function checkHit(
  results: Array<{ path: string; chunkName?: string }>,
  expectedPath: string,
  expectedChunk?: string,
): number | null {
  const normExpected = normalizePath(expectedPath);
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (normalizePath(r.path) !== normExpected) continue;
    if (expectedChunk && !r.chunkName?.includes(expectedChunk)) continue;
    return i + 1; // 1-based
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main audit runner
// ---------------------------------------------------------------------------

export async function runAudit(
  cwd: string,
  config: Config,
  options: AuditOptions = {},
): Promise<AuditResult> {
  const {
    casesFile,
    casesOnly = false,
    builtInOnly = false,
    k = 10,
    ci = false,
    json = false,
    verbose = false,
  } = options;

  // Mutually exclusive flag check
  if (casesOnly && builtInOnly) {
    stderr("Error: Cannot use --built-in-only and --cases-only together.", json);
    process.exit(1);
  }

  const ollamaBaseUrl = config.ollamaBaseUrl;
  if (!ollamaBaseUrl) {
    stderr(
      "Error: ollamaBaseUrl is not configured. Run 'phase2s init' to configure Ollama.",
      json,
    );
    process.exit(1);
  }

  const embedModel = config.ollamaEmbedModel ?? "nomic-embed-text:latest";

  // Load index
  let index: Awaited<ReturnType<typeof readCodeIndex>>;
  try {
    index = await readCodeIndex(cwd);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ENOENT") || msg.includes("no such file")) {
      stderr(
        "No code index found. Run 'phase2s sync' first to index your codebase.",
        json,
      );
    } else {
      stderr(`Failed to load code index: ${msg}. Run 'phase2s sync' to rebuild.`, json);
    }
    process.exit(1);
  }

  if (index.length === 0) {
    stderr("Code index is empty. Run 'phase2s sync' to populate the index.", json);
    process.exit(1);
  }

  // Model mismatch check
  const indexedModel = index[0]?.model;
  if (indexedModel && indexedModel !== embedModel) {
    const mismatchMsg =
      `⚠  Index was built with model "${indexedModel}" but current model is "${embedModel}". ` +
      `Scores will be garbage. Run 'phase2s sync' to rebuild with the current model.`;
    if (ci) {
      stderr(mismatchMsg, json);
      stderr("CI: exiting 1 due to model mismatch (scores would be meaningless).", json);
      process.exit(1);
    } else {
      // Interactive: warn to stderr, continue
      process.stderr.write(chalk.yellow(mismatchMsg) + "\n");
    }
  }

  // Build case list
  const cases: AuditCase[] = [];

  if (!casesOnly) {
    cases.push(...BUILT_IN_CASES);
  }

  if (!builtInOnly && casesFile) {
    const userCases = await loadCasesFile(casesFile);
    cases.push(...userCases);
  }

  if (cases.length === 0) {
    stderr("No audit cases to run. Provide --cases <file> or omit --cases-only.", json);
    process.exit(1);
  }

  // Header output (only when not --json)
  if (!json) {
    if (!casesOnly) {
      console.log(
        `Using built-in Phase2S query set (${BUILT_IN_CASES.length} cases)` +
        (casesFile && !builtInOnly ? ` + ${cases.length - BUILT_IN_CASES.length} user cases` : "") +
        ".",
      );
    } else {
      console.log(`Using user cases from ${casesFile} (${cases.length} cases).`);
    }
    console.log(`Loading index: ${index.length.toLocaleString()} chunks across ${countFiles(index)} files.`);
    console.log(`Running ${cases.length} queries...\n`);
  }

  // Per-query loop (sequential to avoid Ollama rate-limit hammering)
  const results: CaseResult[] = [];

  for (const c of cases) {
    const expectedHit = c.expectedHit !== false;

    // Embed
    let queryVector: number[];
    try {
      queryVector = await generateEmbedding(c.query, embedModel, ollamaBaseUrl);
    } catch {
      queryVector = [];
    }

    if (queryVector.length === 0) {
      process.stderr.write(
        chalk.dim(`  ⚠ Embedding failed for query: "${c.query.slice(0, 60)}" — skipping.\n`),
      );
      results.push({
        query: c.query,
        expectedPath: c.expectedPath,
        expectedChunk: c.expectedChunk,
        expectedHit,
        note: c.note,
        rank: null,
        skipped: true,
        hit1: false,
        hit3: false,
      });
      continue;
    }

    // Search
    const topK = findTopKCode(queryVector, index, k);
    const rank = checkHit(topK, c.expectedPath, c.expectedChunk);

    const matchedResult = rank != null ? topK[rank - 1] : undefined;

    results.push({
      query: c.query,
      expectedPath: c.expectedPath,
      expectedChunk: c.expectedChunk,
      expectedHit,
      note: c.note,
      rank,
      matchedPath: matchedResult?.path,
      matchedChunk: matchedResult?.chunkName,
      skipped: false,
      hit1: rank === 1,
      hit3: rank != null && rank <= 3,
    });

    // Live progress when not --json
    if (!json) {
      printCaseRow(results[results.length - 1], verbose);
    }
  }

  // Compute metrics — exclude known-weak and skipped from denominator
  const denominator = results.filter((r) => r.expectedHit && !r.skipped);
  const hit1Count = denominator.filter((r) => r.hit1).length;
  const hit3Count = denominator.filter((r) => r.hit3).length;
  const mrrSum = denominator.reduce((acc, r) => acc + (r.rank != null ? 1 / r.rank : 0), 0);
  const mrr = denominator.length > 0 ? mrrSum / denominator.length : 0;

  const summary: AuditSummary = {
    hit1: hit1Count,
    hit3: hit3Count,
    mrr,
    totalCases: results.length,
    expectedHitCases: denominator.length,
    skippedCases: results.filter((r) => r.skipped).length,
    knownWeakCases: results.filter((r) => !r.expectedHit).length,
    indexChunks: index.length,
  };

  const auditResult: AuditResult = { summary, cases: results };

  // Output
  if (json) {
    process.stdout.write(JSON.stringify(auditResult, null, 2) + "\n");
  } else {
    printSummary(summary);
  }

  // CI gate
  if (ci) {
    const hit1Rate = denominator.length > 0 ? hit1Count / denominator.length : 0;
    const hit3Rate = denominator.length > 0 ? hit3Count / denominator.length : 0;
    const failing = [];
    if (hit1Rate < CI_HIT1_THRESHOLD) {
      failing.push(`hit@1 ${pct(hit1Rate)} < ${pct(CI_HIT1_THRESHOLD)} threshold`);
    }
    if (hit3Rate < CI_HIT3_THRESHOLD) {
      failing.push(`hit@3 ${pct(hit3Rate)} < ${pct(CI_HIT3_THRESHOLD)} threshold`);
    }
    if (failing.length > 0) {
      stderr(`CI FAILED: ${failing.join("; ")}`, json);
      process.exit(1);
    }
  }

  return auditResult;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function stderr(msg: string, isJson: boolean): void {
  if (isJson) {
    process.stderr.write(msg + "\n");
  } else {
    process.stderr.write(chalk.red(msg) + "\n");
  }
}

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function countFiles(index: Array<{ path: string }>): number {
  return new Set(index.map((e) => e.path)).size;
}

function printCaseRow(r: CaseResult, verbose: boolean): void {
  const pathShort = r.expectedPath.split("/").pop() ?? r.expectedPath;
  const chunkLabel = r.expectedChunk ? `:${r.expectedChunk}` : "";
  const matchLabel = r.matchedPath
    ? `${(r.matchedPath.split("/").pop() ?? r.matchedPath)}${r.matchedChunk ? `:${r.matchedChunk.split("\n")[0].trim().slice(0, 40)}` : ""}`
    : "(not found in top-K)";

  let statusIcon: string;
  let rankStr: string;
  let hit1: string;
  let hit3: string;

  if (r.skipped) {
    statusIcon = chalk.dim("~");
    rankStr = chalk.dim("-");
    hit1 = chalk.dim("skip");
    hit3 = chalk.dim("skip");
  } else if (!r.expectedHit) {
    statusIcon = chalk.dim("[known weak]");
    rankStr = r.rank != null ? chalk.dim(String(r.rank)) : chalk.dim("-");
    hit1 = chalk.dim("-");
    hit3 = chalk.dim("-");
  } else if (r.hit1) {
    statusIcon = chalk.green("✓");
    rankStr = chalk.green("1");
    hit1 = chalk.green("✓");
    hit3 = chalk.green("✓");
  } else if (r.hit3) {
    statusIcon = chalk.yellow("~");
    rankStr = chalk.yellow(String(r.rank));
    hit1 = chalk.red("✗");
    hit3 = chalk.green("✓");
  } else {
    statusIcon = chalk.red("✗");
    rankStr = r.rank != null ? chalk.red(String(r.rank)) : chalk.red("-");
    hit1 = chalk.red("✗");
    hit3 = chalk.red("✗");
  }

  const queryTrunc = r.query.length > 44 ? r.query.slice(0, 41) + "..." : r.query.padEnd(44);
  console.log(
    `  ${statusIcon}  ${queryTrunc}  ${hit1.padEnd(6)}  ${hit3.padEnd(6)}  ${rankStr.padEnd(5)}  ${chalk.dim(pathShort + chunkLabel)} → ${chalk.dim(matchLabel)}`,
  );

  if (verbose && r.note) {
    console.log(chalk.dim(`         Note: ${r.note}`));
  }
}

function printSummary(s: AuditSummary): void {
  const n = s.expectedHitCases;
  const hit1Rate = n > 0 ? s.hit1 / n : 0;
  const hit3Rate = n > 0 ? s.hit3 / n : 0;

  console.log();
  console.log("  " + chalk.bold("Summary"));
  console.log("  " + "─".repeat(40));
  console.log(`  hit@1   : ${s.hit1}/${n} (${pct(hit1Rate)})`);
  console.log(`  hit@3   : ${s.hit3}/${n} (${pct(hit3Rate)})`);
  console.log(`  MRR     : ${s.mrr.toFixed(2)}`);
  console.log(
    `  Queries : ${s.totalCases}   |   Chunks: ${s.indexChunks.toLocaleString()}` +
    (s.knownWeakCases > 0 ? `   |   Known weak: ${s.knownWeakCases}` : "") +
    (s.skippedCases > 0 ? `   |   Skipped: ${s.skippedCases}` : ""),
  );
  console.log();
}
