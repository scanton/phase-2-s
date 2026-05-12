import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import { fetchRunDetail, createRunStream } from "../api.ts";
import type { RunDetail, RunLogLine, LiveEvent } from "../types.ts";
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

function statusStripeColor(success: boolean, isActive: boolean): string {
  if (isActive) return "#6366f1"; // indigo while live
  return success ? "#10b981" : "#ef4444";
}

// ---------------------------------------------------------------------------
// Notification helpers
// ---------------------------------------------------------------------------

async function requestNotificationPermission(): Promise<void> {
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "default") {
    const perm = await Notification.requestPermission();
    try {
      localStorage.setItem("phase2s-notifications", perm);
    } catch {
      // localStorage not available
    }
  }
}

function notifyRunComplete(goal: string, success: boolean): void {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  new Notification(`Phase2S: ${success ? "✓" : "✗"} ${goal.slice(0, 60)}`, {
    body: success ? "All subtasks complete." : "Run finished with errors.",
  });
}

// ---------------------------------------------------------------------------
// LiveBadge
// ---------------------------------------------------------------------------

function LiveBadge() {
  return (
    <span
      aria-label="Run in progress"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        padding: "3px 8px",
        borderRadius: "9999px",
        backgroundColor: "rgba(99,102,241,0.15)",
        color: "#818cf8",
        fontSize: "11px",
        fontWeight: 700,
        fontFamily: "Geist Mono, monospace",
        letterSpacing: "0.04em",
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          display: "inline-block",
          width: "6px",
          height: "6px",
          borderRadius: "50%",
          backgroundColor: "#6366f1",
          animation: "live-pulse 1.2s ease-in-out infinite",
        }}
        aria-hidden="true"
      />
      LIVE
    </span>
  );
}

// ---------------------------------------------------------------------------
// ElapsedTimer
// ---------------------------------------------------------------------------

interface ElapsedTimerProps {
  startTs: string;
}

