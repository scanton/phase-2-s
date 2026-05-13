import type { ConductLogEntry, RunDetail, ActiveRun, LiveEvent, LintResult, NewRunPayload } from "./types.ts";

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

export async function fetchActiveRuns(): Promise<ActiveRun[]> {
  const res = await fetch("/api/runs/active");
  if (!res.ok) return [];
  const data = await res.json() as { runs: ActiveRun[] };
  return data.runs ?? [];
}

/**
 * Open an SSE stream to GET /api/runs/:id/stream.
 *
 * Returns a cleanup function. Call it to close the stream.
 *
 * @param id        specHash
 * @param onEvent   called for each run event received
 * @param onClose   called when the server signals run completion (event: close)
 *                  or when the stream errors/closes unexpectedly
 */
export function createRunStream(
  id: string,
  onEvent: (event: LiveEvent) => void,
  onClose: () => void,
): () => void {
  const source = new EventSource(`/api/runs/${encodeURIComponent(id)}/stream`);

  source.onmessage = (e: MessageEvent<string>) => {
    try {
      const ev = JSON.parse(e.data) as LiveEvent;
      onEvent(ev);
    } catch {
      // Skip malformed events
    }
  };

  // Named "close" event signals the run is done
  source.addEventListener("close", () => {
    source.close();
    onClose();
  });

  source.onerror = () => {
    // EventSource auto-reconnects on transient errors — only call onClose()
    // once the connection is permanently closed (readyState === CLOSED).
    // Calling onClose() on every error fires a false completion notification
    // on WiFi blips and prevents the auto-reconnect from working.
    if (source.readyState === EventSource.CLOSED) {
      onClose();
    }
  };

  return () => {
    source.close();
  };
}

export async function postLint(payload: { goal: string; template?: string }): Promise<LintResult> {
  const res = await fetch("/api/lint", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json() as { error?: string };
    throw new Error(data.error ?? `Lint error: ${res.status}`);
  }
  return res.json() as Promise<LintResult>;
}

export async function postRun(payload: NewRunPayload): Promise<{ id: string }> {
  const res = await fetch("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json() as { id?: string; errors?: string[] };
  if (!res.ok) {
    const errors = data.errors ?? ["Run failed"];
    throw new Error(errors.join(". "));
  }
  if (!data.id) throw new Error("Server returned success but no run id");
  return { id: data.id };
}
