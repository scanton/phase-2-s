/**
 * Sprint 39: replanOnFailure() integration tests via runOrchestrator().
 *
 * replanOnFailure() is not exported — tests drive it through runOrchestrator()
 * by injecting a mock executeLevelFn that fails one job.
 */

import { describe, it, expect, vi } from 'vitest';
import { runOrchestrator } from '../../src/orchestrator/orchestrator.js';
import type { OrchestratorOptions } from '../../src/orchestrator/orchestrator.js';
import type { SubtaskJob, OrchestratorLevelResult } from '../../src/orchestrator/types.js';
import type { RunLogger } from '../../src/core/run-logger.js';
import type { Provider } from '../../src/providers/types.js';
import type { Config } from '../../src/core/config.js';

// ---------------------------------------------------------------------------
// Helpers
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

function makeJob(overrides: Partial<SubtaskJob> = {}): SubtaskJob {
  return {
    id: 'job',
    title: 'Job',
    role: 'implementer',
    prompt: 'Do something',
    files: [],
    criteria: [],
    dependsOn: [],
    systemPromptPrefix: '',
    ...overrides,
  };
}

function makeProvider(responseJson: string): Provider {
  return {
    name: 'mock',
    async *chatStream(_messages, _tools, _opts?) {
      yield { type: 'text', content: responseJson };
      yield { type: 'done', stopReason: 'stop' };
    },
  };
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    provider: 'openai-api',
    model: 'gpt-4o',
    smart_model: 'gpt-4o',
    fast_model: undefined,
    maxTurns: 50,
    ...overrides,
  } as unknown as Config;
}

function makeOptions(
  executeLevelFn: OrchestratorOptions['executeLevelFn'],
  provider?: Provider,
  config?: Config,
): OrchestratorOptions {
  return {
    specHash: 'test-hash',
    logger: makeMockLogger(),
    executeLevelFn,
    provider,
    config,
  };
}

// ---------------------------------------------------------------------------
// Tests: re-plan with no provider (stub fallback)
// ---------------------------------------------------------------------------

describe('replan — no provider (stub fallback)', () => {
  it('options.provider absent → returns remaining unchanged + logs orchestrator_replan_failed', async () => {
    const jobA = makeJob({ id: 'job-a' });
    const jobB = makeJob({ id: 'job-b', dependsOn: [] });
    const jobs = [jobA, jobB];
    const levels = [[jobA], [jobB]];

    const executeLevelFn = vi.fn()
      .mockResolvedValueOnce([{ subtaskId: 'job-a', status: 'failed', error: 'boom' }] as OrchestratorLevelResult[])
      .mockResolvedValueOnce([{ subtaskId: 'job-b', status: 'completed', stdout: '' }] as OrchestratorLevelResult[]);

    const logger = makeMockLogger();
    const opts: OrchestratorOptions = { specHash: 'h', logger, executeLevelFn };

    const result = await runOrchestrator(levels, jobs, opts);
    // job-b still runs (no provider = remaining unchanged, re-leveled with same jobs)
    expect(result.totalFailed).toBe(1);

    const failedEvent = (logger.events as Array<{ event: string }>)
      .find(e => e.event === 'orchestrator_replan_failed');
    expect(failedEvent).toBeDefined();
    expect((failedEvent as { errorMessage: string }).errorMessage).toContain('no provider');
  });
});

// ---------------------------------------------------------------------------
// Tests: delta merge behavior
// ---------------------------------------------------------------------------

