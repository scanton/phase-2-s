import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { fetchRunDetail } from "../api.ts";
import type { RunDetail, RunLogLine } from "../types.ts";
import StatusBadge from "../components/StatusBadge.tsx";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return rem > 0 ? `${minutes}m ${rem}s` : `${minutes}m`;
}

function formatDate(ts: string): string {
  return new Date(ts).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusStripeColor(success: boolean): string {
  return success ? "#10b981" : "#ef4444";
}

// ---------------------------------------------------------------------------
// SubtasksTable
// ---------------------------------------------------------------------------

interface SubtasksTableProps {
  runLog: RunLogLine[];
}

function SubtasksTable({ runLog }: SubtasksTableProps) {
  // Extract worker_completed or subtask_completed events
  const workerEvents = runLog.filter(
    (e) => e.event === "worker_completed" || e.event === "subtask_completed"
  );

  if (workerEvents.length === 0) {
    return (
      <p style={{ color: "#71717a", fontSize: "14px" }}>No subtask events found in run log.</p>
    );
  }

  const thStyle: React.CSSProperties = {
    padding: "8px 12px",
    textAlign: "left",
    fontSize: "11px",
    fontFamily: "Geist Mono, monospace",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "#71717a",
    borderBottom: "1px solid #3f3f46",
    whiteSpace: "nowrap",
  };

  return (
    <div
      style={{
        backgroundColor: "#27272a",
        borderRadius: "8px",
        overflow: "hidden",
        border: "1px solid #3f3f46",
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ backgroundColor: "#1f1f23" }}>
            <th style={thStyle}>#</th>
            <th style={thStyle}>Name</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Duration</th>
          </tr>
        </thead>
        <tbody>
          {workerEvents.map((e, i) => (
            <tr
              key={i}
              style={{ borderBottom: "1px solid #3f3f46" }}
            >
              <td
                style={{
                  padding: "10px 12px",
                  fontSize: "12px",
                  color: "#71717a",
                  fontFamily: "Geist Mono, monospace",
                }}
              >
                {e.index !== undefined ? e.index + 1 : i + 1}
              </td>
              <td
                style={{
                  padding: "10px 12px",
                  fontSize: "13px",
                  color: "#e4e4e7",
                  maxWidth: "400px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {e.name ?? `Subtask ${i + 1}`}
              </td>
              <td style={{ padding: "10px 12px" }}>
                <StatusBadge status={e.status ?? "running"} />
              </td>
              <td
                style={{
                  padding: "10px 12px",
                  fontSize: "12px",
                  color: "#a1a1aa",
                  fontFamily: "Geist Mono, monospace",
                  whiteSpace: "nowrap",
                }}
              >
                {e.durationMs !== undefined ? formatDuration(e.durationMs) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SpecAccordion
// ---------------------------------------------------------------------------

interface SpecAccordionProps {
  spec: string;
}

function SpecAccordion({ spec }: SpecAccordionProps) {
  const [open, setOpen] = useState(false);

  return (
    <div
      style={{
        backgroundColor: "#27272a",
        borderRadius: "8px",
        border: "1px solid #3f3f46",
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "12px 16px",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "#a1a1aa",
          fontSize: "13px",
          fontFamily: "Geist Mono, monospace",
          textAlign: "left",
        }}
        aria-expanded={open}
      >
        <span>{open ? "▾" : "▸"}</span>
        Spec
      </button>
      {open && (
        <div
          style={{
            padding: "16px",
            borderTop: "1px solid #3f3f46",
            backgroundColor: "#18181b",
            maxHeight: "500px",
            overflowY: "auto",
          }}
        >
          <div
            style={{
              fontSize: "13px",
              lineHeight: "1.7",
              color: "#d4d4d8",
              fontFamily: "Geist Mono, monospace",
            }}
          >
            <ReactMarkdown>{spec}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetchRunDetail(id)
      .then((data) => {
        setDetail(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [id]);

  if (loading) {
    return (
      <div>
        <Link
          to="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            color: "#71717a",
            fontSize: "13px",
            textDecoration: "none",
            marginBottom: "24px",
          }}
        >
          ← Runs
        </Link>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {[240, 100, 180].map((w, i) => (
            <div
              key={i}
              style={{
                width: w,
                height: 20,
                borderRadius: 4,
                backgroundColor: "#3f3f46",
                animation: "pulse 1.5s infinite",
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div>
        <Link
          to="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            color: "#71717a",
            fontSize: "13px",
            textDecoration: "none",
            marginBottom: "24px",
          }}
        >
          ← Runs
        </Link>
        <div
          role="alert"
          style={{
            backgroundColor: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: "8px",
            padding: "16px",
            color: "#f87171",
            fontSize: "14px",
          }}
        >
          {error ?? "Run not found"}
        </div>
      </div>
    );
  }

  const { entry, spec, runLog } = detail;
  const stripeColor = statusStripeColor(entry.success);

  return (
    <div>
      {/* Back nav */}
      <Link
        to="/"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          color: "#71717a",
          fontSize: "13px",
          textDecoration: "none",
          marginBottom: "24px",
          transition: "color 0.15s",
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = "#a1a1aa"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = "#71717a"; }}
      >
        ← Runs
      </Link>

      {/* Header card with status stripe */}
      <div
        style={{
          backgroundColor: "#27272a",
          borderRadius: "8px",
          border: "1px solid #3f3f46",
          borderLeft: `4px solid ${stripeColor}`,
          padding: "20px 24px",
          marginBottom: "24px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
          <StatusBadge status={entry.success ? "success" : "failed"} large />
          <h1
            style={{
              margin: 0,
              fontSize: "16px",
              fontWeight: 600,
              color: "#f4f4f5",
              lineHeight: 1.4,
            }}
          >
            {entry.goal}
          </h1>
        </div>

        {/* Stats row */}
        <div
          style={{
            display: "flex",
            gap: "24px",
            flexWrap: "wrap",
            fontSize: "13px",
            fontFamily: "Geist Mono, monospace",
            color: "#a1a1aa",
          }}
        >
          <span title="Wall-clock duration">{formatDuration(entry.durationMs)}</span>
          <span>{entry.subtaskCount} subtasks</span>
          {entry.rounds > 0 && <span>{entry.rounds} round{entry.rounds !== 1 ? "s" : ""}</span>}
          <span title={entry.ts}>{formatDate(entry.ts)}</span>
          {entry.dryRun && (
            <span style={{ color: "#fbbf24" }}>dry-run</span>
          )}
        </div>
      </div>

      {/* Spec accordion */}
      {spec && (
        <div style={{ marginBottom: "24px" }}>
          <SpecAccordion spec={spec} />
        </div>
      )}

      {/* Subtasks */}
      <div style={{ marginBottom: "24px" }}>
        <h2
          style={{
            fontSize: "13px",
            fontFamily: "Geist Mono, monospace",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "#71717a",
            marginTop: 0,
            marginBottom: "12px",
          }}
        >
          Subtasks
        </h2>
        {runLog ? (
          <SubtasksTable runLog={runLog} />
        ) : (
          <p style={{ color: "#71717a", fontSize: "14px" }}>No run log available.</p>
        )}
      </div>

      {/* Re-run hint */}
      <div
        style={{
          backgroundColor: "#27272a",
          borderRadius: "8px",
          border: "1px solid #3f3f46",
          padding: "16px",
          marginTop: "32px",
        }}
      >
        <div style={{ fontSize: "12px", color: "#71717a", marginBottom: "8px", fontFamily: "Geist Mono, monospace" }}>
          Re-run this goal
        </div>
        <code
          style={{
            display: "block",
            backgroundColor: "#18181b",
            borderRadius: "6px",
            padding: "10px 14px",
            fontSize: "12px",
            fontFamily: "Geist Mono, monospace",
            color: "#a5b4fc",
            userSelect: "all",
            wordBreak: "break-all",
          }}
        >
          {`phase2s conduct "${entry.goal.replace(/"/g, '\\"')}"`}
        </code>
      </div>
    </div>
  );
}
