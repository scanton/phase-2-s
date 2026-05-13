export interface ConductLogEntry {
  ts: string;
  goal: string;
  specPath: string;
  specHash: string;
  subtaskCount: number;
  roles: string[];
  success: boolean;
  durationMs: number;
  runLogPath: string;
  rounds: number;
  dryRun?: boolean;
}

export interface RunLogLine {
  event: string;
  ts: string;
  level?: number;
  index?: number;
  name?: string;
  status?: string;
  durationMs?: number;
  [key: string]: unknown;
}

export interface RunDetail {
  entry: ConductLogEntry;
  spec: string | null;
  runLog: RunLogLine[] | null;
  /** Server-computed: true if the run is currently in progress */
  isActive: boolean;
}

/** A run that is currently in progress (from GET /api/runs/active) */
export interface ActiveRun {
  specHash: string;
  startedAt: string;
  runLogPath: string;
}

/** Result of POST /api/lint */
export interface LintResult {
  valid: boolean;
  errors: string[];
}

/** Payload for POST /api/runs */
export interface NewRunPayload {
  goal: string;
  template?: string;
  modelTier: "fast" | "smart";
  parallel: boolean;
}

/** A raw event received via SSE from GET /api/runs/:id/stream */
export interface LiveEvent {
  event: string;
  ts?: string;
  level?: number;
  index?: number;
  name?: string;
  status?: string;
  durationMs?: number;
  [key: string]: unknown;
}
