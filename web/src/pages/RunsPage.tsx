import { useEffect, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { fetchRuns, fetchActiveRuns } from "../api.ts";
import type { ConductLogEntry, ActiveRun } from "../types.ts";
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
              backgroundColor: "var(--bg-subtle)",
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
    backgroundColor: "var(--bg-surface)",
    borderRadius: "8px",
    minWidth: "120px",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: "11px",
    color: "var(--text-muted)",
    fontFamily: "Geist Mono, monospace",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  };

  const valueStyle: React.CSSProperties = {
    fontSize: "22px",
    fontWeight: 600,
    color: "var(--text-primary)",
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
        <span style={{ ...valueStyle, color: rate >= 70 ? "var(--status-success-text)" : rate >= 40 ? "var(--status-running-text)" : "var(--status-failed-text)" }}>
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
// LiveBadge — pulsing LIVE ● indicator for active run rows
// ---------------------------------------------------------------------------

function LiveBadge() {
  return (
    <span
      aria-label="Live"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        padding: "2px 7px",
        borderRadius: "9999px",
        backgroundColor: "var(--live-bg)",
        color: "var(--live-color)",
        fontSize: "11px",
        fontWeight: 600,
        fontFamily: "Geist Mono, monospace",
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          display: "inline-block",
          width: "6px",
          height: "6px",
          borderRadius: "50%",
          backgroundColor: "var(--accent)",
          animation: "live-pulse 1.2s ease-in-out infinite",
        }}
        aria-hidden="true"
      />
      LIVE
    </span>
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
  const [activeSpecHashes, setActiveSpecHashes] = useState<Set<string>>(new Set());
  const visibleRef = useRef(true);

  // Load runs list
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

  // Poll for active runs every 5s (only when page is visible)
  useEffect(() => {
    const handleVisibility = () => {
      visibleRef.current = document.visibilityState === "visible";
    };
    document.addEventListener("visibilitychange", handleVisibility);

    const pollActive = async () => {
      if (!visibleRef.current) return;
      try {
        const runs = await fetchActiveRuns();
        setActiveSpecHashes(new Set(runs.map((r: ActiveRun) => r.specHash)));
      } catch {
        // Ignore network errors during active-run polling
      }
    };

    void pollActive();
    const id = setInterval(() => { void pollActive(); }, 5000);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  const thStyle: React.CSSProperties = {
    padding: "10px 16px",
    textAlign: "left",
    fontSize: "11px",
    fontFamily: "Geist Mono, monospace",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "var(--text-muted)",
    borderBottom: "1px solid var(--border)",
    whiteSpace: "nowrap",
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", marginBottom: "20px" }}>
        <h1
          style={{
            fontSize: "18px",
            fontWeight: 600,
            color: "var(--text-primary)",
            margin: 0,
            flex: 1,
          }}
        >
          Conduct Runs
        </h1>
        <Link
          to="/runs/new"
          style={{
            padding: "7px 16px",
            fontSize: "13px",
            fontWeight: 600,
            fontFamily: "Geist Mono, monospace",
            backgroundColor: "var(--accent)",
            color: "#fff",
            borderRadius: "8px",
            textDecoration: "none",
            flexShrink: 0,
          }}
        >
          + New Run
        </Link>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            backgroundColor: "rgba(217,119,6,0.12)",
            border: "1px solid rgba(217,119,6,0.3)",
            borderRadius: "8px",
            padding: "12px 16px",
            marginBottom: "20px",
            color: "var(--status-running-text)",
            fontSize: "14px",
          }}
        >
          Failed to load runs: {error}
        </div>
      )}

      {!loading && !error && entries.length === 0 && (
        <div
          style={{
            backgroundColor: "var(--bg-surface)",
            borderRadius: "12px",
            padding: "48px 32px",
            textAlign: "center",
            color: "var(--text-muted)",
          }}
        >
          <div style={{ fontSize: "32px", marginBottom: "12px" }}>~</div>
          <div style={{ fontSize: "16px", fontWeight: 500, color: "var(--text-secondary)", marginBottom: "8px" }}>
            No runs yet
          </div>
          <div style={{ fontSize: "14px", marginBottom: "20px" }}>
            Start your first conductor run to see results here.
          </div>
          <code
            style={{
              display: "inline-block",
              backgroundColor: "var(--bg-base)",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              padding: "8px 14px",
              fontSize: "13px",
              fontFamily: "Geist Mono, monospace",
              color: "var(--accent)",
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
            backgroundColor: "var(--bg-surface)",
            borderRadius: "8px",
            overflow: "hidden",
            border: "1px solid var(--border)",
          }}
        >
          <table aria-busy={loading} aria-label="Conduct runs table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ backgroundColor: "var(--bg-base)" }}>
                <th scope="col" style={thStyle}>Goal</th>
                <th scope="col" style={thStyle}>Status</th>
                <th scope="col" style={thStyle}>Duration</th>
                <th scope="col" style={thStyle}>Subtasks</th>
                <th scope="col" style={thStyle}>When</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
                : entries.map((entry) => {
                    const isLive = activeSpecHashes.has(entry.specHash);
                    return (
                    <tr
                      key={entry.specHash || entry.ts}
                      tabIndex={0}
                      onClick={() => navigate(`/runs/${entry.specHash || entry.ts}`)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          navigate(`/runs/${entry.specHash || entry.ts}`);
                        }
                      }}
                      style={{
                        cursor: "pointer",
                        borderBottom: "1px solid var(--border)",
                        transition: "background-color 0.1s",
                        backgroundColor: isLive ? "var(--live-row-bg)" : undefined,
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLTableRowElement).style.backgroundColor =
                          isLive ? "var(--live-row-bg-hover)" : "var(--bg-subtle)";
                        (e.currentTarget as HTMLTableRowElement).style.opacity = isLive ? "1" : "0.85";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLTableRowElement).style.backgroundColor =
                          isLive ? "var(--live-row-bg)" : "";
                        (e.currentTarget as HTMLTableRowElement).style.opacity = "1";
                      }}
                    >
                      <td
                        style={{
                          padding: "12px 16px",
                          fontSize: "14px",
                          color: "var(--text-primary)",
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
                        {isLive ? <LiveBadge /> : <StatusBadge status={entry.success ? "success" : "failed"} />}
                      </td>
                      <td
                        style={{
                          padding: "12px 16px",
                          fontSize: "13px",
                          color: "var(--text-secondary)",
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
                          color: "var(--text-secondary)",
                          fontFamily: "Geist Mono, monospace",
                        }}
                      >
                        {entry.subtaskCount}
                      </td>
                      <td
                        style={{
                          padding: "12px 16px",
                          fontSize: "13px",
                          color: "var(--text-muted)",
                          whiteSpace: "nowrap",
                        }}
                        title={entry.ts}
                      >
                        {relativeTime(entry.ts)}
                      </td>
                    </tr>
                  );})}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
