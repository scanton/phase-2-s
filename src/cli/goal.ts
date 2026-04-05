/**
 * Goal executor — "dark factory" mode.
 *
 * Reads a 5-pillar spec file, breaks it into sub-tasks, runs each through
 * /satori (implement + test + retry), checks acceptance criteria against eval
 * output, retries failed sub-tasks with failure context, and loops until all
 * criteria pass or max attempts are exhausted.
 *
 * Usage: phase2s goal <spec-file> [--max-attempts <n>] [--resume] [--review-before-run]
 *
 * With --resume: reads existing state from .phase2s/state/<hash>.json
 * (relative to the spec file directory), skips completed sub-tasks, and
 * injects saved failure context for failed ones. Starts fresh if no state
 * exists.
 *
 * With --review-before-run: runs the spec through adversarial review (fresh
 * Agent instance, adversarial SKILL.md template) before execution begins.
 * Halts and returns challenged: true if verdict is CHALLENGED or
 * NEEDS_CLARIFICATION.
 */

import { execFile } from "child_process";
import { readFileSync } from "fs";
import { resolve, dirname, basename } from "path";
import chalk from "chalk";
import { Agent } from "../core/agent.js";
import { loadConfig } from "../core/config.js";
import { loadLearnings, formatLearningsForPrompt } from "../core/memory.js";
import { parseSpec, type Spec, type SubTask } from "../core/spec-parser.js";
import { computeSpecHash, readState, writeState, clearState, type GoalState } from "../core/state.js";
import { RunLogger } from "../core/run-logger.js";
import { sendNotification, buildNotifyPayload, type NotifyOptions } from "../core/notify.js";
import { loadAllSkills } from "../skills/index.js";
import { substituteInputs, stripAskTokens } from "../skills/template.js";

/** Cap on bytes stored for failureContext per sub-task. */
const FAILURE_CONTEXT_MAX_BYTES = 4096;

export interface GoalOptions {
  maxAttempts?: string;
  resume?: boolean;
  reviewBeforeRun?: boolean;
  /**
   * If true, use notification config from loadConfig().
   * If a NotifyOptions object, override with those settings.
   * Notification is sent after the run completes (success, failure, or challenge).
   */
  notify?: boolean | NotifyOptions;
  /** If true, print the decomposition tree and exit without making any LLM calls. */
  dryRun?: boolean;
}

export interface GoalResult {
  success: boolean;
  attempts: number;
  criteriaResults: Record<string, boolean>;
  /** Absolute path to the structured JSONL run log. */
  runLogPath: string;
  /** One-liner summary for MCP response text. */
  summary: string;
  /** Total wall-clock duration of the run in milliseconds. */
  durationMs: number;
  /** true if pre-execution adversarial review halted the run. */
  challenged?: boolean;
  /** Full adversarial review text when challenged is true. */
  challengeResponse?: string;
  /** true if this was a dry run — no LLM calls were made. */
  dryRun?: boolean;
}

