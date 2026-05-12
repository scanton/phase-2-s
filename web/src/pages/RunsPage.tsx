import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchRuns } from "../api.ts";
import type { ConductLogEntry } from "../types.ts";
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

function relativeTime(ts: string): string {
  const now = Date.now();
  const then = new Date(ts).getTime();
  const diffMs = now - then;
  const diffSecs = Math.floor(diffMs / 1000);
  if (diffSecs < 60) return "just now";
  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}mo ago`;
}

// ---------------------------------------------------------------------------
// Skeleton row
// ---------------------------------------------------------------------------

function SkeletonRow() {
  return (
    <tr>
      {[200, 80, 60, 50, 70].map((w, i) => (
        <td key={i} style={{ padding: "12px 16px" }}>
          <div
            style={{
              width: w,
              height: 14,
              borderRadius: 4,
              backgroundColor: "#3f3f46",
              animation: "pulse 1.5s infinite",
            }}
          />
        </td>
      ))}
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Stat bar
// ---------------------------------------------------------------------------

interface StatBarProps {
  entries: ConductLogEntry[];
}

function StatBar({ entries }: StatBarProps) {
  const total = entries.length;
  const successes = entries.filter((e) => e.success).length;
  const rate = total > 0 ? Math.round((successes / total) * 100) : 0;
  const avgDuration =
    total > 0 ? Math.round(entries.reduce((sum, e) => sum + e.durationMs, 0) / total) : 0;
  const totalSubtasks = entries.reduce((sum, e) => sum + e.subtaskCount, 0);

  const statStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    padding: "12px 20px",
    backgroundColor: "#27272a",
    borderRadius: "8px",
    minWidth: "120px",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: "11px",
    color: "#71717a",
    fontFamily: "Geist Mono, monospace",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  };

  const valueStyle: React.CSSProperties = {
    fontSize: "22px",
    fontWeight: 600,
    color: "#f4f4f5",
    fontFamily: "Geist Mono, monospace",
  };

  return (
    <div style={{ display: "flex", gap: "12px", marginBottom: "20px", flexWrap: "wrap" }}>
      <div style={statStyle}>
        <span style={labelStyle}>Total Runs</span>
        <span style={valueStyle}>{total}</span>
      </div>
      <div style={statStyle}>
        <span style={labelStyle}>Success Rate</span>
        <span style={{ ...valueStyle, color: rate >= 70 ? "#34d399" : rate >= 40 ? "#fbbf24" : "#f87171" }}>
          {rate}%
        </span>
      </div>
      <div style={statStyle}>
        <span style={labelStyle}>Avg Duration</span>
        <span style={valueStyle}>{formatDuration(avgDuration)}</span>
      </div>
      <div style={statStyle}>
        <span style={labelStyle}>Total Subtasks</span>
        <span style={valueStyle}>{totalSubtasks}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function RunsPage() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<ConductLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRuns()
      .then((data) => {
        setEntries(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, []);

  const thStyle: React.CSSProperties = {
    padding: "10px 16px",
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
    <div>
      <h1
        style={{
          fontSize: "18px",
          fontWeight: 600,
          color: "#f4f4f5",
          marginTop: 0,
          marginBottom: "20px",
        }}
      >
        Conduct Runs
      </h1>

      {error && (
        <div
          role="alert"
          style={{
            backgroundColor: "rgba(217,119,6,0.12)",
            border: "1px solid rgba(217,119,6,0.3)",
            borderRadius: "8px",
            padding: "12px 16px",
            marginBottom: "20px",
            color: "#fbbf24",
            fontSize: "14px",
          }}
        >
          Failed to load runs: {error}
        </div>
      )}

      {!loading && !error && entries.length === 0 && (
        <div
          style={{
            backgroundColor: "#27272a",
            borderRadius: "12px",
            padding: "48px 32px",
            textAlign: "center",
            color: "#71717a",
          }}
        >
          <div style={{ fontSize: "32px", marginBottom: "12px" }}>~</div>
          <div style={{ fontSize: "16px", fontWeight: 500, color: "#a1a1aa", marginBottom: "8px" }}>
            No runs yet
          </div>
          <div style={{ fontSize: "14px", marginBottom: "20px" }}>
            Start your first conductor run to see results here.
          </div>
          <code
            style={{
              display: "inline-block",
              backgroundColor: "#18181b",
              border: "1px solid #3f3f46",
              borderRadius: "6px",
              padding: "8px 14px",
              fontSize: "13px",
              fontFamily: "Geist Mono, monospace",
              color: "#a5b4fc",
              userSelect: "all",
            }}
          >
            phase2s conduct "your goal here"
          </code>
        </div>
      )}

      {(!loading || entries.length > 0) && entries.length > 0 && (
        <StatBar entries={entries} />
      )}

      {(loading || entries.length > 0) && (
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
                <th style={thStyle}>Goal</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Duration</th>
                <th style={thStyle}>Subtasks</th>
                <th style={thStyle}>When</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
                : entries.map((entry) => (
                    <tr
                      key={entry.specHash || entry.ts}
                      onClick={() => navigate(`/runs/${entry.specHash || entry.ts}`)}
                      style={{
                        cursor: "pointer",
                        borderBottom: "1px solid #3f3f46",
                        transition: "background-color 0.1s",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLTableRowElement).style.backgroundColor =
                          "rgba(255,255,255,0.03)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLTableRowElement).style.backgroundColor = "";
                      }}
                    >
                      <td
                        style={{
                          padding: "12px 16px",
                          fontSize: "14px",
                          color: "#e4e4e7",
                          maxWidth: "320px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={entry.goal}
                      >
                        {entry.goal}
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <StatusBadge status={entry.success ? "success" : "failed"} />
                      </td>
                      <td
                        style={{
                          padding: "12px 16px",
                          fontSize: "13px",
                          color: "#a1a1aa",
                          fontFamily: "Geist Mono, monospace",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {formatDuration(entry.durationMs)}
                      </td>
                      <td
                        style={{
                          padding: "12px 16px",
                          fontSize: "13px",
                          color: "#a1a1aa",
                          fontFamily: "Geist Mono, monospace",
                        }}
                      >
                        {entry.subtaskCount}
                      </td>
                      <td
                        style={{
                          padding: "12px 16px",
                          fontSize: "13px",
                          color: "#71717a",
                          whiteSpace: "nowrap",
                        }}
                        title={entry.ts}
                      >
                        {relativeTime(entry.ts)}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
