/**
 * Goal executor — "dark factory" mode.
 *
 * Reads a 5-pillar spec file, breaks it into sub-tasks, runs each through
 * /satori (implement + test + retry), checks acceptance criteria against eval
 * output, retries failed sub-tasks with failure context, and loops until all
 * criteria pass or max attempts are exhausted.
 *
 * Usage: phase2s goal <spec-file> [--max-attempts <n>] [--resume]
 *
 * With --resume: reads existing state from .phase2s/state/<hash>.json
 * (relative to the spec file directory), skips completed sub-tasks, and
 * injects saved failure context for failed ones. Starts fresh if no state
 * exists.
 */

import { execFile } from "child_process";
import { readFileSync } from "fs";
import { resolve, dirname, basename } from "path";
import { Agent } from "../core/agent.js";
import { loadConfig } from "../core/config.js";
import { loadLearnings, formatLearningsForPrompt } from "../core/memory.js";
import { parseSpec, type Spec, type SubTask } from "../core/spec-parser.js";
import { computeSpecHash, readState, writeState, clearState, type GoalState } from "../core/state.js";
import { loadAllSkills } from "../skills/index.js";
import { substituteInputs, stripAskTokens } from "../skills/template.js";

/** Cap on bytes stored for failureContext per sub-task. */
const FAILURE_CONTEXT_MAX_BYTES = 4096;

export interface GoalOptions {
  maxAttempts?: string;
  resume?: boolean;
}

export interface GoalResult {
  success: boolean;
  attempts: number;
  criteriaResults: Record<string, boolean>;
}

