/**
 * Types for the multi-agent orchestrator (Sprint 38).
 */

// SubtaskJob: output of spec-compiler.ts, input to orchestrator.ts
export interface SubtaskJob {
  id: string;               // slugified subtask title e.g. "design-database-schema"
  title: string;            // human-readable title from spec
  role: 'architect' | 'implementer' | 'tester' | 'reviewer';
  prompt: string;           // full subtask body from spec (becomes worker's task)
  files: string[];          // explicit files: annotation, or []
  criteria: string[];       // acceptance criteria lines from spec
  dependsOn: string[];      // ids of SubtaskJobs this one depends on
  systemPromptPrefix: string; // populated by orchestrator before executeOrchestratorLevel(); initially ""
}

// OrchestratorLevelResult: returned by executeOrchestratorLevel() per SubtaskJob
// Named OrchestratorLevelResult (NOT LevelResult) to avoid collision with existing
// LevelResult exported by parallel-executor.ts (different type, different fields)
export interface OrchestratorLevelResult {
  subtaskId: string;
  status: 'completed' | 'failed';
  error?: string;           // set on failure or timeout ('TIMEOUT')
  stdout?: string;          // full worker output; used for sentinel extraction (architect only)
  contextFile?: string;     // set by orchestrator post-call after sentinel extraction; always undefined for non-architect roles
}

// DeltaResponse: the typed output of the re-plan LLM call.
// The model returns { delta: SubtaskJob[] } — a minimal list of revised/new jobs.
// Jobs not in delta are unchanged. Completed jobs must never appear in delta.
export interface DeltaResponse {
  delta: SubtaskJob[];
}

/** Slug-safe pattern: lowercase alphanumeric with internal hyphens. Prevents path traversal. */
const SAFE_JOB_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export function isDeltaResponse(x: unknown): x is DeltaResponse {
  if (typeof x !== 'object' || x === null) return false;
  const d = (x as Record<string, unknown>).delta;
  if (!Array.isArray(d)) return false;
  return d.every(j =>
    typeof j === 'object' && j !== null &&
    typeof (j as SubtaskJob).id === 'string' &&
    SAFE_JOB_ID_RE.test((j as SubtaskJob).id) &&
    typeof (j as SubtaskJob).title === 'string' &&
    ['architect', 'implementer', 'tester', 'reviewer'].includes((j as SubtaskJob).role) &&
    typeof (j as SubtaskJob).prompt === 'string' &&
    Array.isArray((j as SubtaskJob).dependsOn) &&
    (j as SubtaskJob).dependsOn.every((dep: unknown) => typeof dep === 'string')
  );
}
