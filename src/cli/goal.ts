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
import { RateLimitError } from "../core/rate-limit-error.js";
import { loadLearnings, formatLearningsForPrompt } from "../core/memory.js";
import { parseSpec, type Spec, type SubTask } from "../core/spec-parser.js";
import { computeSpecHash, readState, writeState, clearState, type GoalState, type LevelWorkerState } from "../core/state.js";
import { RunLogger } from "../core/run-logger.js";
import { sendNotification, buildNotifyPayload, type NotifyOptions } from "../core/notify.js";
import { loadAllSkills } from "../skills/index.js";
import { substituteInputs, stripAskTokens } from "../skills/template.js";
import { buildDependencyGraph, formatExecutionLevels } from "../goal/dependency-graph.js";
import { executeParallel, type ParallelResult } from "../goal/parallel-executor.js";
import { replanFailingSubtasks } from "../goal/replan.js";
import { cleanAllWorktrees, getHeadSha, getDiff } from "../goal/merge-strategy.js";
import { judgeRun } from "../eval/judge.js";

/** Cap on bytes stored for failureContext per sub-task. */
const FAILURE_CONTEXT_MAX_BYTES = 4096;

/**
 * Print a rate-limit pause message and exit 2.
 * exit 2 = "paused, not failure" — machine-readable for CI/orchestrators.
 * The caller already wrote state to disk before this is invoked.
 */