export async function runGoal(specFile: string, options: GoalOptions = {}): Promise<GoalResult> {
  const specPath = resolve(process.cwd(), specFile);
  // State and run logs are stored relative to the spec file directory, not
  // invocation cwd. This keeps logs next to the spec regardless of where
  // `phase2s goal` is invoked from.
  const specDir = dirname(specPath);

  let markdown: string;
  try {
    markdown = readFileSync(specPath, "utf8");
  } catch {
    throw new Error(`Cannot read spec file: ${specPath}`);
  }

  const specHash = computeSpecHash(markdown);
  const spec = parseSpec(markdown);
  const maxAttempts = Math.max(1, parseInt(options.maxAttempts ?? "3", 10) || 3);
  const resume = !!options.resume;

  const startMs = Date.now();

  // Dry-run: print the decomposition tree and exit immediately — zero LLM calls,
  // zero file handles opened. Must be before RunLogger construction.
  if (options.dryRun) {
    printDryRunTree(spec);
    return {
      success: true,
      attempts: 0,
      criteriaResults: {},
      runLogPath: "",
      summary: "Dry run — no LLM calls made.",
      durationMs: Date.now() - startMs,
      dryRun: true,
    };
  }

  // Initialise RunLogger now so we can capture the path even if we halt early.
  const logger = new RunLogger(specDir, specHash);

  // Load config early so it's available for all return paths (including early exits).
  const config = await loadConfig();

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

  logger.log({
    event: "goal_started",
    specFile: basename(specPath),
    specHash,
    subTaskCount: spec.decomposition.length,
    maxAttempts,
    resuming: resume,
  });

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
    logger.log({ event: "goal_completed", success: true, attempts: 0 });
    const result: GoalResult = {
      success: true,
      attempts: 0,
      criteriaResults: {},
      runLogPath: logger.close(),
      summary: "Spec has no sub-tasks and no acceptance criteria.",
      durationMs: Date.now() - startMs,
    };
    await maybeNotify(options, config, result, basename(specPath));
    return result;
  }

  // Warn on large specs
  if (spec.decomposition.length * maxAttempts > 15) {
    console.warn(
      `\nWarning: Large spec with deep retry depth (${spec.decomposition.length} sub-tasks × ${maxAttempts} attempts). ` +
      "This may take a while and consume significant ChatGPT usage.",
    );
  }

  // Set up agent
  const learningsList = await loadLearnings(process.cwd());
  const learningsStr = formatLearningsForPrompt(learningsList);

  // Load skills to get satori + adversarial templates and settings
  const skills = await loadAllSkills();
  const satoriSkill = skills.find((s) => s.name === "satori");
  const adversarialSkill = skills.find((s) => s.name === "adversarial");
  const satoriRetries = satoriSkill?.retries ?? 3;
  const satoriModel = satoriSkill?.model;
  const adversarialModel = adversarialSkill?.model;

  // Build the satori base prompt from its template (same as what the REPL does)
  const satoriTemplate = satoriSkill
    ? stripAskTokens(substituteInputs(satoriSkill.promptTemplate, {}, satoriSkill.inputs)).result
    : "";

  // -------------------------------------------------------------------------
  // Pre-execution adversarial review (optional, uses fresh Agent to avoid
  // contaminating the implementation agent's conversation history).
  // -------------------------------------------------------------------------
  if (options.reviewBeforeRun) {
    logger.log({ event: "plan_review_started" });

    const adversarialTemplate = adversarialSkill?.promptTemplate ?? "";
    const reviewPrompt = buildAdversarialPrompt(spec, adversarialTemplate);
    const reviewAgent = new Agent({ config, learnings: learningsStr });
    const response = await reviewAgent.run(reviewPrompt, { modelOverride: adversarialModel });

    const verdict = response.includes("VERDICT: CHALLENGED")
      ? "CHALLENGED"
      : response.includes("NEEDS_CLARIFICATION")
        ? "NEEDS_CLARIFICATION"
        : "APPROVED";

    logger.log({ event: "plan_review_completed", verdict, response });

    if (verdict !== "APPROVED") {
      console.log(`\nSpec ${verdict} before execution. Adversarial review response:\n`);
      console.log(response);
      const result: GoalResult = {
        success: false,
        attempts: 0,
        criteriaResults: {},
        runLogPath: logger.close(),
        summary: `Spec ${verdict} before execution.`,
        durationMs: Date.now() - startMs,
        challenged: true,
        challengeResponse: response,
      };
      await maybeNotify(options, config, result, basename(specPath));
      return result;
    }

    console.log("\nAdversarial review: APPROVED. Proceeding with execution.");
  }

  // -------------------------------------------------------------------------
  // Main execution loop
  // -------------------------------------------------------------------------
  const agent = new Agent({ config, learnings: learningsStr });

  let attempt = state.attempt;
  let subtasksToRun = spec.decomposition;
  let previousFailureContext: string | undefined;
  let criteriaResults: Record<string, boolean> = {};

  while (attempt < maxAttempts) {
    attempt++;
    state.attempt = attempt;
    logger.log({ event: "attempt_started", attempt });
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
        console.log(chalk.dim(`\n[skip] ${subtask.name} (passed in a prior attempt)`));
        continue;
      }

      // Inject prior failure context if this sub-task failed before.
      const priorFailureContext = priorResult?.status === "failed"
        ? priorResult.failureContext
        : previousFailureContext;

      const numericIndex = globalIndex >= 0 ? globalIndex : i;
      logger.log({ event: "subtask_started", attempt, index: numericIndex, name: subtask.name });

      // isRetry: on attempt 2+, subtasksToRun is already filtered to only failed tasks
      const isRetry = attempt > 1;
      const subtaskLabel = isRetry
        ? chalk.yellow(`[${i + 1}/${subtasksToRun.length}] Retrying:`)
        : chalk.cyan(`[${i + 1}/${subtasksToRun.length}] Running:`);
      console.log(`\n${subtaskLabel} ${subtask.name}`);
      const subtaskStartMs = Date.now();
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
      const elapsedSec = ((Date.now() - subtaskStartMs) / 1000).toFixed(1);
      console.log(chalk.dim(`  Done in ${elapsedSec}s`));

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
        logger.log({ event: "subtask_completed", attempt, index: numericIndex, status: "failed", failureContext: truncated });
        console.error(`\nSub-task failed: ${subtask.name}`);
      } else {
        // Sub-task completed without throwing — mark as passed, write checkpoint.
        state.subTaskResults[indexKey] = {
          status: "passed",
          completedAt: new Date().toISOString(),
        };
        state.lastUpdatedAt = new Date().toISOString();
        writeState(specDir, specHash, state);
        logger.log({ event: "subtask_completed", attempt, index: numericIndex, status: "passed" });
      }
    }

    // Run evaluation
    console.log(`\nRunning evaluation: ${spec.evalCommand}`);
    logger.log({ event: "eval_started", command: spec.evalCommand });
    const evalOutput = await runCommand(spec.evalCommand);
    console.log(evalOutput.slice(0, 1000) + (evalOutput.length > 1000 ? "\n[...truncated...]" : ""));
    // Store first 2000 chars in log (enough for diagnostics, not overwhelming)
    logger.log({ event: "eval_completed", output: evalOutput.slice(0, 2000) });

    // If no acceptance criteria, report raw output and exit
    if (spec.acceptanceCriteria.length === 0) {
      console.log("\nNo acceptance criteria defined. Eval output shown above.");
      logger.log({ event: "goal_completed", success: true, attempts: attempt });
      const result: GoalResult = {
        success: true,
        attempts: attempt,
        criteriaResults: {},
        runLogPath: logger.close(),
        summary: `Goal completed successfully after ${attempt} attempt(s).`,
        durationMs: Date.now() - startMs,
      };
      await maybeNotify(options, config, result, basename(specPath));
      return result;
    }

    // Check acceptance criteria
    criteriaResults = await checkCriteria(spec.acceptanceCriteria, evalOutput, agent);
    printCriteriaTable(criteriaResults);

    const failing = Object.entries(criteriaResults).filter(([, pass]) => !pass).map(([c]) => c);
    logger.log({ event: "criteria_checked", results: criteriaResults, failing });

    if (failing.length === 0) {
      console.log(`\n✓ All acceptance criteria met after ${attempt} attempt(s).`);
      // Clean completion: remove state so stale state doesn't block future runs.
      clearState(specDir, specHash);
      logger.log({ event: "goal_completed", success: true, attempts: attempt });
      const result: GoalResult = {
        success: true,
        attempts: attempt,
        criteriaResults,
        runLogPath: logger.close(),
        summary: `All criteria passed after ${attempt} attempt(s).`,
        durationMs: Date.now() - startMs,
      };
      await maybeNotify(options, config, result, basename(specPath));
      return result;
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
  const failingFinal = Object.entries(criteriaResults).filter(([, pass]) => !pass).map(([c]) => c);
  for (const criterion of failingFinal) {
    console.log(`  ✗ ${criterion}`);
  }
  logger.log({ event: "goal_completed", success: false, attempts: maxAttempts });
  const failResult: GoalResult = {
    success: false,
    attempts: maxAttempts,
    criteriaResults,
    runLogPath: logger.close(),
    summary: `Goal failed after ${maxAttempts} attempts. ${failingFinal.length} criteria not met.`,
    durationMs: Date.now() - startMs,
  };
  await maybeNotify(options, config, failResult, basename(specPath));
  return failResult;
}

