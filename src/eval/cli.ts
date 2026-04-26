import { loadConfig } from "../core/config.js";
import { runAllEvals } from "./runner.js";
import { judgeE2E } from "./judge.js";
import { writeEvalResults, DEFAULT_OUTPUT_DIR } from "./reporter.js";

async function main(): Promise<void> {
  const config = await loadConfig();

  console.log("Running eval suite...");
  const runnerResults = await runAllEvals(config);

  if (runnerResults.length === 0) {
    console.log("No eval cases found in eval/");
    console.log("\n✔ Deploy gate: READY (no cases to run)");
    return;
  }

  console.log(`Running eval suite (${runnerResults.length} case${runnerResults.length > 1 ? "s" : ""})...\n`);

  const judgeResults = await Promise.all(
    runnerResults.map(r => judgeE2E(r, config)),
  );

  writeEvalResults(runnerResults, judgeResults);

  let failed = false;
  const scoresBySkill: Record<string, number | null> = {};

  for (let i = 0; i < runnerResults.length; i++) {
    const r = runnerResults[i];
    const j = judgeResults[i];
    const score = j.score;
    const elapsed = (r.elapsed_ms / 1000).toFixed(1);
    const scoreStr = score === null ? "—/10" : `${score}/10`;
    const status = score === null || score < 6.0 ? "✗" : "✓";

    if (score !== null && score < 6.0) failed = true;

    scoresBySkill[r.case.skill] = score;
    console.log(`${status} ${r.case.name.padEnd(45)} ${scoreStr}  (${elapsed}s)`);
  }

  const passed = runnerResults.filter((_, i) => {
    const s = judgeResults[i].score;
    return s !== null && s >= 6.0;
  }).length;
  const failedCount = runnerResults.length - passed;

  console.log(`\nResults: ${passed} passed, ${failedCount} failed`);

  const scoreEntries = Object.entries(scoresBySkill)
    .map(([k, v]) => `${k}=${v ?? "—"}`)
    .join("  ");
  console.log(`Scores:  ${scoreEntries}`);
  console.log(`Written: ${DEFAULT_OUTPUT_DIR} (${runnerResults.length * 2} files)`);

  if (failed) {
    console.log("\n✗ Deploy gate: NOT READY — one or more scores below 6.0");
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
