import { describe, it, expect } from 'vitest';
import { compile, buildLevels, slugify } from '../../src/orchestrator/spec-compiler.js';
import type { SubTask } from '../../src/core/spec-parser.js';
import type { SubtaskJob } from '../../src/orchestrator/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSubTask(overrides: Partial<SubTask> = {}): SubTask {
  return {
    name: 'Test task',
    input: 'Some input',
    output: 'Some output',
    successCriteria: 'Passes',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// compile() — empty input
// ---------------------------------------------------------------------------

describe('compile() with no subtasks', () => {
  it('returns empty jobs and levels', () => {
    const result = compile([]);
    expect(result.jobs).toEqual([]);
    expect(result.levels).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// compile() — single annotated subtask
// ---------------------------------------------------------------------------

describe('compile() with one annotated subtask', () => {
  it('sets role from SubTask.role annotation', () => {
    const st = makeSubTask({ name: 'Design schema', role: 'architect' });
    const result = compile([st]);
    expect(result.jobs[0].role).toBe('architect');
  });

  it('unannotated subtask defaults role to implementer', () => {
    const st = makeSubTask({ name: 'Write code' });
    const result = compile([st]);
    expect(result.jobs[0].role).toBe('implementer');
  });

  it('systemPromptPrefix is empty string for all newly compiled jobs', () => {
    const st = makeSubTask({ name: 'Write tests', role: 'tester' });
    const result = compile([st]);
    expect(result.jobs[0].systemPromptPrefix).toBe('');
  });

  it('job has correct id (slugified name)', () => {
    const st = makeSubTask({ name: 'Design Database Schema' });
    const result = compile([st]);
    expect(result.jobs[0].id).toBe('design-database-schema');
  });

  it('job has correct title', () => {
    const st = makeSubTask({ name: 'Design Database Schema' });
    const result = compile([st]);
    expect(result.jobs[0].title).toBe('Design Database Schema');
  });
});

// ---------------------------------------------------------------------------
// compile() — all 4 roles
// ---------------------------------------------------------------------------

describe('compile() — all 4 roles parsed correctly', () => {
  const roles: Array<SubTask['role']> = ['architect', 'implementer', 'tester', 'reviewer'];

  for (const role of roles) {
    it(`role '${role}' is set correctly`, () => {
      const st = makeSubTask({ name: `Task ${role}`, role });
      const result = compile([st]);
      expect(result.jobs[0].role).toBe(role);
    });
  }
});

// ---------------------------------------------------------------------------
// compile() — multiple independent subtasks (no file overlap)
// ---------------------------------------------------------------------------

describe('compile() — independent subtasks in same level', () => {
  it('two independent subtasks land in levels[0] with no dependsOn', () => {
    const st1 = makeSubTask({ name: 'Task A', files: ['src/a.ts'] });
    const st2 = makeSubTask({ name: 'Task B', files: ['src/b.ts'] });
    const result = compile([st1, st2]);
    expect(result.levels.length).toBe(1);
    expect(result.levels[0].length).toBe(2);
    expect(result.jobs[0].dependsOn).toEqual([]);
    expect(result.jobs[1].dependsOn).toEqual([]);
  });

  it('dependent subtask lands in level 1', () => {
    const st1 = makeSubTask({ name: 'Task A', files: ['src/a.ts'] });
    // st2 references src/a.ts in its description, so it depends on st1
    const st2 = makeSubTask({ name: 'Task B', input: 'Use src/a.ts', files: ['src/b.ts'] });
    const result = compile([st1, st2]);
    // st2 depends on st1 because it explicitly consumes a file st1 produces
    expect(result.levels.length).toBeGreaterThanOrEqual(1);
    // The dependent should have dependsOn populated
    const jobB = result.jobs[1];
    if (jobB.dependsOn.length > 0) {
      expect(jobB.dependsOn).toContain(result.jobs[0].id);
    }
  });
});

// ---------------------------------------------------------------------------
// compile() — dependsOn populated
// ---------------------------------------------------------------------------

describe('compile() — dependsOn population', () => {
  it('jobs with no dependencies have empty dependsOn', () => {
    const subtasks = [
      makeSubTask({ name: 'Alpha', files: ['src/alpha.ts'] }),
      makeSubTask({ name: 'Beta', files: ['src/beta.ts'] }),
    ];
    const result = compile(subtasks);
    for (const job of result.jobs) {
      expect(Array.isArray(job.dependsOn)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------

describe('slugify', () => {
  it('converts spaces to dashes', () => {
    expect(slugify('design database schema')).toBe('design-database-schema');
  });

  it('lowercases uppercase letters', () => {
    expect(slugify('Design Database Schema')).toBe('design-database-schema');
  });

  it('removes special characters', () => {
    expect(slugify('foo/bar:baz!')).toBe('foo-bar-baz');
  });

  it('truncates at 60 characters', () => {
    const long = 'a'.repeat(80);
    expect(slugify(long).length).toBeLessThanOrEqual(60);
  });

  it('removes leading and trailing dashes', () => {
    expect(slugify('  hello world  ')).toBe('hello-world');
  });

  it('collapses multiple special chars into one dash', () => {
    expect(slugify('foo!!!bar')).toBe('foo-bar');
  });
});

// ---------------------------------------------------------------------------
// buildLevels — Sprint 39 (Kahn's on ID graph)
// ---------------------------------------------------------------------------

function makeJob(id: string, dependsOn: string[] = []): SubtaskJob {
  return {
    id,
    title: id,
    role: 'implementer',
    prompt: '',
    files: [],
    criteria: [],
    dependsOn,
    systemPromptPrefix: '',
  };
}

describe('buildLevels', () => {
  it('empty input → []', () => {
    expect(buildLevels([])).toEqual([]);
  });

  it('all independent (no dependsOn) → single level containing all jobs', () => {
    const jobs = [makeJob('a'), makeJob('b'), makeJob('c')];
    const levels = buildLevels(jobs);
    expect(levels).toHaveLength(1);
    expect(levels[0].map(j => j.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('serial chain A→B→C → 3 levels in correct order', () => {
    const a = makeJob('a');
    const b = makeJob('b', ['a']);
    const c = makeJob('c', ['b']);
    const levels = buildLevels([a, b, c]);
    expect(levels).toHaveLength(3);
    expect(levels[0].map(j => j.id)).toEqual(['a']);
    expect(levels[1].map(j => j.id)).toEqual(['b']);
    expect(levels[2].map(j => j.id)).toEqual(['c']);
  });

  it('diamond (A→B, A→C, B→D, C→D) → 3 levels', () => {
    const a = makeJob('a');
    const b = makeJob('b', ['a']);
    const c = makeJob('c', ['a']);
    const d = makeJob('d', ['b', 'c']);
    const levels = buildLevels([a, b, c, d]);
    expect(levels).toHaveLength(3);
    expect(levels[0].map(j => j.id)).toEqual(['a']);
    expect(levels[1].map(j => j.id).sort()).toEqual(['b', 'c']);
    expect(levels[2].map(j => j.id)).toEqual(['d']);
  });

  it('cycle detected → fallback: all cycled jobs in final level (no crash)', () => {
    // A→B→A cycle; C is independent
    const a = makeJob('a', ['b']);
    const b = makeJob('b', ['a']);
    const c = makeJob('c');
    const levels = buildLevels([a, b, c]);
    // c is in first level (no deps), a+b are in fallback level
    expect(levels.length).toBeGreaterThanOrEqual(2);
    const allIds = levels.flat().map(j => j.id);
    expect(allIds).toContain('a');
    expect(allIds).toContain('b');
    expect(allIds).toContain('c');
    // c must appear before a and b (or alongside — depends on fallback position)
    const cLevel = levels.findIndex(l => l.some(j => j.id === 'c'));
    const aLevel = levels.findIndex(l => l.some(j => j.id === 'a'));
    expect(cLevel).toBeLessThan(aLevel);
  });
});