function ElapsedTimer({ startTs }: ElapsedTimerProps) {
  const [elapsed, setElapsed] = useState(Date.now() - new Date(startTs).getTime());

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Date.now() - new Date(startTs).getTime());
    }, 1000);
    return () => clearInterval(id);
  }, [startTs]);

  return (
    <span
      style={{
        color: "#a1a1aa",
        fontFamily: "Geist Mono, monospace",
        fontSize: "13px",
      }}
      title="Elapsed time"
    >
      {formatDuration(elapsed)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// SubtasksTable
// ---------------------------------------------------------------------------

interface SubtasksTableProps {
  runLog: RunLogLine[];
  liveEvents?: LiveEvent[];
}

function SubtasksTable({ runLog, liveEvents = [] }: SubtasksTableProps) {
  // Merge historic events with live-appended events
  const historicWorker = runLog.filter(
    (e) => e.event === "worker_completed" || e.event === "subtask_completed"
  );
  const liveWorker = liveEvents.filter(
    (e) => e.event === "worker_completed" || e.event === "subtask_completed"
  ) as RunLogLine[];

  // De-duplicate by index: live events may replay items already in runLog
  const seen = new Set(historicWorker.map((e) => e.index));
  const newFromLive = liveWorker.filter((e) => e.index === undefined || !seen.has(e.index));
  const workerEvents = [...historicWorker, ...newFromLive];

  // Also show started-but-not-completed subtasks from live stream
  const startedIndices = new Set(
    liveEvents
      .filter((e) => e.event === "worker_started" || e.event === "subtask_started")
      .map((e) => e.index)
  );
  const completedIndices = new Set(workerEvents.map((e) => e.index));
  const inProgress = liveEvents
    .filter(
      (e) =>
        (e.event === "worker_started" || e.event === "subtask_started") &&
        !completedIndices.has(e.index)
    )
    .map((e) => ({ ...e, status: "running" } as RunLogLine));

  const allRows = [...workerEvents, ...inProgress];

  if (allRows.length === 0) {
    return (
      <p style={{ color: "#71717a", fontSize: "14px" }}>
        {liveEvents.length > 0
          ? "Waiting for subtasks…"
          : "No subtask events found in run log."}
      </p>
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
          {allRows.map((e, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #3f3f46" }}>
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
            <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{spec}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NotificationBanner — subtle opt-in toast (shown once per session)
// ---------------------------------------------------------------------------

interface NotificationBannerProps {
  onAllow: () => void;
  onDismiss: () => void;
}

function NotificationBanner({ onAllow, onDismiss }: NotificationBannerProps) {
  return (
    <div
      role="complementary"
      aria-label="Notification permission"
      style={{
        position: "fixed",
        bottom: "24px",
        right: "24px",
        backgroundColor: "#27272a",
        border: "1px solid #3f3f46",
        borderRadius: "10px",
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        zIndex: 1000,
        boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
        maxWidth: "300px",
      }}
    >
      <div style={{ fontSize: "13px", color: "#d4d4d8", lineHeight: 1.4 }}>
        Get notified when this run finishes?
      </div>
      <div style={{ display: "flex", gap: "8px" }}>
        <button
          onClick={onAllow}
          style={{
            flex: 1,
            padding: "6px 12px",
            borderRadius: "6px",
            border: "none",
            backgroundColor: "#6366f1",
            color: "#fff",
            fontSize: "12px",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Allow
        </button>
        <button
          onClick={onDismiss}
          style={{
            flex: 1,
            padding: "6px 12px",
            borderRadius: "6px",
            border: "1px solid #3f3f46",
            backgroundColor: "transparent",
            color: "#71717a",
            fontSize: "12px",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Not now
        </button>
      </div>
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

  // Live state
  const [isLive, setIsLive] = useState(false);
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [liveDone, setLiveDone] = useState(false);
  const [showNotifBanner, setShowNotifBanner] = useState(false);
  const notifPromptedRef = useRef(false);
  const cleanupStreamRef = useRef<(() => void) | null>(null);

  // Load run detail
  useEffect(() => {
    if (!id) return;
    fetchRunDetail(id)
      .then((data) => {
        setDetail(data);
        setLoading(false);
        if (data.isActive) {
          setIsLive(true);
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [id]);

  // Open SSE stream when live
  const handleStreamClose = useCallback(() => {
    setIsLive(false);
    setLiveDone(true);
    // Refresh detail to get final state from conduct log
    if (id) {
      fetchRunDetail(id)
        .then((data) => setDetail(data))
        .catch(() => {/* ignore */});
    }
    // Fire completion notification
    if (detail) {
      notifyRunComplete(detail.entry.goal, detail.entry.success);
    }
  }, [id, detail]);

  useEffect(() => {
    if (!isLive || !id) return;

    // Show notification opt-in banner once per session
    if (
      !notifPromptedRef.current &&
      typeof Notification !== "undefined" &&
      Notification.permission === "default"
    ) {
      const alreadyPrompted = (() => {
        try {
          return !!sessionStorage.getItem("phase2s-notif-prompted");
        } catch {
          return false;
        }
      })();
      if (!alreadyPrompted) {
        setShowNotifBanner(true);
        notifPromptedRef.current = true;
      }
    }

    const cleanup = createRunStream(
      id,
      (ev: LiveEvent) => setLiveEvents((prev) => [...prev, ev]),
      handleStreamClose,
    );
    cleanupStreamRef.current = cleanup;
    return () => {
      cleanup();
      cleanupStreamRef.current = null;
    };
  }, [isLive, id, handleStreamClose]);

  // Tab title updates during live run
  useEffect(() => {
    if (!isLive || !detail) return;
    const completedCount = liveEvents.filter(
      (e) =>
        e.event === "worker_completed" || e.event === "subtask_completed"
    ).length;
    const totalCount = detail.entry.subtaskCount || "?";
    document.title = `↺ ${completedCount}/${totalCount} — Phase2S`;
    return () => {
      document.title = "Phase2S Dashboard";
    };
  }, [isLive, liveEvents, detail]);

  // Reset title on unmount
  useEffect(() => {
    return () => {
      document.title = "Phase2S Dashboard";
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Notification banner handlers
  // ---------------------------------------------------------------------------

  const handleNotifAllow = async () => {
    setShowNotifBanner(false);
    try {
      sessionStorage.setItem("phase2s-notif-prompted", "1");
    } catch {
      // ignore
    }
    await requestNotificationPermission();
  };

  const handleNotifDismiss = () => {
    setShowNotifBanner(false);
    try {
      sessionStorage.setItem("phase2s-notif-prompted", "1");
    } catch {
      // ignore
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const backLink = (
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
  );

  if (loading) {
    return (
      <div>
        {backLink}
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
        {backLink}
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
  const stripeColor = statusStripeColor(entry.success, isLive);

  return (
    <div>
      {backLink}

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
          {isLive ? (
            <LiveBadge />
          ) : (
            <StatusBadge status={entry.success ? "success" : "failed"} large />
          )}
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
            alignItems: "center",
          }}
        >
          {isLive ? (
            <ElapsedTimer startTs={entry.ts} />
          ) : (
            <span title="Wall-clock duration">{formatDuration(entry.durationMs)}</span>
          )}
          <span>{entry.subtaskCount} subtasks</span>
          {entry.rounds > 0 && (
            <span>{entry.rounds} round{entry.rounds !== 1 ? "s" : ""}</span>
          )}
          <span title={entry.ts}>{formatDate(entry.ts)}</span>
          {entry.dryRun && (
            <span style={{ color: "#fbbf24" }}>dry-run</span>
          )}
          {liveDone && !isLive && (
            <span style={{ color: "#34d399", fontSize: "12px" }}>● completed</span>
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
          {isLive && liveEvents.length === 0 && (
            <span
              style={{
                marginLeft: "10px",
                fontSize: "11px",
                color: "#6366f1",
                fontWeight: 400,
                animation: "pulse 1.5s infinite",
              }}
            >
              watching…
            </span>
          )}
        </h2>
        {runLog !== null || liveEvents.length > 0 ? (
          <SubtasksTable runLog={runLog ?? []} liveEvents={liveEvents} />
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

      {/* Notification opt-in banner */}
      {showNotifBanner && (
        <NotificationBanner
          onAllow={handleNotifAllow}
          onDismiss={handleNotifDismiss}
        />
      )}
    </div>
  );
}
