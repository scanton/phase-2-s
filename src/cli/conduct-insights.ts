/**
 * phase2s conduct-insights — conductor run analytics.
 *
 * Reads `.phase2s/conduct-log.jsonl` and produces a stats table:
 *   - Total runs (excl. dry-runs), success rate, avg duration
 *   - Subtask distribution (min / median / max)
 *   - Refinement round histogram (0 / 1 / 2 / 3 rounds)
 *   - Top 5 roles by frequency
 *   - Last 5 goal snippets with outcome icon
 *
 * Sprint 91 additions:
 *   - --json flag: emit raw stats object as JSON (for MCP tool reuse)
 *   - --rebuild-index: rebuild .phase2s/conduct-index.json from all logged entries
 */

import chalk from "chalk";
import { readConductLog, type ConductLogEntry } from "./conduct-log.js";
import {
  readConductIndex,
  writeConductIndex,
  type ConductIndexEntry,
} from "../core/conduct-index.js";
import { generateEmbedding } from "../core/embeddings.js";
import { loadConfig } from "../core/config.js";

// ---------------------------------------------------------------------------
// Stats type
// ---------------------------------------------------------------------------

export interface ConductStats {
  totalRuns: number;
  successCount: number;
  successRate: number;
  avgDurationMs: number;
  subtaskMin: number;
  subtaskMedian: number;
  subtaskMax: number;
  roundHistogram: Record<string, number>;
  topRoles: Array<{ role: string; count: number }>;
  recentGoals: Array<{ goalSnippet: string; success: boolean; ts: string }>;
  /** Dry-run count — informational only, excluded from successRate. */
  dryRunCount: number;
}

// ---------------------------------------------------------------------------
// computeConductStats
// ---------------------------------------------------------------------------

/**
 * Compute aggregated statistics from an array of conduct log entries.
 *
 * Dry-run entries (dryRun: true) are counted but excluded from success-rate
 * and subtask/duration computations — they never ran the orchestrator.
 */
export function computeConductStats(entries: ConductLogEntry[]): ConductStats {
  const dryRuns = entries.filter((e) => e.dryRun === true);
  const runs = entries.filter((e) => !e.dryRun);

  const successCount = runs.filter((e) => e.success).length;
  const successRate = runs.length > 0 ? successCount / runs.length : 0;

  const avgDurationMs =
    runs.length > 0
      ? Math.round(runs.reduce((sum, e) => sum + e.durationMs, 0) / runs.length)
      : 0;

  const subtaskCounts = runs.map((e) => e.subtaskCount).sort((a, b) => a - b);
  const subtaskMin = subtaskCounts.length > 0 ? subtaskCounts[0] : 0;
  const subtaskMax = subtaskCounts.length > 0 ? subtaskCounts[subtaskCounts.length - 1] : 0;
  const subtaskMedian =
    subtaskCounts.length > 0
      ? subtaskCounts[Math.floor(subtaskCounts.length / 2)]
      : 0;

  // Refinement round histogram — include all runs (dry-runs too, since they may refine)
  const roundHistogram: Record<string, number> = { "0": 0, "1": 0, "2": 0, "3": 0 };
  for (const e of entries) {
    const key = String(Math.min(e.rounds, 3));
    roundHistogram[key] = (roundHistogram[key] ?? 0) + 1;
  }

  // Top roles by frequency across all non-dry runs
  const roleCounts: Map<string, number> = new Map();
  for (const e of runs) {
    for (const role of e.roles) {
      roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
    }
  }
  const topRoles = [...roleCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([role, count]) => ({ role, count }));

  // Last 5 goals (newest first) from all entries
  const recentGoals = entries.slice(0, 5).map((e) => ({
    goalSnippet: e.goal.slice(0, 60),
    success: e.success,
    ts: e.ts,
  }));

  return {
    totalRuns: runs.length,
    successCount,
    successRate,
    avgDurationMs,
    subtaskMin,
    subtaskMedian,
    subtaskMax,
    roundHistogram,
    topRoles,
    recentGoals,
    dryRunCount: dryRuns.length,
  };
}

// ---------------------------------------------------------------------------
// renderConductStats
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

export function renderConductStats(stats: ConductStats): void {
  if (stats.totalRuns === 0 && stats.dryRunCount === 0) {
    console.log(chalk.dim("  No conduct runs logged yet. Run `phase2s conduct` to start."));
    return;
  }

  const pct = (stats.successRate * 100).toFixed(0);
  console.log(chalk.bold("\n  Conductor Run Summary"));
  console.log(chalk.dim("  ─────────────────────────────────────────"));
  console.log(`  Total runs      ${chalk.cyan(stats.totalRuns)}${stats.dryRunCount > 0 ? chalk.dim(` (+${stats.dryRunCount} dry-run${stats.dryRunCount === 1 ? "" : "s"})`) : ""}`);
  console.log(`  Success rate    ${Number(pct) >= 70 ? chalk.green(`${pct}%`) : Number(pct) >= 40 ? chalk.yellow(`${pct}%`) : chalk.red(`${pct}%`)}  (${stats.successCount}/${stats.totalRuns})`);
  console.log(`  Avg duration    ${chalk.cyan(formatDuration(stats.avgDurationMs))}`);

  if (stats.totalRuns > 0) {
    console.log(`  Subtasks        min ${stats.subtaskMin} / median ${stats.subtaskMedian} / max ${stats.subtaskMax}`);

    const hist = stats.roundHistogram;
    const histParts = ["0", "1", "2", "3"].map((k) => {
      const v = hist[k] ?? 0;
      return v > 0 ? `${k}×: ${v}` : null;
    }).filter(Boolean).join("  ");
    console.log(`  Refinements     ${histParts || "none"}`);
  }

  if (stats.topRoles.length > 0) {
    const rolesStr = stats.topRoles.map((r) => `${r.role} (${r.count})`).join(", ");
    console.log(`  Top roles       ${rolesStr}`);
  }

  if (stats.recentGoals.length > 0) {
    console.log(chalk.dim("\n  Recent goals:"));
    for (const g of stats.recentGoals) {
      const icon = g.success ? chalk.green("✓") : chalk.red("✗");
      console.log(`    ${icon} ${chalk.dim(g.goalSnippet)}`);
    }
  }
  console.log();
}

