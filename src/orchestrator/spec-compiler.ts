/**
 * Spec compiler — converts SubTask[] (spec-parser output) into SubtaskJob[]
 * with dependency graph populated via Kahn's algorithm.
 */

import type { SubTask } from '../core/spec-parser.js';
import { buildDependencyGraph } from '../goal/dependency-graph.js';
import type { SubtaskJob } from './types.js';

export interface CompileResult {
  jobs: SubtaskJob[];
  levels: SubtaskJob[][];  // pre-leveled: levels[0] = first level to run, etc.
}

export function compile(subtasks: SubTask[]): CompileResult {
  if (subtasks.length === 0) {
    return { jobs: [], levels: [] };
  }

  // 1. Build SubtaskJob[] from SubTask[]
  // Deduplicate slugs: if two subtasks produce the same slug, append -2, -3, etc.
  const seenSlugs = new Map<string, number>();
  const jobs: SubtaskJob[] = subtasks.map((st) => {
    const base = slugify(st.name);
    const count = seenSlugs.get(base) ?? 0;
    seenSlugs.set(base, count + 1);
    const id = count === 0 ? base : `${base}-${count + 1}`;
    return {
      id,
      title: st.name,
      role: st.role ?? 'implementer',  // default to implementer if no annotation
      prompt: [st.input, st.output, st.successCriteria].filter(Boolean).join('\n'),
      files: st.files ?? [],
      criteria: st.successCriteria ? [st.successCriteria] : [],
      dependsOn: [],  // populated after Kahn's
      systemPromptPrefix: '',
    };
  });

  // 2. Run Kahn's via existing buildDependencyGraph()
  const depResult = buildDependencyGraph(subtasks);

  // 3. Populate dependsOn using the index-based graph, converted to ID-based
  for (const node of depResult.nodes) {
    jobs[node.index].dependsOn = node.dependsOn.map(i => jobs[i].id);
  }

  // 4. Convert ExecutionLevel[] (index-based) to SubtaskJob[][] (ID-based)
  const levels: SubtaskJob[][] = depResult.levels.map(level =>
    level.subtaskIndices.map(i => jobs[i])
  );

  return { jobs, levels };
}

/**
 * Build execution levels from SubtaskJob[] using Kahn's algorithm on the
 * ID-based dependsOn graph.
 *
 * This is NOT a wrapper around buildDependencyGraph() — that function operates
 * on SubTask[] and derives dependencies from file references. Here, dependsOn
 * is already populated as string[] IDs on each SubtaskJob.
 *
 * Cycle detection: any jobs with non-zero in-degree after processing are put
 * in a final fallback level (conservative — avoids crash).
 */
export function buildLevels(jobs: SubtaskJob[]): SubtaskJob[][] {
  if (jobs.length === 0) return [];

  const byId = new Map(jobs.map(j => [j.id, j]));

  // Only count in-degree from dependencies that exist in this job set
  // (completed jobs may still appear in dependsOn — filter them out)
  const inDegree = new Map<string, number>();
  for (const j of jobs) {
    inDegree.set(j.id, 0);
  }
  for (const j of jobs) {
    for (const dep of j.dependsOn) {
      if (byId.has(dep)) {
        inDegree.set(j.id, (inDegree.get(j.id) ?? 0) + 1);
      }
    }
  }

  // Adjacency: dep → list of jobs that depend on it
  const adj = new Map<string, string[]>();
  for (const j of jobs) {
    for (const dep of j.dependsOn) {
      if (byId.has(dep)) {
        if (!adj.has(dep)) adj.set(dep, []);
        adj.get(dep)!.push(j.id);
      }
    }
  }

  const levels: SubtaskJob[][] = [];
  let queue = jobs.filter(j => (inDegree.get(j.id) ?? 0) === 0);

  while (queue.length > 0) {
    levels.push(queue);
    const next: SubtaskJob[] = [];
    for (const j of queue) {
      for (const depId of adj.get(j.id) ?? []) {
        const deg = (inDegree.get(depId) ?? 0) - 1;
        inDegree.set(depId, deg);
        if (deg === 0) next.push(byId.get(depId)!);
      }
    }
    queue = next;
  }

  // Cycle fallback: remaining jobs with non-zero in-degree go in one final level
  const remaining = jobs.filter(j => (inDegree.get(j.id) ?? 0) > 0);
  if (remaining.length > 0) {
    levels.push(remaining);
  }

  return levels;
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return slug || 'subtask';
}
