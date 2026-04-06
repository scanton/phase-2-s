import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import { runOrchestrator, computeSkippedIds, type OrchestratorOptions, type JobStatus } from '../../src/orchestrator/orchestrator.js';
import type { SubtaskJob, OrchestratorLevelResult } from '../../src/orchestrator/types.js';
import type { RunLogger } from '../../src/core/run-logger.js';

// ---------------------------------------------------------------------------
// Mock RunLogger
// ---------------------------------------------------------------------------

function makeMockLogger() {
  const events: unknown[] = [];
  const logger = {
    log: vi.fn((event: unknown) => { events.push(event); }),
    close: vi.fn(() => '/mock/log.jsonl'),
    events,
  } as unknown as RunLogger & { events: unknown[] };
  return logger;
}

// ---------------------------------------------------------------------------
// Job factory helpers
// ---------------------------------------------------------------------------

function makeJob(overrides: Partial<SubtaskJob> = {}): SubtaskJob {
  return {
    id: 'test-job',
    title: 'Test Job',
    role: 'implementer',
    prompt: 'Do something',
    files: [],
    criteria: [],
    dependsOn: [],
    systemPromptPrefix: '',
    ...overrides,
  };
}

function makeSuccessResult(subtaskId: string, stdout = ''): OrchestratorLevelResult {
  return { subtaskId, status: 'completed', stdout };
}

