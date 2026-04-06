/**
 * Dependency graph for parallel dark factory execution.
 *
 * Determines which subtasks can run in parallel by analyzing file references.
 * Uses a hybrid approach:
 *   1. Explicit `files` annotations on SubTask (highest priority)
 *   2. Regex-based heuristic parsing of subtask descriptions (fallback)
 *
 * Builds a DAG via adjacency list, detects cycles with Kahn's algorithm,
 * and produces execution levels for the parallel executor.
 *
 *   Level 0: all independent subtasks (run in parallel)
 *   Level 1: subtasks depending on level 0 results
 *   Level N: subtasks depending on level N-1 results
 */

import type { SubTask } from "../core/spec-parser.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DependencyNode {
  index: number;
  subtask: SubTask;
  /** Files this subtask creates or modifies. */
  produces: string[];
  /** Files this subtask reads or depends on. */
  consumes: string[];
  /** Indices of subtasks this node depends on. */
  dependsOn: number[];
}

export interface ExecutionLevel {
  /** Level number (0 = independent, no dependencies). */
  level: number;
  /** Indices into the original subtask array. */
  subtaskIndices: number[];
}

export interface DependencyResult {
  nodes: DependencyNode[];
  levels: ExecutionLevel[];
  /** True if cycles were detected (levels fall back to fully sequential). */
  hasCycles: boolean;
  /** Subtask indices involved in cycles (empty if no cycles). */
  cycleIndices: number[];
}

// ---------------------------------------------------------------------------
// Regex patterns for file reference extraction
// ---------------------------------------------------------------------------

/** Matches explicit file paths like src/foo/bar.ts, test/baz.test.ts */
const PATH_PATTERN = /(?:src|test|lib|docs|config|dist)\/[\w\-./]+\.\w+/g;

