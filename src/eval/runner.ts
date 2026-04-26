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

export async function runEvalCase(
  ec: EvalCase,
  config: Config,
  skills?: Awaited<ReturnType<typeof loadAllSkills>>,
): Promise<RunnerResult> {
  const start = Date.now();

  const allSkills = skills ?? await loadAllSkills();
  const skill = allSkills.find(s => s.name === ec.skill);

  if (!skill) {
    return {
      case: ec,
      output: "",
      elapsed_ms: Date.now() - start,
      error: `Skill not found: ${ec.skill}`,
    };
  }

  const agent = new Agent({ config });
  const timeout = ec.timeout_ms ?? 60_000;

  try {
    const substituted = substituteInputs(skill.promptTemplate, ec.inputs ?? {}, skill.inputs);
    let timerId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timerId = setTimeout(() => reject(new Error(`Eval timed out after ${timeout}ms`)), timeout);
      timerId.unref?.();
    });
    const output = await Promise.race([
      agent.run(substituted, { modelOverride: skill.model }).finally(() => {
        if (timerId !== undefined) clearTimeout(timerId);
      }),
      timeoutPromise,
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
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.warn(`Warning: could not read eval/ directory: ${err instanceof Error ? err.message : String(err)}`);
    } else {
      console.warn("Warning: eval/ directory not found — no eval cases to run.");
    }
    return [];
  }

  const skills = await loadAllSkills();
  const results: RunnerResult[] = [];
  for (const file of files) {
    let ec: EvalCase | null = null;
    try {
      const content = await readFile(join(evalDir, file), "utf8");
      ec = parseYaml(content) as EvalCase | null;
    } catch (err) {
      console.warn(`Warning: skipping ${file} — ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (!ec || !ec.name || !ec.skill) continue; // skip commented-out or empty files
    const result = await runEvalCase(ec, config, skills);
    results.push(result);
  }
  return results;
}