describe('replan — delta merge', () => {
  it('empty delta → remaining jobs unchanged', async () => {
    const jobA = makeJob({ id: 'job-a' });
    const jobB = makeJob({ id: 'job-b' });
    const jobs = [jobA, jobB];
    const levels = [[jobA], [jobB]];

    const provider = makeProvider('{"delta":[]}');
    const executeLevelFn = vi.fn()
      .mockResolvedValueOnce([{ subtaskId: 'job-a', status: 'failed', error: 'oops' }] as OrchestratorLevelResult[])
      .mockResolvedValueOnce([{ subtaskId: 'job-b', status: 'completed', stdout: '' }] as OrchestratorLevelResult[]);

    const result = await runOrchestrator(levels, jobs, makeOptions(executeLevelFn, provider, makeConfig()));
    // job-b still runs
    expect(result.totalCompleted).toBe(1);
    expect(result.totalFailed).toBe(1);
  });

  it('revised job — prompt updated by ID', async () => {
    const jobA = makeJob({ id: 'job-a' });
    const jobB = makeJob({ id: 'job-b', prompt: 'original' });
    const jobs = [jobA, jobB];
    const levels = [[jobA], [jobB]];

    let capturedJob: SubtaskJob | undefined;
    const provider = makeProvider(JSON.stringify({ delta: [{ ...jobB, prompt: 'revised' }] }));
    const executeLevelFn = vi.fn()
      .mockResolvedValueOnce([{ subtaskId: 'job-a', status: 'failed', error: 'oops' }] as OrchestratorLevelResult[])
      .mockImplementationOnce(async (activeJobs: SubtaskJob[]) => {
        capturedJob = activeJobs.find(j => j.id === 'job-b');
        return [{ subtaskId: 'job-b', status: 'completed', stdout: '' }] as OrchestratorLevelResult[];
      });

    await runOrchestrator(levels, jobs, makeOptions(executeLevelFn, provider, makeConfig()));
    expect(capturedJob?.prompt).toBe('revised');
  });

  it('new job inserted (new ID in delta)', async () => {
    const jobA = makeJob({ id: 'job-a' });
    const jobs = [jobA];
    const levels = [[jobA]];

    const newJob = makeJob({ id: 'job-new', title: 'New job' });
    const provider = makeProvider(JSON.stringify({ delta: [newJob] }));

    const executedIds: string[] = [];
    const executeLevelFn = vi.fn()
      .mockResolvedValueOnce([{ subtaskId: 'job-a', status: 'failed', error: 'oops' }] as OrchestratorLevelResult[])
      .mockImplementationOnce(async (activeJobs: SubtaskJob[]) => {
        executedIds.push(...activeJobs.map(j => j.id));
        return activeJobs.map(j => ({ subtaskId: j.id, status: 'completed', stdout: '' }) as OrchestratorLevelResult);
      });

    await runOrchestrator(levels, jobs, makeOptions(executeLevelFn, provider, makeConfig()));
    expect(executedIds).toContain('job-new');
  });

  it('delta defaults applied — missing files/criteria/systemPromptPrefix coerced to defaults', async () => {
    const jobA = makeJob({ id: 'job-a' });
    const jobB = makeJob({ id: 'job-b' });
    const jobs = [jobA, jobB];
    const levels = [[jobA], [jobB]];

    // Delta job missing optional fields
    const partialDelta = { id: 'job-b', title: 'B', role: 'implementer', prompt: 'new prompt', dependsOn: [] };
    const provider = makeProvider(JSON.stringify({ delta: [partialDelta] }));

    let capturedJob: SubtaskJob | undefined;
    const executeLevelFn = vi.fn()
      .mockResolvedValueOnce([{ subtaskId: 'job-a', status: 'failed', error: 'oops' }] as OrchestratorLevelResult[])
      .mockImplementationOnce(async (activeJobs: SubtaskJob[]) => {
        capturedJob = activeJobs.find(j => j.id === 'job-b');
        return [{ subtaskId: 'job-b', status: 'completed', stdout: '' }] as OrchestratorLevelResult[];
      });

    await runOrchestrator(levels, jobs, makeOptions(executeLevelFn, provider, makeConfig()));
    // files and criteria are coerced from delta defaults
    expect(capturedJob?.files).toEqual([]);
    expect(capturedJob?.criteria).toEqual([]);
    // systemPromptPrefix is populated by the orchestrator pre-level injection (not empty)
    expect(capturedJob?.systemPromptPrefix).toBeDefined();
  });

  it('completed ID in delta → silently filtered, warning logged', async () => {
    const jobA = makeJob({ id: 'job-a', role: 'architect' });
    const jobB = makeJob({ id: 'job-b' });
    const jobs = [jobA, jobB];
    const levels = [[jobA], [jobB]];

    // Delta includes the already-completed job-a — should be filtered
    const provider = makeProvider(JSON.stringify({ delta: [jobA] }));

    const logger = makeMockLogger();
    const executeLevelFn = vi.fn()
      .mockResolvedValueOnce([
        { subtaskId: 'job-a', status: 'completed', stdout: '' },
      ] as OrchestratorLevelResult[])
      .mockResolvedValueOnce([
        { subtaskId: 'job-b', status: 'failed', error: 'fail' },
      ] as OrchestratorLevelResult[]);

    await runOrchestrator(levels, jobs, { specHash: 'h', logger, executeLevelFn, provider, config: makeConfig() });

    const replanResult = (logger.events as Array<{ event: string; filteredCompletedCount?: number }>)
      .find(e => e.event === 'orchestrator_replan_result');
    expect(replanResult).toBeDefined();
    expect(replanResult?.filteredCompletedCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: schemaGate retry behavior
// ---------------------------------------------------------------------------

describe('replan — schemaGate retries', () => {
  it('schemaGate retries on invalid JSON → succeeds on second attempt', async () => {
    const jobA = makeJob({ id: 'job-a' });
    const jobB = makeJob({ id: 'job-b' });
    const jobs = [jobA, jobB];
    const levels = [[jobA], [jobB]];

    let callCount = 0;
    const provider: Provider = {
      name: 'mock',
      async *chatStream() {
        callCount++;
        const response = callCount === 1 ? 'NOT JSON' : '{"delta":[]}';
        yield { type: 'text', content: response };
        yield { type: 'done', stopReason: 'stop' };
      },
    };

    const executeLevelFn = vi.fn()
      .mockResolvedValueOnce([{ subtaskId: 'job-a', status: 'failed', error: 'oops' }] as OrchestratorLevelResult[])
      .mockResolvedValueOnce([{ subtaskId: 'job-b', status: 'completed', stdout: '' }] as OrchestratorLevelResult[]);

    await runOrchestrator(levels, jobs, makeOptions(executeLevelFn, provider, makeConfig()));
    expect(callCount).toBe(2);
  });

  it('schemaGate exhausted → returns remaining unchanged + logs orchestrator_replan_failed', async () => {
    const jobA = makeJob({ id: 'job-a' });
    const jobB = makeJob({ id: 'job-b' });
    const jobs = [jobA, jobB];
    const levels = [[jobA], [jobB]];

    // Always returns invalid JSON
    const provider = makeProvider('ALWAYS INVALID');

    const logger = makeMockLogger();
    const executeLevelFn = vi.fn()
      .mockResolvedValueOnce([{ subtaskId: 'job-a', status: 'failed', error: 'oops' }] as OrchestratorLevelResult[])
      .mockResolvedValueOnce([{ subtaskId: 'job-b', status: 'completed', stdout: '' }] as OrchestratorLevelResult[]);

    const result = await runOrchestrator(levels, jobs, { specHash: 'h', logger, executeLevelFn, provider, config: makeConfig() });

    const failedEvent = (logger.events as Array<{ event: string }>)
      .find(e => e.event === 'orchestrator_replan_failed');
    expect(failedEvent).toBeDefined();
    // job-b still runs (remaining unchanged fallback)
    expect(result.totalCompleted).toBe(1);
  });

  it('provider.chat() called with smart_model', async () => {
    const jobA = makeJob({ id: 'job-a' });
    const jobB = makeJob({ id: 'job-b' });
    const jobs = [jobA, jobB];
    const levels = [[jobA], [jobB]];

    const capturedOptions: Array<{ model?: string }> = [];
    const provider: Provider = {
      name: 'mock',
      async *chatStream(_msgs, _tools, opts) {
        capturedOptions.push(opts ?? {});
        yield { type: 'text', content: '{"delta":[]}' };
        yield { type: 'done', stopReason: 'stop' };
      },
    };

    const executeLevelFn = vi.fn()
      .mockResolvedValueOnce([{ subtaskId: 'job-a', status: 'failed', error: 'oops' }] as OrchestratorLevelResult[])
      .mockResolvedValueOnce([{ subtaskId: 'job-b', status: 'completed', stdout: '' }] as OrchestratorLevelResult[]);

    await runOrchestrator(levels, jobs, makeOptions(executeLevelFn, provider, makeConfig({ smart_model: 'o3' } as Partial<Config>)));
    expect(capturedOptions[0]?.model).toBe('o3');
  });
});

// ---------------------------------------------------------------------------
// Tests: backward contamination flagging
// ---------------------------------------------------------------------------

describe('replan — backward contamination', () => {
  it('suspect IDs populated for direct upstream ancestors', async () => {
    const jobA = makeJob({ id: 'job-a', role: 'architect' });
    const jobB = makeJob({ id: 'job-b', dependsOn: ['job-a'] });  // depends on A
    const jobs = [jobA, jobB];
    const levels = [[jobA], [jobB]];

    const provider = makeProvider('{"delta":[]}');

    const logger = makeMockLogger();
    const executeLevelFn = vi.fn()
      .mockResolvedValueOnce([{ subtaskId: 'job-a', status: 'completed', stdout: '' }] as OrchestratorLevelResult[])
      .mockResolvedValueOnce([{ subtaskId: 'job-b', status: 'failed', error: 'oops' }] as OrchestratorLevelResult[]);

    await runOrchestrator(levels, jobs, { specHash: 'h', logger, executeLevelFn, provider, config: makeConfig() });

    const replanResult = (logger.events as Array<{ event: string; suspectCount?: number }>)
      .find(e => e.event === 'orchestrator_replan_result');
    expect(replanResult).toBeDefined();
    expect(replanResult?.suspectCount).toBe(1);  // job-a is suspect
  });

  it('suspectIds empty when failed job has no completed ancestors', async () => {
    const jobA = makeJob({ id: 'job-a' });  // no dependsOn
    const jobs = [jobA];
    const levels = [[jobA]];

    const provider = makeProvider('{"delta":[]}');
    const logger = makeMockLogger();
    const executeLevelFn = vi.fn()
      .mockResolvedValueOnce([{ subtaskId: 'job-a', status: 'failed', error: 'oops' }] as OrchestratorLevelResult[]);

    await runOrchestrator(levels, jobs, { specHash: 'h', logger, executeLevelFn, provider, config: makeConfig() });

    const replanResult = (logger.events as Array<{ event: string; suspectCount?: number }>)
      .find(e => e.event === 'orchestrator_replan_result');
    expect(replanResult?.suspectCount ?? 0).toBe(0);
  });

  it('backward DFS: transitive ancestor flagged, non-ancestor not flagged', async () => {
    // A → B → C (C fails; both A and B should be suspect)
    const jobA = makeJob({ id: 'job-a' });
    const jobB = makeJob({ id: 'job-b', dependsOn: ['job-a'] });
    const jobC = makeJob({ id: 'job-c', dependsOn: ['job-b'] });
    const jobs = [jobA, jobB, jobC];
    const levels = [[jobA], [jobB], [jobC]];

    const provider = makeProvider('{"delta":[]}');
    const logger = makeMockLogger();
    const executeLevelFn = vi.fn()
      .mockResolvedValueOnce([{ subtaskId: 'job-a', status: 'completed', stdout: '' }] as OrchestratorLevelResult[])
      .mockResolvedValueOnce([{ subtaskId: 'job-b', status: 'completed', stdout: '' }] as OrchestratorLevelResult[])
      .mockResolvedValueOnce([{ subtaskId: 'job-c', status: 'failed', error: 'oops' }] as OrchestratorLevelResult[]);

    await runOrchestrator(levels, jobs, { specHash: 'h', logger, executeLevelFn, provider, config: makeConfig() });

    const replanResult = (logger.events as Array<{ event: string; suspectCount?: number }>)
      .find(e => e.event === 'orchestrator_replan_result');
    expect(replanResult?.suspectCount).toBe(2);  // both A and B are suspect
  });
});

// ---------------------------------------------------------------------------
// Tests: null architectContext backward compat
// ---------------------------------------------------------------------------

describe('replan — null architectContext', () => {
  it('no crash when no architect context available', async () => {
    const jobA = makeJob({ id: 'job-a', role: 'implementer' });  // not architect
    const jobs = [jobA];
    const levels = [[jobA]];

    const provider = makeProvider('{"delta":[]}');
    const logger = makeMockLogger();
    const executeLevelFn = vi.fn()
      .mockResolvedValueOnce([{ subtaskId: 'job-a', status: 'failed', error: 'oops' }] as OrchestratorLevelResult[]);

    const result = await runOrchestrator(levels, jobs, { specHash: 'h', logger, executeLevelFn, provider, config: makeConfig() });
    expect(result.totalFailed).toBe(1);
    const completedEvent = (logger.events as Array<{ event: string }>)
      .find(e => e.event === 'orchestrator_completed');
    expect(completedEvent).toBeDefined();
  });

  it('chatOnce error event → replanOnFailure catches and logs orchestrator_replan_failed', async () => {
    const jobA = makeJob({ id: 'job-a' });
    const jobB = makeJob({ id: 'job-b' });
    const jobs = [jobA, jobB];
    const levels = [[jobA], [jobB]];

    const errorProvider: Provider = {
      name: 'mock',
      async *chatStream(_messages, _tools, _opts?) {
        yield { type: 'error', error: 'provider error' };
      },
    };

    const logger = makeMockLogger();
    const executeLevelFn = vi.fn()
      .mockResolvedValueOnce([{ subtaskId: 'job-a', status: 'failed', error: 'oops' }] as OrchestratorLevelResult[])
      .mockResolvedValueOnce([{ subtaskId: 'job-b', status: 'completed', stdout: '' }] as OrchestratorLevelResult[]);

    await runOrchestrator(levels, jobs, { specHash: 'h', logger, executeLevelFn, provider: errorProvider, config: makeConfig() });

    const failedEvent = (logger.events as Array<{ event: string; errorMessage?: string }>)
      .find(e => e.event === 'orchestrator_replan_failed');
    expect(failedEvent).toBeDefined();
    expect(failedEvent?.errorMessage).toContain('provider error');
  });
});

// ---------------------------------------------------------------------------
// Tests: token truncation
// ---------------------------------------------------------------------------

describe('replan — token truncation', () => {
  it('remaining > 8000 chars → truncation applied (prompt still contains REMAINING section)', async () => {
    const jobA = makeJob({ id: 'job-a' });
    // Create many remaining jobs to exceed 8000 chars
    const remaining = Array.from({ length: 50 }, (_, i) =>
      makeJob({ id: `job-${i}`, prompt: 'x'.repeat(200) })
    );
    const jobs = [jobA, ...remaining];
    const levels = [[jobA], remaining];

    let capturedPrompt = '';
    const provider: Provider = {
      name: 'mock',
      async *chatStream(messages) {
        capturedPrompt = messages.map(m => m.content).join('');
        yield { type: 'text', content: '{"delta":[]}' };
        yield { type: 'done', stopReason: 'stop' };
      },
    };

    const executeLevelFn = vi.fn()
      .mockResolvedValueOnce([{ subtaskId: 'job-a', status: 'failed', error: 'oops' }] as OrchestratorLevelResult[])
      .mockResolvedValue(remaining.map(j => ({ subtaskId: j.id, status: 'completed', stdout: '' }) as OrchestratorLevelResult));

    await runOrchestrator(levels, jobs, makeOptions(executeLevelFn, provider, makeConfig()));
    // Truncation leaves "more jobs omitted" marker
    expect(capturedPrompt).toContain('more jobs omitted');
  });
});

// ---------------------------------------------------------------------------
// Tests: re-leveling
// ---------------------------------------------------------------------------

describe('replan — re-leveling', () => {
  it('mutableLevels.splice: new levels correct after replan inserts a dependency', async () => {
    const jobA = makeJob({ id: 'job-a' });
    const jobB = makeJob({ id: 'job-b' });
    const jobs = [jobA, jobB];
    const levels = [[jobA], [jobB]];

    // Delta inserts job-new which job-b now depends on
    const jobNew = makeJob({ id: 'job-new', title: 'New prerequisite' });
    const revisedJobB = { ...jobB, dependsOn: ['job-new'] };
    const provider = makeProvider(JSON.stringify({ delta: [jobNew, revisedJobB] }));

    const executionOrder: string[] = [];
    const executeLevelFn = vi.fn()
      .mockResolvedValueOnce([{ subtaskId: 'job-a', status: 'failed', error: 'oops' }] as OrchestratorLevelResult[])
      .mockImplementation(async (activeJobs: SubtaskJob[]) => {
        executionOrder.push(...activeJobs.map(j => j.id));
        return activeJobs.map(j => ({ subtaskId: j.id, status: 'completed', stdout: '' }) as OrchestratorLevelResult);
      });

    await runOrchestrator(levels, jobs, makeOptions(executeLevelFn, provider, makeConfig()));
    // job-new must execute before job-b
    const newIdx = executionOrder.indexOf('job-new');
    const bIdx = executionOrder.indexOf('job-b');
    expect(newIdx).toBeGreaterThanOrEqual(0);
    expect(bIdx).toBeGreaterThan(newIdx);
  });
});
