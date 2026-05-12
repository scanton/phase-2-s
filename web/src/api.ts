import type { ConductLogEntry, RunDetail } from "./types.ts";

export async function fetchRuns(): Promise<ConductLogEntry[]> {
  const res = await fetch("/api/runs");
  if (!res.ok) throw new Error(`Failed to fetch runs: ${res.status}`);
  return res.json() as Promise<ConductLogEntry[]>;
}

export async function fetchRunDetail(id: string): Promise<RunDetail> {
  const res = await fetch(`/api/runs/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Run not found: ${res.status}`);
  return res.json() as Promise<RunDetail>;
}
