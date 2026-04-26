import { loadConfig } from "../core/config.js";
import { runAllEvals } from "./runner.js";
import { judgeE2E } from "./judge.js";
import { writeEvalResults, DEFAULT_OUTPUT_DIR } from "./reporter.js";

const PASS_THRESHOLD = 6.0;

async function main(): Promise<void> {
  const config = await loadConfig();

  const runnerResults = await runAllEvals(config);

  if (runnerResults.length === 0) {
    // runAllEvals already warned if the directory was missing
    console.log("\n✔ Deploy gate: READY (no cases to run)");
    return;
  }

  console.log(`Running eval suite (${runnerResults.length} case${runnerResults.length > 1 ? "s" : ""})...\n`);

  const judgeResults = await Promise.all(
    runnerResults.map(r => judgeE2E(r, config)),
  );

  try {
    writeEvalResults(runnerResults, judgeResults);
  } catch (err) {
    console.warn(`Warning: could not write eval results — ${err instanceof Error ? err.message : String(err)}`);
  }

  let failed = false;
  let passed = 0;
  const scoresBySkill: Record<string, number | null> = {};

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

    scoresBySkill[r.case.skill] = score;
    console.log(`${status} ${r.case.name.padEnd(45)} ${scoreStr}  (${elapsed}s)`);
  }

  const failedCount = runnerResults.length - passed;

  console.log(`\nResults: ${passed} passed, ${failedCount} failed`);

  const scoreEntries = Object.entries(scoresBySkill)
    .map(([k, v]) => `${k}=${v ?? "—"}`)
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