export async function runGoal(specFile: string, options: GoalOptions = {}): Promise<GoalResult> {
  const specPath = resolve(process.cwd(), specFile);
  // State is stored relative to the spec file directory, not invocation cwd.
  const specDir = dirname(specPath);

  let markdown: string;
  try {
    markdown = readFileSync(specPath, "utf8");
  } catch {
    console.error(`Error: Cannot read spec file: ${specPath}`);
    process.exit(1);
  }

  const specHash = computeSpecHash(markdown);
  const spec = parseSpec(markdown);
  const maxAttempts = Math.max(1, parseInt(options.maxAttempts ?? "3", 10) || 3);
  const resume = !!options.resume;

  // -------------------------------------------------------------------------
  // State: load existing state when resuming, otherwise start fresh.
  // -------------------------------------------------------------------------
  let state: GoalState | null = resume ? readState(specDir, specHash) : null;

  // If --resume but no prior state found: silently start fresh (no error).
  if (state === null) {
    state = {
      specFile: basename(specPath),
      specHash,
      startedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      maxAttempts,
      attempt: 0,
      subTaskResults: {},
    };
  }

  console.log(`\nGoal executor: ${spec.title}`);
  console.log(`Eval command: ${spec.evalCommand}`);
  console.log(`Sub-tasks: ${spec.decomposition.length}`);
  console.log(`Acceptance criteria: ${spec.acceptanceCriteria.length}`);
  console.log(`Max attempts: ${maxAttempts}`);
  if (resume) {
    const doneCount = Object.values(state.subTaskResults).filter((r) => r.status === "passed").length;
    console.log(`Resuming: ${doneCount}/${spec.decomposition.length} sub-tasks already completed`);
  }

  if (spec.decomposition.length === 0 && spec.acceptanceCriteria.length === 0) {
    console.log("\nSpec has no sub-tasks and no acceptance criteria. Nothing to execute.");
    return { success: true, attempts: 0, criteriaResults: {} };
  }

  // Warn on large specs
  if (spec.decomposition.length * maxAttempts > 15) {
    console.warn(
      `\nWarning: Large spec with deep retry depth (${spec.decomposition.length} sub-tasks × ${maxAttempts} attempts). ` +
      "This may take a while and consume significant ChatGPT usage.",
    );
  }

  // Set up agent
  const config = await loadConfig();
  const learningsList = await loadLearnings(process.cwd());
  const learningsStr = formatLearningsForPrompt(learningsList);
  const agent = new Agent({ config, learnings: learningsStr });

  // Load skills to get satori template + settings
  const skills = await loadAllSkills();
  const satoriSkill = skills.find((s) => s.name === "satori");
  const satoriRetries = satoriSkill?.retries ?? 3;
  const satoriModel = satoriSkill?.model;

  // Build the satori base prompt from its template (same as what the REPL does)
  const satoriTemplate = satoriSkill
    ? stripAskTokens(substituteInputs(satoriSkill.promptTemplate, {}, satoriSkill.inputs)).result
    : "";

  let attempt = state.attempt;
  let subtasksToRun = spec.decomposition;
  let previousFailureContext: string | undefined;
  let criteriaResults: Record<string, boolean> = {};

  while (attempt < maxAttempts) {
    attempt++;
    state.attempt = attempt;
    console.log(`\n${"=".repeat(50)}`);
    console.log(`Attempt ${attempt}/${maxAttempts}`);
    console.log("=".repeat(50));

    // Run sub-tasks through satori
    for (let i = 0; i < subtasksToRun.length; i++) {
      const subtask = subtasksToRun[i];
      // When resuming, find the original index of this sub-task in the full decomposition.
      const globalIndex = spec.decomposition.indexOf(subtask);
      const indexKey = String(globalIndex >= 0 ? globalIndex : i);
      const priorResult = state.subTaskResults[indexKey];

      // Skip sub-tasks already marked passed on a prior run.
      if (priorResult?.status === "passed") {
        console.log(`\nSkipping sub-task (already passed): ${subtask.name}`);
        continue;
      }

      // Inject prior failure context if this sub-task failed before.
      const priorFailureContext = priorResult?.status === "failed"
        ? priorResult.failureContext
        : previousFailureContext;

      console.log(`\nRunning sub-task: ${subtask.name}`);
      const taskContext = buildSatoriContext(subtask, spec.constraints, priorFailureContext);
      // Combine satori system instructions + task-specific context
      const effectivePrompt = satoriTemplate
        ? `${satoriTemplate}\n\n## Task\n${taskContext}`
        : taskContext;

      // Capture satori output so we can store it as failureContext if needed.
      const outputChunks: string[] = [];
      let satoriError: unknown = null;
      try {
        await agent.run(effectivePrompt, {
          modelOverride: satoriModel,
          maxRetries: satoriRetries,
          verifyCommand: spec.evalCommand,
          onDelta: (chunk) => {
            process.stdout.write(chunk);
            outputChunks.push(chunk);
          },
        });
      } catch (err) {
        satoriError = err;
      }
      process.stdout.write("\n");

      const outputStr = outputChunks.join("");
      const truncated = outputStr.slice(-FAILURE_CONTEXT_MAX_BYTES);

      if (satoriError) {
        // Sub-task threw — mark as failed, write checkpoint, continue.
        state.subTaskResults[indexKey] = {
          status: "failed",
          failureContext: truncated,
          attempts: (priorResult?.attempts ?? 0) + 1,
        };
        state.lastUpdatedAt = new Date().toISOString();
        writeState(specDir, specHash, state);
        console.error(`\nSub-task failed: ${subtask.name}`);
      } else {
        // Sub-task completed without throwing — mark as passed, write checkpoint.
        state.subTaskResults[indexKey] = {
          status: "passed",
          completedAt: new Date().toISOString(),
        };
        state.lastUpdatedAt = new Date().toISOString();
        writeState(specDir, specHash, state);
      }
    }

    // Run evaluation
    console.log(`\nRunning evaluation: ${spec.evalCommand}`);
    const evalOutput = await runCommand(spec.evalCommand);
    console.log(evalOutput.slice(0, 1000) + (evalOutput.length > 1000 ? "\n[...truncated...]" : ""));

    // If no acceptance criteria, report raw output and exit
    if (spec.acceptanceCriteria.length === 0) {
      console.log("\nNo acceptance criteria defined. Eval output shown above.");
      return { success: true, attempts: attempt, criteriaResults: {} };
    }

    // Check acceptance criteria
    criteriaResults = await checkCriteria(spec.acceptanceCriteria, evalOutput, agent);
    printCriteriaTable(criteriaResults);

    const failing = Object.entries(criteriaResults).filter(([, pass]) => !pass).map(([c]) => c);

    if (failing.length === 0) {
      console.log(`\n✓ All acceptance criteria met after ${attempt} attempt(s).`);
      // Clean completion: remove state so stale state doesn't block future runs.
      clearState(specDir, specHash);
      return { success: true, attempts: attempt, criteriaResults };
    }

    if (attempt < maxAttempts) {
      previousFailureContext = await analyzeFailures(failing, evalOutput, spec, agent);
      subtasksToRun = await identifyFailedSubtasks(failing, spec.decomposition, previousFailureContext, agent);
      // Reset passed sub-tasks on the next attempt so they re-run in context of new failures.
      // We only keep the state for cross-run resumability, not within the same goal invocation.
      console.log(`\nRetrying ${subtasksToRun.length} sub-task(s): ${subtasksToRun.map((s) => s.name).join(", ")}`);
    }
  }

  console.log(`\n✗ Goal not achieved after ${maxAttempts} attempts.`);
  console.log("Failing criteria:");
  for (const [criterion, pass] of Object.entries(criteriaResults)) {
    if (!pass) console.log(`  ✗ ${criterion}`);
  }
  return { success: false, attempts: maxAttempts, criteriaResults };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function buildSatoriContext(
  subtask: SubTask,
  constraints: Spec["constraints"],
  failureContext?: string,
): string {
  const mustDo = constraints.mustDo.length > 0 ? constraints.mustDo.join("; ") : "(none specified)";
  const cannotDo = constraints.cannotDo.length > 0 ? constraints.cannotDo.join("; ") : "(none specified)";

  let context = `${subtask.successCriteria}

## Context
- Input: ${subtask.input || "(not specified)"}
- Expected output: ${subtask.output || "(not specified)"}

## Constraints
- Must do: ${mustDo}
- Cannot do: ${cannotDo}`;

  if (failureContext) {
    context += `

## Previous failure
${failureContext}

Fix this specifically. Do not repeat the same approach.`;
  }

  return context;
}

export async function checkCriteria(
  criteria: string[],
  evalOutput: string,
  agent: Agent,
): Promise<Record<string, boolean>> {
  const truncated = evalOutput.slice(0, 4000);
  const criteriaList = criteria.map((c, i) => `${i + 1}. ${c}`).join("\n");

  const prompt = `Given this evaluation output:
\`\`\`
${truncated}
\`\`\`

For each acceptance criterion below, respond with exactly one line per criterion.
Format: "PASS: <criterion text>" or "FAIL: <criterion text> — <brief reason>"
Do not add any other text. One line per criterion, in order.

Acceptance criteria:
${criteriaList}`;

  const response = await agent.run(prompt);

  const results: Record<string, boolean> = {};
  for (const criterion of criteria) {
    results[criterion] = false; // default to fail
  }

  // Parse PASS/FAIL lines — match by content, not position
  const responseLines = response.split("\n");
  for (const line of responseLines) {
    const passMatch = line.match(/^PASS:\s*(.+)/i);
    const failMatch = line.match(/^FAIL:\s*(.+?)(\s*—.*)?$/i);

    if (passMatch) {
      const text = passMatch[1].trim();
      // Find best matching criterion
      const matched = findBestMatch(text, criteria);
      if (matched) results[matched] = true;
    } else if (failMatch) {
      // Already defaulted to false — no action needed
    }
  }

  return results;
}

function findBestMatch(text: string, criteria: string[]): string | null {
  // Exact match first
  const exact = criteria.find((c) => c.toLowerCase() === text.toLowerCase());
  if (exact) return exact;

  // Substring match — criterion contains the text or text contains criterion
  const sub = criteria.find(
    (c) => c.toLowerCase().includes(text.toLowerCase()) ||
           text.toLowerCase().includes(c.toLowerCase().slice(0, 30)),
  );
  return sub ?? null;
}

export async function analyzeFailures(
  failing: string[],
  evalOutput: string,
  spec: Spec,
  agent: Agent,
): Promise<string> {
  const truncated = evalOutput.slice(0, 2000);
  const prompt = `These acceptance criteria failed:
${failing.map((c) => `- ${c}`).join("\n")}

Eval output (truncated):
\`\`\`
${truncated}
\`\`\`

Spec problem statement: ${spec.problemStatement.slice(0, 500)}

In 2-3 sentences, what most likely went wrong and what should change on the next attempt?`;

  return agent.run(prompt);
}

export async function identifyFailedSubtasks(
  failing: string[],
  decomposition: SubTask[],
  failureContext: string,
  agent: Agent,
): Promise<SubTask[]> {
  if (decomposition.length === 0) return [];

  const subtaskList = decomposition
    .map((s) => `- ${s.name}: ${s.successCriteria}`)
    .join("\n");

  const prompt = `These acceptance criteria failed:
${failing.map((c) => `- ${c}`).join("\n")}

Failure context:
${failureContext}

Available sub-tasks:
${subtaskList}

Which sub-tasks most likely caused these failures? List sub-task names only, one per line. Use exact names from the list above.`;

  const response = await agent.run(prompt);

  const responseLines = response.split("\n").map((l) => l.replace(/^[-*•]\s*/, "").trim());
  const matched = decomposition.filter((s) =>
    responseLines.some(
      (line) => line.toLowerCase().includes(s.name.toLowerCase()) ||
                s.name.toLowerCase().includes(line.toLowerCase()),
    ),
  );

  // Safe default: if nothing matched, retry all sub-tasks
  return matched.length > 0 ? matched : decomposition;
}

/**
 * Run a shell command, capturing stdout + stderr.
 * NEVER throws on non-zero exit — non-zero exit = test failures = valid output.
 * On timeout, returns a timeout message + any partial output captured.
 */
export async function runCommand(cmd: string, timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve) => {
    const chunks: string[] = [];
    const child = execFile(cmd, {
      shell: true,
      timeout: timeoutMs,
      cwd: process.cwd(),
    });

    child.stdout?.on("data", (d: Buffer | string) => chunks.push(String(d)));
    child.stderr?.on("data", (d: Buffer | string) => chunks.push(String(d)));

    child.on("close", (_code, signal) => {
      const output = chunks.join("");
      if (signal === "SIGTERM") {
        resolve(`EVAL TIMEOUT after ${timeoutMs / 1000}s\n${output}`);
      } else {
        resolve(output);
      }
    });

    child.on("error", (err) => {
      resolve(`EVAL ERROR: ${err.message}\n${chunks.join("")}`);
    });
  });
}

function printCriteriaTable(criteriaResults: Record<string, boolean>): void {
  console.log("\nAcceptance criteria:");
  for (const [criterion, pass] of Object.entries(criteriaResults)) {
    const icon = pass ? "✓" : "✗";
    console.log(`  ${icon} ${criterion}`);
  }
}