// ---------------------------------------------------------------------------
// runConductInsights
// ---------------------------------------------------------------------------

export interface ConductInsightsOptions {
  limit?: number;
  json?: boolean;
  rebuildIndex?: boolean;
  quiet?: boolean;
}

export async function runConductInsights(
  options: ConductInsightsOptions,
  cwd: string,
): Promise<void> {
  if (options.rebuildIndex) {
    // Rebuild always reads the full log — --limit is ignored so we don't silently
    // omit older entries from the index. Pass undefined to read all entries.
    const allEntries = await readConductLog(cwd);
    await rebuildConductIndex(allEntries, cwd, options.quiet);
    return;
  }

  const entries = await readConductLog(cwd, options.limit);

  const stats = computeConductStats(entries);

  if (options.json) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  renderConductStats(stats);
}

// ---------------------------------------------------------------------------
// rebuildConductIndex
// ---------------------------------------------------------------------------

/**
 * Rebuild the conduct embed index from scratch by re-embedding every non-dry-run
 * entry in the provided log. Requires Ollama to be configured.
 *
 * Progress is logged to stdout unless quiet mode is active.
 */
async function rebuildConductIndex(
  entries: ConductLogEntry[],
  cwd: string,
  quiet?: boolean,
): Promise<void> {
  const config = await loadConfig();
  const baseUrl = config.ollamaBaseUrl ?? "";
  const model = config.ollamaEmbedModel ?? "";

  if (!baseUrl || !model) {
    console.error(
      chalk.red("✗ Ollama is not configured. Set ollamaBaseUrl and ollamaEmbedModel in .phase2s.yaml."),
    );
    console.error(chalk.dim("  See README for Ollama setup instructions."));
    process.exitCode = 1;
    return;
  }

  const runs = entries.filter((e) => !e.dryRun);
  if (runs.length === 0) {
    console.log(chalk.dim("  No non-dry-run entries to index."));
    return;
  }

  if (!quiet) {
    console.log(chalk.cyan(`  Rebuilding conduct index (${runs.length} entries)...`));
  }

  let indexed = 0;
  /** Entries that came back from Ollama with an empty embedding vector. */
  let emptyEmbedCount = 0;

  // Read once, apply all upserts in memory, write once — avoids O(N²) file I/O.
  const index = await readConductIndex(cwd);

  for (const entry of runs) {
    const embedding = await generateEmbedding(entry.goal, model, baseUrl);
    if (embedding.length === 0) {
      emptyEmbedCount++;
    }
    const indexEntry: ConductIndexEntry = {
      id: entry.ts,
      goalSnippet: entry.goal.slice(0, 120),
      embedding,
      success: entry.success,
      durationMs: entry.durationMs,
      subtaskCount: entry.subtaskCount,
    };
    const pos = index.entries.findIndex((e) => e.id === indexEntry.id);
    if (pos >= 0) {
      index.entries[pos] = indexEntry;
    } else {
      index.entries.push(indexEntry);
    }
    indexed++;
    if (!quiet && indexed % 10 === 0) {
      process.stdout.write(`\r  ${chalk.cyan(indexed)}/${runs.length} entries indexed...`);
    }
  }

  // Single write after all in-memory upserts are done.
  let writeError: string | undefined;
  try {
    await writeConductIndex(cwd, index);
  } catch (err) {
    writeError = err instanceof Error ? err.message : String(err);
  }

  if (!quiet) {
    process.stdout.write("\r");
    if (writeError) {
      // Write failed — embeddings succeeded but index could not be persisted.
      console.error(chalk.red(`  ✗ Conduct index write failed: ${writeError}`));
      console.warn(chalk.yellow("  ⚠ Check disk space and permissions for .phase2s/conduct-index.json"));
    } else {
      const skipNote = emptyEmbedCount > 0 ? chalk.yellow(` (${emptyEmbedCount} skipped — empty embedding from Ollama)`) : "";
      console.log(chalk.green(`  ✓ Conduct index rebuilt: ${indexed} entries indexed${skipNote}`));
      if (indexed === 0) {
        console.warn(chalk.yellow("  ⚠ No entries were indexed. Is Ollama running? Try: ollama serve"));
      }
    }
  }
}
