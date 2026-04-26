import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { Agent } from "../core/agent.js";
import { loadAllSkills } from "../skills/loader.js";
import { substituteInputs } from "../skills/template.js";
import type { Config } from "../core/config.js";
import type { CriterionSpec, EvalCase, RunnerResult } from "./types.js";

// Re-export so consumers only need to import from runner.ts
export type { CriterionSpec, EvalCase, RunnerResult };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function runEvalCase(ec: EvalCase, config: Config): Promise<RunnerResult> {
  const start = Date.now();

  const skills = await loadAllSkills();
  const skill = skills.find(s => s.name === ec.skill);

  if (!skill) {
    return {
      case: ec,
      output: "",
      elapsed_ms: Date.now() - start,
      error: `Skill not found: ${ec.skill}`,
    };
  }

  const substituted = substituteInputs(skill.promptTemplate, ec.inputs, skill.inputs);
  const agent = new Agent({ config });

  const timeout = ec.timeout_ms ?? 60_000;

  try {
    const output = await Promise.race([
      agent.run(substituted, { modelOverride: skill.model }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Eval timed out after ${timeout}ms`)), timeout),
      ),
    ]);
    return { case: ec, output, elapsed_ms: Date.now() - start };
  } catch (err) {
    return {
      case: ec,
      output: "",
      elapsed_ms: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runAllEvals(config: Config): Promise<RunnerResult[]> {
  const evalDir = join(process.cwd(), "eval");

  let files: string[];
  try {
    const entries = await readdir(evalDir);
    files = entries.filter(f => f.endsWith(".eval.yaml")).sort();
  } catch {
    return [];
  }

  const results: RunnerResult[] = [];
  for (const file of files) {
    const content = await readFile(join(evalDir, file), "utf8");
    const ec = parseYaml(content) as EvalCase | null;
    if (!ec || !ec.name || !ec.skill) continue; // skip commented-out or empty files
    const result = await runEvalCase(ec, config);
    results.push(result);
  }
  return results;
}