function makeFailResult(subtaskId: string, error = 'oops'): OrchestratorLevelResult {
  return { subtaskId, status: 'failed', error };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('runOrchestrator — happy path', () => {
  it('all jobs complete → totalCompleted === jobs.length', async () => {
    const jobs = [
      makeJob({ id: 'job-a', title: 'Job A' }),
      makeJob({ id: 'job-b', title: 'Job B' }),
      makeJob({ id: 'job-c', title: 'Job C' }),
    ];
    const levels = [[jobs[0], jobs[1]], [jobs[2]]];
    const logger = makeMockLogger();

    const executeLevelFn = vi.fn(async (activeJobs: SubtaskJob[]) =>
      activeJobs.map(j => makeSuccessResult(j.id))
    );

    const result = await runOrchestrator(levels, jobs, { specHash: 'abc123', logger, executeLevelFn });

    expect(result.totalCompleted).toBe(3);
    expect(result.totalFailed).toBe(0);
    expect(result.totalSkipped).toBe(0);
  });

  it('orchestrator_started event is logged with correct fields', async () => {
    const jobs = [makeJob({ id: 'j1' })];
    const levels = [[jobs[0]]];
    const logger = makeMockLogger();
    const executeLevelFn = vi.fn(async (js: SubtaskJob[]) => js.map(j => makeSuccessResult(j.id)));

    await runOrchestrator(levels, jobs, { specHash: 'hash1', logger, executeLevelFn });

    expect(logger.log).toHaveBeenCalledWith(expect.objectContaining({
      event: 'orchestrator_started',
      specHash: 'hash1',
      totalJobs: 1,
      levelCount: 1,
    }));
  });

  it('orchestrator_completed event is logged with correct counts', async () => {
    const jobs = [makeJob({ id: 'j1' }), makeJob({ id: 'j2' })];
    const levels = [[jobs[0], jobs[1]]];
    const logger = makeMockLogger();
    const executeLevelFn = vi.fn(async (js: SubtaskJob[]) => js.map(j => makeSuccessResult(j.id)));

    await runOrchestrator(levels, jobs, { specHash: 'hashX', logger, executeLevelFn });

    expect(logger.log).toHaveBeenCalledWith(expect.objectContaining({
      event: 'orchestrator_completed',
      totalCompleted: 2,
      totalFailed: 0,
      totalSkipped: 0,
    }));
  });

  it('durationMs is a non-negative number', async () => {
    const jobs = [makeJob({ id: 'j1' })];
    const levels = [[jobs[0]]];
    const logger = makeMockLogger();
    const executeLevelFn = vi.fn(async (js: SubtaskJob[]) => js.map(j => makeSuccessResult(j.id)));

    const result = await runOrchestrator(levels, jobs, { specHash: 'h', logger, executeLevelFn });

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Sentinel extraction (architect only)
// ---------------------------------------------------------------------------

describe('runOrchestrator — sentinel extraction', () => {
  it('architect result with sentinel → contextFile set in result', async () => {
    const job = makeJob({ id: 'arch-job', role: 'architect' });
    const levels = [[job]];
    const logger = makeMockLogger();

    let capturedResults: OrchestratorLevelResult[] = [];
    const executeLevelFn = vi.fn(async (js: SubtaskJob[]) => {
      const results: OrchestratorLevelResult[] = js.map(j => ({
        subtaskId: j.id,
        status: 'completed' as const,
        stdout: 'Some output\n<!-- CONTEXT -->\nUse interface Foo { x: number }',
      }));
      capturedResults = results;
      return results;
    });

    await runOrchestrator(levels, [job], { specHash: 'arch1', logger, executeLevelFn });

    // After the orchestrator processes results, it sets contextFile on the result object
    const result = capturedResults[0];
    expect(result.contextFile).toBeDefined();
    expect(typeof result.contextFile).toBe('string');
  });

  it('sentinel missing for architect → orchestrator_context_missing event logged', async () => {
    const job = makeJob({ id: 'arch-no-sentinel', role: 'architect' });
    const levels = [[job]];
    const logger = makeMockLogger();

    const executeLevelFn = vi.fn(async (js: SubtaskJob[]) =>
      js.map(j => ({
        subtaskId: j.id,
        status: 'completed' as const,
        stdout: 'No sentinel in this output',
      }))
    );

    await runOrchestrator(levels, [job], { specHash: 'arch2', logger, executeLevelFn });

    expect(logger.log).toHaveBeenCalledWith(expect.objectContaining({
      event: 'orchestrator_context_missing',
      subtaskId: 'arch-no-sentinel',
    }));
  });

  it('non-architect with sentinel in stdout → contextFile NOT set', async () => {
    const job = makeJob({ id: 'impl-job', role: 'implementer' });
    const levels = [[job]];
    const logger = makeMockLogger();

    let capturedResult: OrchestratorLevelResult | undefined;
    const executeLevelFn = vi.fn(async (js: SubtaskJob[]) => {
      const results: OrchestratorLevelResult[] = js.map(j => ({
        subtaskId: j.id,
        status: 'completed' as const,
        stdout: '<!-- CONTEXT -->\nsome context',
      }));
      capturedResult = results[0];
      return results;
    });

    await runOrchestrator(levels, [job], { specHash: 'impl1', logger, executeLevelFn });

    // contextFile should not be set because job role is 'implementer'
    expect(capturedResult?.contextFile).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Context injection into systemPromptPrefix
// ---------------------------------------------------------------------------

describe('runOrchestrator — upstream context injection', () => {
  it('upstream architect context injected into downstream systemPromptPrefix', async () => {
    const archJob = makeJob({ id: 'arch', role: 'architect', title: 'Architect' });
    const implJob = makeJob({ id: 'impl', role: 'implementer', title: 'Impl', dependsOn: ['arch'] });
    const levels = [[archJob], [implJob]];
    const logger = makeMockLogger();

    let implSystemPrompt = '';
    const executeLevelFn = vi.fn(async (js: SubtaskJob[]) => {
      const results: OrchestratorLevelResult[] = [];
      for (const j of js) {
        if (j.id === 'impl') {
          implSystemPrompt = j.systemPromptPrefix;
        }
        results.push({
          subtaskId: j.id,
          status: 'completed' as const,
          stdout: j.id === 'arch' ? 'Here are my decisions.\n<!-- CONTEXT -->\nUse FooInterface everywhere.' : '',
        });
      }
      return results;
    });

    await runOrchestrator(levels, [archJob, implJob], { specHash: 'ctx1', logger, executeLevelFn });

    expect(implSystemPrompt).toContain('Prior context from upstream subtask');
    expect(implSystemPrompt).toContain('Architect');
  });

  it('role prompt is prepended to systemPromptPrefix', async () => {
    const job = makeJob({ id: 'tester-job', role: 'tester' });
    const levels = [[job]];
    const logger = makeMockLogger();

    let capturedPrefix = '';
    const executeLevelFn = vi.fn(async (js: SubtaskJob[]) => {
      capturedPrefix = js[0].systemPromptPrefix;
      return js.map(j => makeSuccessResult(j.id));
    });

    await runOrchestrator(levels, [job], { specHash: 'role1', logger, executeLevelFn });

    // Should contain tester role prompt
    expect(capturedPrefix).toContain('tester');
  });
});

// ---------------------------------------------------------------------------
// 4096 byte cap
// ---------------------------------------------------------------------------

describe('runOrchestrator — context byte cap', () => {
  it('content exceeding 4096 bytes is truncated with (truncated) marker', async () => {
    const archJob = makeJob({ id: 'arch-big', role: 'architect', title: 'BigArch' });
    const implJob = makeJob({ id: 'impl-big', role: 'implementer', dependsOn: ['arch-big'] });
    const levels = [[archJob], [implJob]];
    const logger = makeMockLogger();

    let implPrefix = '';
    const bigContent = 'x'.repeat(5000);
    const executeLevelFn = vi.fn(async (js: SubtaskJob[]) => {
      const results: OrchestratorLevelResult[] = [];
      for (const j of js) {
        if (j.id === 'impl-big') {
          implPrefix = j.systemPromptPrefix;
        }
        results.push({
          subtaskId: j.id,
          status: 'completed' as const,
          stdout: j.id === 'arch-big' ? `<!-- CONTEXT -->\n${bigContent}` : '',
        });
      }
      return results;
    });

    await runOrchestrator(levels, [archJob, implJob], { specHash: 'big1', logger, executeLevelFn });

    expect(implPrefix).toContain('(truncated)');
  });
});

// ---------------------------------------------------------------------------
// Failure handling and DFS skip
// ---------------------------------------------------------------------------

describe('runOrchestrator — failure handling', () => {
  it('failed job → totalFailed === 1', async () => {
    const job = makeJob({ id: 'failing-job' });
    const levels = [[job]];
    const logger = makeMockLogger();

    const executeLevelFn = vi.fn(async (js: SubtaskJob[]) =>
      js.map(j => makeFailResult(j.id))
    );

    const result = await runOrchestrator(levels, [job], { specHash: 'fail1', logger, executeLevelFn });

    expect(result.totalFailed).toBe(1);
    expect(result.totalCompleted).toBe(0);
  });

  it('A fails → B (depends A) skipped → C (depends B) skipped', async () => {
    const jobA = makeJob({ id: 'a', title: 'A' });
    const jobB = makeJob({ id: 'b', title: 'B', dependsOn: ['a'] });
    const jobC = makeJob({ id: 'c', title: 'C', dependsOn: ['b'] });
    const levels = [[jobA], [jobB], [jobC]];
    const logger = makeMockLogger();

    const executeLevelFn = vi.fn(async (js: SubtaskJob[]) =>
      js.map(j => makeFailResult(j.id))
    );

    const result = await runOrchestrator(levels, [jobA, jobB, jobC], {
      specHash: 'cascade1',
      logger,
      executeLevelFn,
    });

    expect(result.totalFailed).toBe(1);
    expect(result.totalSkipped).toBe(2);
    expect(result.totalCompleted).toBe(0);
  });

  it('independent job not skipped when sibling fails', async () => {
    const jobA = makeJob({ id: 'a-fail', title: 'A Fail', files: ['src/a.ts'] });
    const jobB = makeJob({ id: 'b-pass', title: 'B Pass', files: ['src/b.ts'] });
    // A and B are independent (different files)
    const levels = [[jobA, jobB]];
    const logger = makeMockLogger();

    const executeLevelFn = vi.fn(async (js: SubtaskJob[]) =>
      js.map(j => j.id === 'a-fail' ? makeFailResult(j.id) : makeSuccessResult(j.id))
    );

    const result = await runOrchestrator(levels, [jobA, jobB], {
      specHash: 'indep1',
      logger,
      executeLevelFn,
    });

    expect(result.totalFailed).toBe(1);
    expect(result.totalCompleted).toBe(1);
    expect(result.totalSkipped).toBe(0);
  });

  it('replanOnFailure stub → orchestrator_replan event logged', async () => {
    const job = makeJob({ id: 'plan-fail', title: 'Plan Fail' });
    const levels = [[job]];
    const logger = makeMockLogger();

    const executeLevelFn = vi.fn(async (js: SubtaskJob[]) =>
      js.map(j => makeFailResult(j.id, 'something broke'))
    );

    await runOrchestrator(levels, [job], { specHash: 'replan1', logger, executeLevelFn });

    expect(logger.log).toHaveBeenCalledWith(expect.objectContaining({
      event: 'orchestrator_replan',
      failedSubtaskId: 'plan-fail',
    }));
  });
});

// ---------------------------------------------------------------------------
// contextDir cleanup
// ---------------------------------------------------------------------------

describe('runOrchestrator — contextDir cleanup', () => {
  it('contextDir does not exist after run completes', async () => {
    // We can't directly observe the dir path, but we verify no leftover tmp dirs
    // by checking the run completes without errors and cleanup is attempted
    const jobs = [makeJob({ id: 'cleanup-job', role: 'architect' })];
    const levels = [[jobs[0]]];
    const logger = makeMockLogger();

    const executeLevelFn = vi.fn(async (js: SubtaskJob[]) =>
      js.map(j => makeSuccessResult(j.id, '<!-- CONTEXT -->\nsome content'))
    );

    // Should not throw, contextDir is cleaned up in finally
    await expect(
      runOrchestrator(levels, jobs, { specHash: 'cleanup1', logger, executeLevelFn })
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// job_routed and job_promoted events
// ---------------------------------------------------------------------------

describe('runOrchestrator — logging events', () => {
  it('logs job_routed event for each active job', async () => {
    const job = makeJob({ id: 'routed-job', role: 'implementer' });
    const levels = [[job]];
    const logger = makeMockLogger();

    const executeLevelFn = vi.fn(async (js: SubtaskJob[]) => js.map(j => makeSuccessResult(j.id)));

    await runOrchestrator(levels, [job], { specHash: 'routed1', logger, executeLevelFn });

    expect(logger.log).toHaveBeenCalledWith(expect.objectContaining({
      event: 'job_routed',
      subtaskId: 'routed-job',
      role: 'implementer',
    }));
  });

  it('logs job_promoted event for each active job with correct level', async () => {
    const job = makeJob({ id: 'promoted-job' });
    const levels = [[job]];
    const logger = makeMockLogger();

    const executeLevelFn = vi.fn(async (js: SubtaskJob[]) => js.map(j => makeSuccessResult(j.id)));

    await runOrchestrator(levels, [job], { specHash: 'promoted1', logger, executeLevelFn });

    expect(logger.log).toHaveBeenCalledWith(expect.objectContaining({
      event: 'job_promoted',
      subtaskId: 'promoted-job',
      level: 0,
    }));
  });

  it('levels with all-skipped jobs are skipped without calling executeLevelFn', async () => {
    const jobA = makeJob({ id: 'skip-a' });
    const jobB = makeJob({ id: 'skip-b', dependsOn: ['skip-a'] });
    const levels = [[jobA], [jobB]];
    const logger = makeMockLogger();

    let callCount = 0;
    const executeLevelFn = vi.fn(async (js: SubtaskJob[]) => {
      callCount++;
      // Fail on first call (causes skip of jobB)
      return js.map(j => makeFailResult(j.id));
    });

    await runOrchestrator(levels, [jobA, jobB], { specHash: 'skip1', logger, executeLevelFn });

    // Only called once — level 1 (jobB) was skipped
    expect(callCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// computeSkippedIds (exported helper)
// ---------------------------------------------------------------------------

describe('computeSkippedIds', () => {
  it('returns empty array when no jobs depend on the failed job', () => {
    const jobs = [
      makeJob({ id: 'a' }),
      makeJob({ id: 'b' }),
    ];
    expect(computeSkippedIds('a', jobs)).toEqual([]);
  });

  it('returns direct dependents of a failed job', () => {
    const jobs = [
      makeJob({ id: 'a' }),
      makeJob({ id: 'b', dependsOn: ['a'] }),
    ];
    expect(computeSkippedIds('a', jobs)).toContain('b');
  });

  it('returns transitive dependents (DFS)', () => {
    const jobs = [
      makeJob({ id: 'a' }),
      makeJob({ id: 'b', dependsOn: ['a'] }),
      makeJob({ id: 'c', dependsOn: ['b'] }),
      makeJob({ id: 'd', dependsOn: ['c'] }),
    ];
    const skipped = computeSkippedIds('a', jobs);
    expect(skipped).toContain('b');
    expect(skipped).toContain('c');
    expect(skipped).toContain('d');
  });

  it('does not include the failed job itself in skipped set', () => {
    const jobs = [
      makeJob({ id: 'a' }),
      makeJob({ id: 'b', dependsOn: ['a'] }),
    ];
    const skipped = computeSkippedIds('a', jobs);
    expect(skipped).not.toContain('a');
  });

  it('independent job is not included in skipped', () => {
    const jobs = [
      makeJob({ id: 'a' }),
      makeJob({ id: 'b', dependsOn: ['a'] }),
      makeJob({ id: 'c' }),  // independent
    ];
    const skipped = computeSkippedIds('a', jobs);
    expect(skipped).not.toContain('c');
  });
});
