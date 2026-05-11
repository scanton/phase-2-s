import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createProgressRenderer, type ProgressEvent } from '../../src/goal/progress-renderer.js';

// ---------------------------------------------------------------------------
// Mock WriteStream helper
// ---------------------------------------------------------------------------

function makeMockOut() {
  const chunks: string[] = [];
  const mockOut = {
    write: (s: string) => { chunks.push(s); return true; },
    rows: 24,
    columns: 80,
    isTTY: true,
    on: (_event: string, _handler: () => void) => mockOut,
  } as unknown as NodeJS.WriteStream;
  return { mockOut, chunks };
}

// ---------------------------------------------------------------------------
// 1. quiet mode — emit and dispose are no-ops, no writes
// ---------------------------------------------------------------------------

describe('createProgressRenderer — quiet mode', () => {
  it('emit and dispose produce no writes', () => {
    const { mockOut, chunks } = makeMockOut();
    const renderer = createProgressRenderer({ mode: 'quiet', goal: 'my goal', out: mockOut });

    renderer.emit({ type: 'level_start', levelIndex: 0, totalLevels: 3, jobs: [{ id: 'a', title: 'A' }] });
    renderer.emit({ type: 'job_start', jobId: 'a' });
    renderer.emit({ type: 'job_complete', jobId: 'a', durationMs: 1000 });
    renderer.dispose();

    expect(chunks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2-6. plain mode
// ---------------------------------------------------------------------------

describe('createProgressRenderer — plain mode', () => {
  it('level_start writes "[conduct] Level 1/3 — 2 subtasks"', () => {
    const { mockOut, chunks } = makeMockOut();
    const renderer = createProgressRenderer({ mode: 'plain', goal: 'test goal', out: mockOut });

    renderer.emit({
      type: 'level_start',
      levelIndex: 0,
      totalLevels: 3,
      jobs: [{ id: 'j1', title: 'Job One' }, { id: 'j2', title: 'Job Two' }],
    });

    const output = chunks.join('');
    expect(output).toContain('[conduct] Level 1/3 — 2 subtasks');
  });

  it('job_start writes "[conduct] → title"', () => {
    const { mockOut, chunks } = makeMockOut();
    const renderer = createProgressRenderer({ mode: 'plain', goal: 'g', out: mockOut });

    // Must emit level_start first to register job titles
    renderer.emit({
      type: 'level_start',
      levelIndex: 0,
      totalLevels: 1,
      jobs: [{ id: 'j1', title: 'Write tests' }],
    });
    chunks.length = 0; // clear level_start output

    renderer.emit({ type: 'job_start', jobId: 'j1' });
    const output = chunks.join('');
    expect(output).toContain('[conduct] → Write tests');
  });

  it('job_complete writes "[conduct] ✓ title (Xs)"', () => {
    const { mockOut, chunks } = makeMockOut();
    const renderer = createProgressRenderer({ mode: 'plain', goal: 'g', out: mockOut });

    renderer.emit({
      type: 'level_start',
      levelIndex: 0,
      totalLevels: 1,
      jobs: [{ id: 'j1', title: 'Implement auth' }],
    });
    chunks.length = 0;

    renderer.emit({ type: 'job_complete', jobId: 'j1', durationMs: 5000 });
    const output = chunks.join('');
    expect(output).toContain('[conduct] ✓ Implement auth');
    expect(output).toContain('5s');
  });

  it('job_failed writes "[conduct] ✗ title (Xs) — error"', () => {
    const { mockOut, chunks } = makeMockOut();
    const renderer = createProgressRenderer({ mode: 'plain', goal: 'g', out: mockOut });

    renderer.emit({
      type: 'level_start',
      levelIndex: 0,
      totalLevels: 1,
      jobs: [{ id: 'j1', title: 'Bad task' }],
    });
    chunks.length = 0;

    renderer.emit({ type: 'job_failed', jobId: 'j1', durationMs: 3000, error: 'Test failed' });
    const output = chunks.join('');
    expect(output).toContain('[conduct] ✗ Bad task');
    expect(output).toContain('3s');
    expect(output).toContain('Test failed');
  });

  it('job_skipped writes "[conduct] ⊘ title"', () => {
    const { mockOut, chunks } = makeMockOut();
    const renderer = createProgressRenderer({ mode: 'plain', goal: 'g', out: mockOut });

    renderer.emit({
      type: 'level_start',
      levelIndex: 0,
      totalLevels: 1,
      jobs: [{ id: 'j1', title: 'Skipped task' }],
    });
    chunks.length = 0;

    renderer.emit({ type: 'job_skipped', jobId: 'j1' });
    const output = chunks.join('');
    expect(output).toContain('[conduct] ⊘ Skipped task');
  });
});

// ---------------------------------------------------------------------------
// Plain mode — additional coverage: level_complete, done, unknown-id fallback
// ---------------------------------------------------------------------------

describe('createProgressRenderer — plain mode (additional)', () => {
  it('level_complete is a no-op (no writes)', () => {
    const { mockOut, chunks } = makeMockOut();
    const renderer = createProgressRenderer({ mode: 'plain', goal: 'g', out: mockOut });

    renderer.emit({ type: 'level_complete', levelIndex: 0 });
    expect(chunks).toHaveLength(0);
    renderer.dispose();
  });

  it('done writes "[conduct] done — Xs total"', () => {
    const { mockOut, chunks } = makeMockOut();
    const renderer = createProgressRenderer({ mode: 'plain', goal: 'g', out: mockOut });

    renderer.emit({ type: 'done', totalDurationMs: 8000 });
    const output = chunks.join('');
    expect(output).toContain('[conduct] done');
    expect(output).toContain('8s');
    renderer.dispose();
  });

  it('unknown jobId falls back to raw jobId string', () => {
    const { mockOut, chunks } = makeMockOut();
    const renderer = createProgressRenderer({ mode: 'plain', goal: 'g', out: mockOut });

    // No level_start emitted — jobId has no registered title
    renderer.emit({ type: 'job_start', jobId: 'unknown-job-id' });
    const output = chunks.join('');
    expect(output).toContain('unknown-job-id');
    renderer.dispose();
  });
});

// ---------------------------------------------------------------------------
// 7-10. ansi mode
// ---------------------------------------------------------------------------

describe('createProgressRenderer — ansi mode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emit(level_start) writes header to out', () => {
    const { mockOut, chunks } = makeMockOut();
    const renderer = createProgressRenderer({ mode: 'ansi', goal: 'My goal', out: mockOut });

    renderer.emit({
      type: 'level_start',
      levelIndex: 0,
      totalLevels: 2,
      jobs: [{ id: 'j1', title: 'Job One' }, { id: 'j2', title: 'Job Two' }],
    });

    const output = chunks.join('');
    expect(output).toContain('Phase2S Conductor');
    expect(output).toContain('My goal');
    expect(output).toContain('Level 1 of 2');

    // Cleanup
    renderer.dispose();
  });

  it('emit(job_start) sets row to running state visible in next redraw', () => {
    const { mockOut, chunks } = makeMockOut();
    const renderer = createProgressRenderer({ mode: 'ansi', goal: 'test', out: mockOut });

    renderer.emit({
      type: 'level_start',
      levelIndex: 0,
      totalLevels: 1,
      jobs: [{ id: 'j1', title: 'My Task' }],
    });
    chunks.length = 0;

    renderer.emit({ type: 'job_start', jobId: 'j1' });

    // Advance timer to trigger a redraw
    vi.advanceTimersByTime(200);

    const output = chunks.join('');
    // Running row should contain the bullet indicator (●) or yellow color code
    expect(output).toContain('My Task');

    renderer.dispose();
  });

  it('dispose() does not throw even if out.write throws', () => {
    const throwingOut = {
      write: () => { throw new Error('write failed'); },
      rows: 24,
      columns: 80,
      isTTY: true,
      on: (_e: string, _h: () => void) => throwingOut,
    } as unknown as NodeJS.WriteStream;

    const renderer = createProgressRenderer({ mode: 'ansi', goal: 'test', out: throwingOut });

    // Should not throw
    expect(() => renderer.dispose()).not.toThrow();
  });

  it('emit(job_complete) sets row to done state visible in next redraw', () => {
    const { mockOut, chunks } = makeMockOut();
    const renderer = createProgressRenderer({ mode: 'ansi', goal: 'test', out: mockOut });

    renderer.emit({
      type: 'level_start',
      levelIndex: 0,
      totalLevels: 1,
      jobs: [{ id: 'j1', title: 'Done Task' }],
    });
    renderer.emit({ type: 'job_start', jobId: 'j1' });
    chunks.length = 0;

    renderer.emit({ type: 'job_complete', jobId: 'j1', durationMs: 2000 });

    vi.advanceTimersByTime(200);
    const output = chunks.join('');
    expect(output).toContain('Done Task');
    // Green check mark or green ANSI code should appear
    expect(output).toContain('✓');

    renderer.dispose();
  });

  it('emit(job_failed) sets row to failed state visible in next redraw', () => {
    const { mockOut, chunks } = makeMockOut();
    const renderer = createProgressRenderer({ mode: 'ansi', goal: 'test', out: mockOut });

    renderer.emit({
      type: 'level_start',
      levelIndex: 0,
      totalLevels: 1,
      jobs: [{ id: 'j1', title: 'Fail Task' }],
    });
    renderer.emit({ type: 'job_start', jobId: 'j1' });
    chunks.length = 0;

    renderer.emit({ type: 'job_failed', jobId: 'j1', durationMs: 1000, error: 'something broke' });

    vi.advanceTimersByTime(200);
    const output = chunks.join('');
    expect(output).toContain('Fail Task');
    expect(output).toContain('✗');

    renderer.dispose();
  });

  it('emit(job_skipped) sets row to skipped state visible in next redraw', () => {
    const { mockOut, chunks } = makeMockOut();
    const renderer = createProgressRenderer({ mode: 'ansi', goal: 'test', out: mockOut });

    renderer.emit({
      type: 'level_start',
      levelIndex: 0,
      totalLevels: 1,
      jobs: [{ id: 'j1', title: 'Skip Task' }],
    });
    chunks.length = 0;

    renderer.emit({ type: 'job_skipped', jobId: 'j1' });

    vi.advanceTimersByTime(200);
    const output = chunks.join('');
    expect(output).toContain('Skip Task');
    expect(output).toContain('⊘');

    renderer.dispose();
  });

  it('emit(level_complete) stops ticker and forces final redraw', () => {
    const { mockOut, chunks } = makeMockOut();
    const renderer = createProgressRenderer({ mode: 'ansi', goal: 'test', out: mockOut });

    renderer.emit({
      type: 'level_start',
      levelIndex: 0,
      totalLevels: 1,
      jobs: [{ id: 'j1', title: 'Task' }],
    });
    renderer.emit({ type: 'job_start', jobId: 'j1' });
    renderer.emit({ type: 'job_complete', jobId: 'j1', durationMs: 500 });
    chunks.length = 0;

    renderer.emit({ type: 'level_complete', levelIndex: 0 });

    // After level_complete the ticker is stopped — advancing time should NOT cause more redraws
    const countAfterLevelComplete = chunks.length;
    vi.advanceTimersByTime(500);
    expect(chunks.length).toBe(countAfterLevelComplete);

    renderer.dispose();
  });

  it('emit(done) writes summary line', () => {
    const { mockOut, chunks } = makeMockOut();
    const renderer = createProgressRenderer({ mode: 'ansi', goal: 'test', out: mockOut });

    renderer.emit({
      type: 'level_start',
      levelIndex: 0,
      totalLevels: 1,
      jobs: [{ id: 'j1', title: 'Task' }],
    });
    renderer.emit({ type: 'job_complete', jobId: 'j1', durationMs: 3000 });
    renderer.emit({ type: 'level_complete', levelIndex: 0 });
    chunks.length = 0;

    renderer.emit({ type: 'done', totalDurationMs: 3000 });
    const output = chunks.join('');
    expect(output).toContain('done');
    expect(output).toContain('3s');

    renderer.dispose();
  });

  it('SSH_TTY env var affects tick interval to 250ms (behavior observable via timer)', () => {
    // Set SSH_TTY to simulate SSH session
    const origSSH = process.env.SSH_TTY;
    process.env.SSH_TTY = '/dev/pts/0';

    const { mockOut, chunks } = makeMockOut();
    const renderer = createProgressRenderer({ mode: 'ansi', goal: 'ssh test', out: mockOut });

    renderer.emit({
      type: 'level_start',
      levelIndex: 0,
      totalLevels: 1,
      jobs: [{ id: 'j1', title: 'Task' }],
    });
    renderer.emit({ type: 'job_start', jobId: 'j1' });
    chunks.length = 0;

    // Advance 100ms — in SSH mode tick is 250ms, so no redraw yet
    vi.advanceTimersByTime(100);
    const outputAt100ms = chunks.join('');
    // At 100ms, since SSH tick is 250ms, there may be no redraw yet
    // Advance to 250ms — should have triggered at least one tick
    vi.advanceTimersByTime(150);
    const outputAt250ms = chunks.join('');
    // After 250ms at least one redraw should have occurred (running job forces dirty)
    expect(outputAt250ms.length).toBeGreaterThan(outputAt100ms.length);

    renderer.dispose();

    // Restore env
    if (origSSH === undefined) {
      delete process.env.SSH_TTY;
    } else {
      process.env.SSH_TTY = origSSH;
    }
  });

  // -------------------------------------------------------------------------
  // Gap coverage: degraded resize branch
  // -------------------------------------------------------------------------

  it('resize event on process.stdout sets degraded=true — next redraw flows without cursor-up', () => {
    const { mockOut, chunks } = makeMockOut();
    const renderer = createProgressRenderer({ mode: 'ansi', goal: 'resize test', out: mockOut });

    renderer.emit({
      type: 'level_start',
      levelIndex: 0,
      totalLevels: 1,
      jobs: [{ id: 'j1', title: 'Resize Task' }],
    });
    renderer.emit({ type: 'job_start', jobId: 'j1' });
    chunks.length = 0;

    // Trigger resize — the handler is registered on process.stdout
    process.stdout.emit('resize');

    // Advance timer to trigger redraw in degraded mode
    vi.advanceTimersByTime(200);

    const output = chunks.join('');
    // Degraded mode still writes the panel content, just without cursor-up
    expect(output).toContain('Resize Task');
    // In degraded mode, the output should NOT contain cursor-up escape sequences (\x1b[NF or \x1b[NA)
    expect(output).not.toMatch(/\x1b\[\d+[FA]/);

    renderer.dispose();
  });

  // -------------------------------------------------------------------------
  // Gap coverage: formatDuration >60s (the "1m Xs" branch)
  // -------------------------------------------------------------------------

  it('job_complete with durationMs > 60000 shows minutes in "Xm Ys" format', () => {
    const { mockOut, chunks } = makeMockOut();
    const renderer = createProgressRenderer({ mode: 'ansi', goal: 'long job', out: mockOut });

    renderer.emit({
      type: 'level_start',
      levelIndex: 0,
      totalLevels: 1,
      jobs: [{ id: 'j1', title: 'Long Task' }],
    });
    renderer.emit({ type: 'job_start', jobId: 'j1' });
    chunks.length = 0;

    // 65 seconds = 1m 5s
    renderer.emit({ type: 'job_complete', jobId: 'j1', durationMs: 65000 });
    vi.advanceTimersByTime(200);

    const output = chunks.join('');
    expect(output).toContain('1m 5s');

    renderer.dispose();
  });
});