function handleRateLimitExit(err: RateLimitError, specFile: string, completedCount: number, totalCount: number): never {
  console.log();
  console.log(`⏸  Rate limited (${err.providerName ?? "provider"}) after completing ${completedCount}/${totalCount} sub-tasks.`);
  console.log("   Progress checkpointed.");
  if (err.retryAfter !== undefined) {
    console.log(`   Rate limit resets in ~${err.retryAfter}s.`);
  }
  console.log();
  console.log(`   Resume with:          phase2s goal ${specFile} --resume`);
  console.log(`   Switch provider:      phase2s goal ${specFile} --resume --provider anthropic`);
  process.exit(2);
}

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
  // -- Parallel execution options --
  /** Enable parallel execution. Auto-detected when 3+ independent subtasks. */
  parallel?: boolean;
  /** Force sequential execution (overrides auto-detect). */
  sequential?: boolean;
  /** Enable multi-agent orchestrator mode (role-aware, context-passing). */
  orchestrator?: boolean;
  /** Max concurrent workers per level (1-8, default 3). */
  workers?: number;
  /** Enable tmux dashboard for visual progress. */
  dashboard?: boolean;
  /** Remove stale worktrees before starting. */
  clean?: boolean;
  /** Run spec eval judge after the run and emit eval_judged to the log. */
  judge?: boolean;
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

  // Capture HEAD SHA before any agent execution — used for --judge diff boundary
  const cwd = process.cwd();
  const baseRef = options.judge ? getHeadSha(cwd) : "";

  const startMs = Date.now();

  // -------------------------------------------------------------------------
  // Parallel detection: analyze dependencies to determine execution mode.
  // -------------------------------------------------------------------------
  const depResult = spec.decomposition.length >= 2
    ? buildDependencyGraph(spec.decomposition)
    : null;

  const independentCount = depResult
    ? depResult.levels.filter(l => l.subtaskIndices.length > 1).reduce((sum, l) => sum + l.subtaskIndices.length, 0)
    : 0;

  // Auto-detect: parallel when 3+ independent subtasks, unless --sequential
  const useParallel = options.sequential
    ? false
    : options.parallel
      ? true
      : (independentCount >= 3 && !depResult?.hasCycles);

  const maxWorkers = Math.max(1, Math.min(8, options.workers ?? 3));

  // Clean stale worktrees if requested
  if (options.clean) {
    cleanAllWorktrees(process.cwd());
  }

  // Dry-run: print the decomposition tree and exit immediately — zero LLM calls,
  // zero file handles opened. Must be before RunLogger construction.
  if (options.dryRun) {
    printDryRunTree(spec);
    // If parallel, also show the dependency graph visualization
    if (depResult && useParallel) {
      console.log("\n" + formatExecutionLevels(depResult, spec.decomposition));
    } else if (depResult) {
      console.log("\nParallel analysis: " + (depResult.hasCycles
        ? "cycles detected, would run sequentially"
        : `${independentCount} independent subtask${independentCount !== 1 ? "s" : ""} (need 3+ for auto-parallel)`));
    }
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
    parallel: useParallel,
    levels: depResult?.levels.length,
  });

  console.log(`\nGoal executor: ${spec.title}`);
  console.log(`Eval command: ${spec.evalCommand}`);
  console.log(`Sub-tasks: ${spec.decomposition.length}`);
  console.log(`Acceptance criteria: ${spec.acceptanceCriteria.length}`);
  console.log(`Max attempts: ${maxAttempts}`);
  if (useParallel && depResult) {
    console.log(chalk.cyan(`Mode: parallel (${depResult.levels.length} levels, max ${maxWorkers} workers)`));
  }
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
  // ORCHESTRATOR execution path
  // -------------------------------------------------------------------------
  const hasRoleAnnotations = spec.decomposition.some(t => t.role !== undefined);
  const useOrchestrator = !options.sequential && (options.orchestrator || hasRoleAnnotations);

  if (useOrchestrator) {
    if (hasRoleAnnotations && !options.orchestrator) {
      console.log(chalk.cyan(`Orchestrator mode activated: ${spec.decomposition.filter(t => t.role !== undefined).length} subtasks have role annotations. Use --sequential to disable.`));
    }

    try {
      const { compile } = await import('../orchestrator/spec-compiler.js');
      const { runOrchestrator } = await import('../orchestrator/orchestrator.js');
      const { executeOrchestratorLevel } = await import('../goal/parallel-executor.js');

      const { jobs, levels } = compile(spec.decomposition);

      console.log(chalk.cyan(`\nStarting orchestrator execution (${jobs.length} jobs, ${levels.length} levels)...`));

      const orchResult = await runOrchestrator(levels, jobs, {
        specHash,
        logger,
        executeLevelFn: executeOrchestratorLevel,
      });

      logger.log({
        event: 'goal_completed',
        success: orchResult.totalFailed === 0 && orchResult.totalSkipped === 0,
        attempts: 1,
      });

      const orchSuccess = orchResult.totalFailed === 0 && orchResult.totalSkipped === 0;

      if (orchSuccess) {
        console.log(chalk.green(`\nOrchestrator: all ${orchResult.totalCompleted} jobs completed.`));
      } else {
        console.log(chalk.red(`\nOrchestrator: ${orchResult.totalFailed} failed, ${orchResult.totalSkipped} skipped, ${orchResult.totalCompleted} completed.`));
      }

      const orchGoalResult: GoalResult = {
        success: orchSuccess,
        attempts: 1,
        criteriaResults: {},
        runLogPath: logger.close(),
        summary: orchSuccess
          ? `Orchestrator completed: ${orchResult.totalCompleted} jobs.`
          : `Orchestrator: ${orchResult.totalFailed} failed, ${orchResult.totalSkipped} skipped.`,
        durationMs: Date.now() - startMs,
      };

      await maybeNotify(options, config, orchGoalResult, basename(specPath));
      return orchGoalResult;
    } catch (err: unknown) {
      if (err instanceof RateLimitError) {
        const completedCount = Object.values(state.subTaskResults).filter((r) => r.status === "passed").length;
        handleRateLimitExit(err, basename(specPath), completedCount, spec.decomposition.length);
      }
      const message = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`\nOrchestrator error: ${message}`));
      logger.log({ event: 'goal_error', message });

      const orchErrResult: GoalResult = {
        success: false,
        attempts: 1,
        criteriaResults: {},
        runLogPath: logger.close(),
        summary: `Orchestrator failed: ${message}`,
        durationMs: Date.now() - startMs,
      };
      await maybeNotify(options, config, orchErrResult, basename(specPath));
      return orchErrResult;
    }
  }

  // -------------------------------------------------------------------------
  // PARALLEL execution path (with replan retry loop)
  // -------------------------------------------------------------------------
  if (useParallel && depResult) {
    console.log(chalk.cyan("\nStarting parallel execution..."));

    // Mark state as parallel
    state.parallel = true;
    state.completedLevels = state.completedLevels ?? [];
    writeState(specDir, specHash, state);

    // Retry loop — up to maxAttempts total (first run is attempt 1).
    // On failure, the replan agent produces revised sub-task descriptions grounded
    // in what actually failed. Only failing sub-tasks are re-executed on retry.
    let parallelCriteriaResults: Record<string, boolean> = {};
    let parallelFailing: string[] = [];
    let lastParallelResult: ParallelResult | null = null;
    let parallelSuccess = false;
    let lastEvalOutput = "";
    let lastAttempt = 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      lastAttempt = attempt;

      // On retry attempts: build revisedSubtasks + subsetToRun from the replan agent
      let revisedSubtasks: Record<string, string> | undefined;
      let subsetToRun: Set<string> | undefined;

      if (attempt > 1 && parallelFailing.length > 0) {
        // Reset completedLevels so executeParallel doesn't skip all levels on retry
        state.completedLevels = [];
        writeState(specDir, specHash, state);

        const evalOutputForReplan = lastEvalOutput;
        const revised = await replanFailingSubtasks(
          parallelFailing,
          evalOutputForReplan,
          spec.decomposition,
          config,
        );
        if (revised.length > 0) {
          revisedSubtasks = Object.fromEntries(revised.map((r) => [r.name, r.description]));
          subsetToRun = new Set(revised.map((r) => r.name));
        }
        // If revised is empty (parse failure or no revisions), retry with
        // original descriptions but still limit to failing sub-tasks by name.
        if (!subsetToRun) {
          subsetToRun = new Set(
            spec.decomposition
              .filter((s) => parallelFailing.some((f) => f.toLowerCase().includes(s.name.toLowerCase())))
              .map((s) => s.name),
          );
          // If attribution is ambiguous, run all sub-tasks (subsetToRun stays undefined)
          if (subsetToRun.size === 0) subsetToRun = undefined;
        }
      }

      if (attempt > 1) {
        console.log(chalk.cyan(`\nRetrying parallel execution (attempt ${attempt}/${maxAttempts})...`));
      }

      try {
        lastParallelResult = await executeParallel(depResult, {
          maxWorkers,
          dashboard: !!options.dashboard,
          spec,
          specDir,
          specHash,
          state,
          logger,
          attempt,
          satoriRetries,
          satoriModel,
          revisedSubtasks,
          subsetToRun,
        });
      } catch (err: unknown) {
        if (err instanceof RateLimitError) {
          const completedCount = Object.values(state.subTaskResults).filter((r) => r.status === "passed").length;
          handleRateLimitExit(err, basename(specPath), completedCount, spec.decomposition.length);
        }
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`\nParallel execution error: ${message}`));
        logger.log({ event: "goal_error", message });

        const result: GoalResult = {
          success: false,
          attempts: attempt,
          criteriaResults: {},
          runLogPath: logger.close(),
          summary: `Parallel execution failed: ${message}`,
          durationMs: Date.now() - startMs,
        };
        await maybeNotify(options, config, result, basename(specPath));
        return result;
      }

      // Run eval command after each parallel attempt
      console.log(chalk.cyan("\nRunning evaluation..."));
      logger.log({ event: "eval_started", command: spec.evalCommand });
      const evalOutput = await runCommand(spec.evalCommand);
      lastEvalOutput = evalOutput;
      logger.log({ event: "eval_completed", output: evalOutput.slice(0, FAILURE_CONTEXT_MAX_BYTES) });

      // Abort early on eval infrastructure errors — these are not fixable by replanning.
      // "EVAL ERROR:" = subprocess spawn failure; "EVAL TIMEOUT" = command took too long.
      if (evalOutput.startsWith("EVAL ERROR:") || evalOutput.startsWith("EVAL TIMEOUT")) {
        console.error(chalk.red(`\nEval infrastructure error (not retrying): ${evalOutput.slice(0, 200)}`));
        logger.log({ event: "eval_infra_error", output: evalOutput.slice(0, FAILURE_CONTEXT_MAX_BYTES) });
        break;
      }

      // Check criteria
      const evalAgent = new Agent({ config, learnings: learningsStr });
      parallelCriteriaResults = await checkCriteria(spec.acceptanceCriteria, evalOutput, evalAgent);
      parallelFailing = Object.entries(parallelCriteriaResults).filter(([, v]) => !v).map(([k]) => k);

      logger.log({ event: "criteria_checked", results: parallelCriteriaResults, failing: parallelFailing });

      parallelSuccess = parallelFailing.length === 0;

      if (parallelSuccess) break; // All criteria passed — no more retries needed
    }

    // Final result after all attempts
    logger.log({
      event: "goal_completed",
      success: parallelSuccess,
      attempts: lastAttempt,
      parallel: true,
      wallClockMs: lastParallelResult?.totalDurationMs ?? 0,
      sequentialEstimateMs: lastParallelResult?.sequentialEstimateMs ?? 0,
    });

    if (parallelSuccess) {
      console.log(chalk.green("\nAll acceptance criteria passed."));
    } else {
      console.log(chalk.red(`\n${parallelFailing.length} acceptance criteria failed:`));
      for (const f of parallelFailing) console.log(chalk.red(`  - ${f}`));
    }

    const savings = (lastParallelResult?.sequentialEstimateMs ?? 0) > 0
      ? Math.round((1 - (lastParallelResult?.totalDurationMs ?? 0) / (lastParallelResult?.sequentialEstimateMs ?? 1)) * 100)
      : 0;
    if (lastParallelResult) {
      console.log(chalk.cyan(`\nParallel execution: ${(lastParallelResult.totalDurationMs / 1000).toFixed(1)}s wall clock`));
      if (savings > 0) {
        console.log(chalk.cyan(`Sequential estimate: ${(lastParallelResult.sequentialEstimateMs / 1000).toFixed(1)}s (~${savings}% faster)`));
      }
    }

    // Opt-in spec eval judge
    await maybeJudge(options, specPath, baseRef, cwd, config, specHash, logger);

    const parallelLevels = lastParallelResult?.levels.length ?? 0;
    const result: GoalResult = {
      success: parallelSuccess,
      attempts: lastAttempt,
      criteriaResults: parallelCriteriaResults,
      runLogPath: logger.close(),
      summary: parallelSuccess
        ? `All criteria passed (parallel, ${parallelLevels} levels, ${savings}% faster).`
        : `${parallelFailing.length} criteria failed after ${lastAttempt} parallel attempt${lastAttempt > 1 ? "s" : ""}.`,
      durationMs: Date.now() - startMs,
    };

    await maybeNotify(options, config, result, basename(specPath));
    return result;
  }

  // -------------------------------------------------------------------------
  // SEQUENTIAL execution loop (original behavior)
  // -------------------------------------------------------------------------
  const agent = new Agent({ config, learnings: learningsStr });

  let attempt = state.attempt;
  let subtasksToRun = spec.decomposition;
  let previousFailureContext: string | undefined;
  let criteriaResults: Record<string, boolean> = {};

  try {
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
        // Rate limit is not a failure — propagate so the outer try/catch can
        // checkpoint and exit 2. But first, write the in-flight sub-task as
        // "failed" so --resume has its partial failure context and attempt count.
        // (Previously-completed sub-tasks are already in state; this covers
        // the current one that was interrupted mid-run.)
        if (satoriError instanceof RateLimitError) {
          state.subTaskResults[indexKey] = {
            status: "failed",
            failureContext: truncated,
            attempts: (priorResult?.attempts ?? 0) + 1,
          };
          state.lastUpdatedAt = new Date().toISOString();
          writeState(specDir, specHash, state);
          throw satoriError;
        }
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
      // Opt-in spec eval judge
      await maybeJudge(options, specPath, baseRef, cwd, config, specHash, logger);
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
  } catch (err) {
    if (err instanceof RateLimitError) {
      const completedCount = Object.values(state.subTaskResults).filter((r) => r.status === "passed").length;
      handleRateLimitExit(err, basename(specPath), completedCount, spec.decomposition.length);
    }
    throw err;
  }

  console.log(`\n✗ Goal not achieved after ${maxAttempts} attempts.`);
  console.log("Failing criteria:");
  const failingFinal = Object.entries(criteriaResults).filter(([, pass]) => !pass).map(([c]) => c);
  for (const criterion of failingFinal) {
    console.log(`  ✗ ${criterion}`);
  }
  logger.log({ event: "goal_completed", success: false, attempts: maxAttempts });
  // Opt-in spec eval judge (even on failure — shows partial coverage)
  await maybeJudge(options, specPath, baseRef, cwd, config, specHash, logger);
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
// Judge helper
// ---------------------------------------------------------------------------