/** Matches "create/modify/update/add to/edit/change/write <file>" */
const VERB_PATTERN = /(?:create|modify|update|add\s+to|edit|change|write)\s+[`"']?([\w\-./]+\.\w+)/gi;

/** Matches package.json references (special: depends on everything). */
const PACKAGE_JSON_PATTERN = /package\.json/i;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the full dependency graph and execution levels for a set of subtasks.
 *
 * @param subtasks - The decomposed subtasks from the spec parser.
 * @returns Dependency nodes, execution levels, and cycle info.
 */
export function buildDependencyGraph(subtasks: SubTask[]): DependencyResult {
  if (subtasks.length === 0) {
    return { nodes: [], levels: [], hasCycles: false, cycleIndices: [] };
  }

  // Step 1: Build nodes with file references
  const nodes = subtasks.map((subtask, index) => buildNode(subtask, index));

  // Step 2: Build edges (dependency relationships)
  buildEdges(nodes);

  // Step 3: Topological sort with cycle detection (Kahn's algorithm)
  const { levels, hasCycles, cycleIndices } = topologicalSort(nodes);

  return { nodes, levels, hasCycles, cycleIndices };
}

/**
 * Get execution levels from subtasks. Convenience wrapper.
 */
export function getExecutionLevels(subtasks: SubTask[]): ExecutionLevel[] {
  return buildDependencyGraph(subtasks).levels;
}

/**
 * Format execution levels as an ASCII visualization for --dry-run.
 */
export function formatExecutionLevels(result: DependencyResult, subtasks: SubTask[]): string {
  const lines: string[] = [];

  if (result.hasCycles) {
    lines.push("WARNING: Cycle detected in dependency graph. Falling back to sequential execution.");
    lines.push(`Cycled subtasks: ${result.cycleIndices.map(i => subtasks[i]?.name ?? `#${i}`).join(", ")}`);
    lines.push("");
  }

  lines.push("Execution Plan:");
  lines.push("═".repeat(60));

  for (const level of result.levels) {
    const parallel = level.subtaskIndices.length > 1;
    const mode = parallel ? "parallel" : "sequential";
    lines.push(`\nLevel ${level.level} (${mode}, ${level.subtaskIndices.length} subtask${level.subtaskIndices.length > 1 ? "s" : ""}):`);

    for (const idx of level.subtaskIndices) {
      const node = result.nodes[idx];
      const name = subtasks[idx]?.name ?? `Subtask #${idx}`;
      const deps = node.dependsOn.length > 0
        ? ` (depends on: ${node.dependsOn.map(d => subtasks[d]?.name ?? `#${d}`).join(", ")})`
        : "";
      lines.push(`  [${idx}] ${name}${deps}`);

      if (node.produces.length > 0) {
        lines.push(`       produces: ${node.produces.join(", ")}`);
      }
      if (node.consumes.length > 0) {
        lines.push(`       consumes: ${node.consumes.join(", ")}`);
      }
    }
  }

  lines.push("\n" + "═".repeat(60));
  const totalParallel = result.levels.filter(l => l.subtaskIndices.length > 1).length;
  const totalLevels = result.levels.length;
  lines.push(`${subtasks.length} subtasks in ${totalLevels} level${totalLevels > 1 ? "s" : ""}, ${totalParallel} parallel level${totalParallel > 1 ? "s" : ""}`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Node building
// ---------------------------------------------------------------------------

function buildNode(subtask: SubTask, index: number): DependencyNode {
  // Priority 1: Explicit files annotation
  if (subtask.files && subtask.files.length > 0) {
    return {
      index,
      subtask,
      produces: [...subtask.files],
      consumes: [],
      dependsOn: [],
    };
  }

  // Priority 2: Regex heuristic from description fields
  const text = [subtask.name, subtask.input, subtask.output, subtask.successCriteria].join(" ");
  const produces = extractFileReferences(text);

  return {
    index,
    subtask,
    produces,
    consumes: [],
    dependsOn: [],
  };
}

/**
 * Extract file references from natural language text using regex heuristics.
 */
export function extractFileReferences(text: string): string[] {
  const files = new Set<string>();

  // Match explicit paths
  for (const match of text.matchAll(PATH_PATTERN)) {
    files.add(normalizePath(match[0]));
  }

  // Match verb + file patterns
  for (const match of text.matchAll(VERB_PATTERN)) {
    if (match[1]) files.add(normalizePath(match[1]));
  }

  return [...files];
}

function normalizePath(p: string): string {
  // Remove trailing punctuation that might be captured
  return p.replace(/[.,;:!?'")\]}>]+$/, "");
}

// ---------------------------------------------------------------------------
// Edge building
// ---------------------------------------------------------------------------

/**
 * Build dependency edges between nodes.
 *
 * Rule: if node B references a file that node A produces, B depends on A.
 * Special: if any node mentions package.json, it depends on all prior nodes
 * (conservative — package.json changes affect everything).
 */
function buildEdges(nodes: DependencyNode[]): void {
  // Build a map: file → producer node indices
  const fileProducers = new Map<string, number[]>();
  for (const node of nodes) {
    for (const file of node.produces) {
      const existing = fileProducers.get(file) ?? [];
      existing.push(node.index);
      fileProducers.set(file, existing);
    }
  }

  for (const node of nodes) {
    const text = [node.subtask.name, node.subtask.input, node.subtask.output, node.subtask.successCriteria].join(" ");

    // Special: package.json → depends on all other nodes
    if (PACKAGE_JSON_PATTERN.test(text)) {
      for (const other of nodes) {
        if (other.index !== node.index) {
          addDependency(node, other.index);
        }
      }
      continue;
    }

    // Check if this node consumes files that other nodes produce
    for (const [file, producers] of fileProducers) {
      if (node.produces.includes(file) && producers.some(p => p !== node.index)) {
        // Both nodes produce the same file → add dependency on earlier producer
        for (const producerIdx of producers) {
          if (producerIdx !== node.index && producerIdx < node.index) {
            addDependency(node, producerIdx);
            node.consumes.push(file);
          }
        }
      }
    }

    // Check description for references to files produced by other nodes
    for (const [file, producers] of fileProducers) {
      if (textReferencesFile(text, file)) {
        for (const producerIdx of producers) {
          if (producerIdx !== node.index) {
            addDependency(node, producerIdx);
            if (!node.consumes.includes(file)) {
              node.consumes.push(file);
            }
          }
        }
      }
    }
  }
}

function addDependency(node: DependencyNode, depIndex: number): void {
  if (!node.dependsOn.includes(depIndex)) {
    node.dependsOn.push(depIndex);
  }
}

/**
 * Check if text references a specific file (beyond just producing it).
 */
function textReferencesFile(text: string, file: string): boolean {
  // Simple substring match — the file path appears in the text
  return text.includes(file);
}

// ---------------------------------------------------------------------------
// Topological sort (Kahn's algorithm)
// ---------------------------------------------------------------------------

interface SortResult {
  levels: ExecutionLevel[];
  hasCycles: boolean;
  cycleIndices: number[];
}

/**
 * Topological sort using Kahn's algorithm.
 * Produces execution levels (nodes at the same level have no inter-dependencies).
 * Detects cycles: nodes remaining after processing form cycles.
 */
function topologicalSort(nodes: DependencyNode[]): SortResult {
  const n = nodes.length;

  // Compute in-degree for each node
  const inDegree = new Array(n).fill(0);
  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      inDegree[node.index]++;
    }
  }

  // Build reverse adjacency: for each node, which nodes depend on it?
  const dependents = new Map<number, number[]>();
  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      const existing = dependents.get(dep) ?? [];
      existing.push(node.index);
      dependents.set(dep, existing);
    }
  }

  const levels: ExecutionLevel[] = [];
  const processed = new Set<number>();

  // Start with nodes that have no dependencies (in-degree 0)
  let currentLevel: number[] = [];
  for (let i = 0; i < n; i++) {
    if (inDegree[i] === 0) {
      currentLevel.push(i);
    }
  }

  let levelNum = 0;
  while (currentLevel.length > 0) {
    levels.push({ level: levelNum, subtaskIndices: [...currentLevel] });

    const nextLevel: number[] = [];
    for (const idx of currentLevel) {
      processed.add(idx);
      // Reduce in-degree of dependents
      for (const dependent of (dependents.get(idx) ?? [])) {
        inDegree[dependent]--;
        if (inDegree[dependent] === 0) {
          nextLevel.push(dependent);
        }
      }
    }

    currentLevel = nextLevel;
    levelNum++;
  }

  // Check for cycles: any unprocessed nodes form a cycle
  const cycleIndices: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!processed.has(i)) {
      cycleIndices.push(i);
    }
  }

  if (cycleIndices.length > 0) {
    // Fall back to sequential for cycled nodes (append as individual levels)
    for (const idx of cycleIndices) {
      levels.push({ level: levelNum, subtaskIndices: [idx] });
      levelNum++;
    }
    return { levels, hasCycles: true, cycleIndices };
  }

  return { levels, hasCycles: false, cycleIndices: [] };
}
