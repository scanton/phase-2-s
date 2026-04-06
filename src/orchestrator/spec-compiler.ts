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

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}
