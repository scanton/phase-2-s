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
