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
}
