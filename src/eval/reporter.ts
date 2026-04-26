import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { RunnerResult } from "./runner.js";
import type { JudgeResult } from "./judge.js";

export const DEFAULT_OUTPUT_DIR = join(homedir(), ".gstack-dev", "evals");

/**
 * Write eval results to the output directory in the format expected by the
 * land-and-deploy readiness gate:
 *   {skill}-e2e-run-{YYYY-MM-DD}-{ts}.json
 *   {skill}-llm-judge-run-{YYYY-MM-DD}-{ts}.json
 */
export function writeEvalResults(
  runnerResults: RunnerResult[],
  judgeResults: JudgeResult[],
  outputDir: string = DEFAULT_OUTPUT_DIR,
): void {
  mkdirSync(outputDir, { recursive: true });

  const dateStr = new Date().toISOString().slice(0, 10);
  const ts = Date.now();

  for (let i = 0; i < runnerResults.length; i++) {
    const runnerResult = runnerResults[i];
    const judgeResult = judgeResults[i];
    const skill = runnerResult.case.skill;

    const runnerFile = join(outputDir, `${skill}-e2e-run-${dateStr}-${ts}.json`);
    const judgeFile = join(outputDir, `${skill}-llm-judge-run-${dateStr}-${ts}.json`);

    writeFileSync(
      runnerFile,
      JSON.stringify(
        {
          case: runnerResult.case,
          output: runnerResult.output,
          elapsed_ms: runnerResult.elapsed_ms,
          ...(runnerResult.error !== undefined ? { error: runnerResult.error } : {}),
        },
        null,
        2,
      ),
    );

    if (judgeResult !== undefined) {
      writeFileSync(
        judgeFile,
        JSON.stringify(
          {
            score: judgeResult.score,
            verdict: judgeResult.verdict,
            criteria: judgeResult.criteria,
            ...(judgeResult.responseStats !== undefined
              ? { responseStats: judgeResult.responseStats }
              : {}),
          },
          null,
          2,
        ),
      );
    }
  }
}