// ---------------------------------------------------------------------------
// Notification helper
// ---------------------------------------------------------------------------

/**
 * Send a post-run notification if the caller requested one.
 * Errors are swallowed — notification failures never surface to the user.
 */
async function maybeNotify(
  options: GoalOptions,
  config: import("../core/config.js").Config,
  result: GoalResult,
  specFile: string,
): Promise<void> {
  if (!options.notify) return;

  const notifyOptions: NotifyOptions = typeof options.notify === "object"
    ? options.notify
    : {
        mac: config.notify?.mac,
        slack: config.notify?.slack,
        discord: config.notify?.discord,
        teams: config.notify?.teams,
      };

  const payload = buildNotifyPayload(
    specFile,
    result.success,
    result.attempts,
    result.challenged ?? false,
    result.durationMs,
  );

  try {
    await sendNotification(payload, notifyOptions);
  } catch (err) {
    console.error(`[phase2s notify] Notification failed: ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// buildAdversarialPrompt
// ---------------------------------------------------------------------------

/**
 * Build a pre-execution adversarial review prompt.
 *
 * Injects the spec's decomposition and acceptance criteria as the "plan" to
 * challenge, then appends the adversarial SKILL.md template which instructs
 * the model to review what came before it and emit a structured verdict.
 */
export function buildAdversarialPrompt(spec: Spec, adversarialTemplate: string): string {
  const decompositionLines = spec.decomposition
    .map((t, i) => `${i + 1}. **${t.name}**: ${t.successCriteria}`)
    .join("\n");

  const criteriaLines = spec.acceptanceCriteria
    .map((c, i) => `${i + 1}. ${c}`)
    .join("\n");

  const plan = [
    `## Spec: ${spec.title}`,
    "",
    "### Problem",
    spec.problemStatement,
    "",
    "### Sub-task decomposition",
    decompositionLines || "(none)",
    "",
    "### Acceptance criteria",
    criteriaLines || "(none)",
  ].join("\n");

  return adversarialTemplate
    ? `${plan}\n\n${adversarialTemplate}`
    : plan;
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

function printDryRunTree(spec: Spec): void {
  console.log(chalk.bold(`\nSpec: ${spec.title}`));
  console.log(chalk.dim(`Eval: ${spec.evalCommand}`));
  console.log("");

  console.log(chalk.bold(`Sub-tasks (${spec.decomposition.length}):`));
  for (let i = 0; i < spec.decomposition.length; i++) {
    const st = spec.decomposition[i];
    console.log(`  ${chalk.cyan(`${i + 1}.`)} ${st.name}`);
    if (st.input) console.log(chalk.dim(`     Input:  ${st.input}`));
    if (st.output) console.log(chalk.dim(`     Output: ${st.output}`));
    if (st.successCriteria) console.log(chalk.dim(`     When:   ${st.successCriteria}`));
  }

  if (spec.acceptanceCriteria.length > 0) {
    console.log("");
    console.log(chalk.bold(`Acceptance Criteria (${spec.acceptanceCriteria.length}):`));
    for (const c of spec.acceptanceCriteria) {
      console.log(`  · ${c}`);
    }
  }

  if (spec.constraints) {
    const { mustDo, cannotDo, shouldPrefer } = spec.constraints;
    if (mustDo.length > 0 || cannotDo.length > 0 || shouldPrefer.length > 0) {
      console.log("");
      console.log(chalk.bold("Constraints:"));
      if (mustDo.length > 0) console.log(chalk.dim(`  Must Do: ${mustDo.join("; ")}`));
      if (cannotDo.length > 0) console.log(chalk.dim(`  Cannot Do: ${cannotDo.join("; ")}`));
      if (shouldPrefer.length > 0) console.log(chalk.dim(`  Prefer: ${shouldPrefer.join("; ")}`));
    }
  }

  console.log("");
}

function printCriteriaTable(criteriaResults: Record<string, boolean>): void {
  console.log("\nAcceptance criteria:");
  for (const [criterion, pass] of Object.entries(criteriaResults)) {
    const icon = pass ? "✓" : "✗";
    console.log(`  ${icon} ${criterion}`);
  }
}