/**
 * Run the spec eval judge (--judge flag). Emits eval_judged to the logger.
 * Never throws — judge errors are swallowed to avoid failing a successful goal run.
 */
async function maybeJudge(
  options: GoalOptions,
  specPath: string,
  baseRef: string,
  cwd: string,
  config: import("../core/config.js").Config,
  specHash: string,
  logger: RunLogger,
): Promise<void> {
  if (!options.judge) return;
  try {
    const diff = getDiff(baseRef, "HEAD", cwd);
    const result = await judgeRun(specPath, diff, config);
    logger.log({
      event: "eval_judged",
      runId: specHash,
      ts: new Date().toISOString(),
      score: result.score,
      verdict: result.verdict,
      criteria: result.criteria,
      diffStats: result.diffStats,
    });
    if (result.score !== null) {
      console.log(chalk.cyan(`\nJudge score: ${result.score}/10 — ${result.verdict}`));
    } else {
      console.log(chalk.dim(`\nJudge: ${result.verdict}`));
    }
  } catch {
    // Never surface judge errors to the caller
  }
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
        telegram: config.notify?.telegram,
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
    if (process.env.PHASE2S_DOOM_LOOP_REFLECTION === "off") {
      // Escape hatch: revert to the original one-liner if the reflection protocol
      // causes LLM regression (more refusals, longer outputs with no improvement).
      context += `\n\n## Previous failure\n${failureContext}\n\nFix this specifically. Do not repeat the same approach.`;
    } else {
      context += `

## Previous failure
${failureContext}

## Reflection protocol
Before attempting this task again, stop and answer these three questions:
1. Why exactly did the previous approach fail? (Be specific — what line, what assumption, what edge case?)
2. What was wrong in your reasoning that led to that approach?
3. What is meaningfully DIFFERENT about your new approach? (If it's the same approach with minor tweaks, that will fail again for the same reason.)

If you cannot identify a meaningfully different approach, do NOT retry. Instead, return a clear explanation of what you tried, why it failed, and what additional context or changes to the spec would let you make progress. Getting stuck is acceptable. Repeating the same failure is not.`;
    }
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
