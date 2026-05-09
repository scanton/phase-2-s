import { loadConfig } from "../core/config.js";
import { runAllEvals, runWithConcurrency } from "./runner.js";
import { judgeE2E } from "./judge.js";
import { writeEvalResults, DEFAULT_OUTPUT_DIR } from "./reporter.js";

const PASS_THRESHOLD = 6.0;
const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 20;

/**
 * Parse --concurrency N (or --concurrency=N) from process.argv.
 * Falls back to defaultValue when the flag is absent.
 * Clamps to [1, MAX_CONCURRENCY]; warns and clamps on out-of-range values.
 */
function parseConcurrency(argv: string[], defaultValue: number): number {
  let raw: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--concurrency" && i + 1 < argv.length) {
      raw = argv[i + 1];
      break;
    }
    const match = argv[i].match(/^--concurrency=(.+)$/);
    if (match) {
      raw = match[1];
      break;
    }
  }
  if (raw === undefined) return defaultValue;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    console.warn(`Warning: --concurrency "${raw}" is not a valid number; using default ${defaultValue}`);
    return defaultValue;
  }
  if (n < 1) {
    console.warn(`Warning: --concurrency ${n} < 1; clamped to 1`);
    return 1;
  }
  if (n > MAX_CONCURRENCY) {
    console.warn(`Warning: --concurrency ${n} > ${MAX_CONCURRENCY}; clamped to ${MAX_CONCURRENCY}`);
    return MAX_CONCURRENCY;
  }
  return Math.floor(n);
}

async function main(): Promise<void> {
  const config = await loadConfig();
  const concurrency = parseConcurrency(process.argv.slice(2), DEFAULT_CONCURRENCY);

  const runnerResults = await runAllEvals(config, { concurrency });

  if (runnerResults.length === 0) {
    // runAllEvals already warned if the directory was missing
    console.log("\n✔ Deploy gate: READY (no cases to run)");
    return;
  }

  console.log(`Ran eval suite (${runnerResults.length} case${runnerResults.length > 1 ? "s" : ""}, concurrency=${concurrency}). Judging...\n`);

  // OV6: judge phase also capped by runWithConcurrency
  const judgeTasks = runnerResults.map(r => () => judgeE2E(r, config));
  const judgeResults = await runWithConcurrency(judgeTasks, concurrency);

  try {
    await writeEvalResults(runnerResults, judgeResults);
  } catch (err) {
    console.warn(`Warning: could not write eval results — ${err instanceof Error ? err.message : String(err)}`);
  }

  let failed = false;
  let passed = 0;
  const scoresBySkill: Record<string, (number | null)[]> = {};

  for (let i = 0; i < runnerResults.length; i++) {
    const r = runnerResults[i];
    const j = judgeResults[i];
    const score = j.score;
    const elapsed = (r.elapsed_ms / 1000).toFixed(1);
    const scoreStr = score === null ? "—/10" : `${score}/10`;
    const passes = score !== null && score >= PASS_THRESHOLD;
    const status = passes ? "✓" : "✗";

    if (!passes) failed = true;
    else passed++;

    const existing = scoresBySkill[r.case.skill] ?? [];
    scoresBySkill[r.case.skill] = [...existing, score];
    console.log(`${status} ${r.case.name.padEnd(45)} ${scoreStr}  (${elapsed}s)`);
  }

  const failedCount = runnerResults.length - passed;

  console.log(`\nResults: ${passed} passed, ${failedCount} failed`);

  const scoreEntries = Object.entries(scoresBySkill)
    .map(([k, scores]) => {
      const nums = scores.filter((s): s is number => s !== null);
      if (nums.length === 0) return `${k}=—`;
      if (nums.length === 1) return `${k}=${nums[0]}`;
      const min = Math.min(...nums);
      const max = Math.max(...nums);
      return min === max ? `${k}=${min}` : `${k}=${min}-${max}`;
    })
    .join("  ");
  console.log(`Scores:  ${scoreEntries}`);
  console.log(`Written: ${DEFAULT_OUTPUT_DIR} (${runnerResults.length * 2} files)`);

  if (failed) {
    console.log(`\n✗ Deploy gate: NOT READY — one or more scores below ${PASS_THRESHOLD} (or judge failed)`);
    process.exit(1);
  } else {
    console.log("\n✔ Deploy gate: READY");
  }
}

// Only run when executed directly (not when imported by tests)
if (process.argv[1] && (process.argv[1].endsWith("cli.ts") || process.argv[1].endsWith("cli.js"))) {
  main().catch(err => {
    console.error("eval failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

export { main };
