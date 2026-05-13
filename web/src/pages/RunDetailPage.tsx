import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import { fetchRunDetail, createRunStream } from "../api.ts";
import type { RunDetail, RunLogLine, LiveEvent } from "../types.ts";
import StatusBadge from "../components/StatusBadge.tsx";
import CompletionBanner from "../components/CompletionBanner.tsx";

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
  if (isActive) return "var(--accent)";
  return success ? "var(--status-success-text)" : "var(--status-failed-text)";
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NOTIF_PERM_KEY = "phase2s-notifications";
const NOTIF_PROMPTED_KEY = "phase2s-notif-prompted";
const DEFAULT_TAB_TITLE = "Phase2S Dashboard";

// ---------------------------------------------------------------------------
// Notification helpers
// ---------------------------------------------------------------------------

async function requestNotificationPermission(): Promise<void> {
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "default") {
    const perm = await Notification.requestPermission();
    try {
      localStorage.setItem(NOTIF_PERM_KEY, perm);
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
        backgroundColor: "var(--live-bg)",
        color: "var(--live-color)",
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
// ElapsedTimer
// ---------------------------------------------------------------------------

interface ElapsedTimerProps {
  startTs: string;
  isComplete?: boolean;
}

function ElapsedTimer({ startTs, isComplete }: ElapsedTimerProps) {
  const [elapsed, setElapsed] = useState(Date.now() - new Date(startTs).getTime());

  useEffect(() => {
    if (isComplete) return; // Don't tick after completion
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => {
      setElapsed(Date.now() - new Date(startTs).getTime());
    }, 1000);
    return () => clearInterval(id);
  }, [startTs, isComplete]);

  return (
    <span
      style={{ color: "var(--text-secondary)", fontFamily: "Geist Mono, monospace", fontSize: "13px" }}
      title="Elapsed time"
    >
      <span style={{ color: "var(--text-muted)", fontSize: "11px", marginRight: "4px" }}>
        {isComplete ? "DURATION" : "ELAPSED"}
      </span>
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
      <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>
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
    color: "var(--text-muted)",
    borderBottom: "1px solid var(--border)",
    whiteSpace: "nowrap",
  };

  return (
    <div
      style={{
        backgroundColor: "var(--bg-surface)",
        borderRadius: "8px",
        overflow: "hidden",
        border: "1px solid var(--border)",
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ backgroundColor: "var(--bg-base)" }}>
            <th scope="col" style={thStyle}>#</th>
            <th scope="col" style={thStyle}>Name</th>
            <th scope="col" style={thStyle}>Status</th>
            <th scope="col" style={thStyle}>Duration</th>
          </tr>
        </thead>
        <tbody>
          {allRows.map((e, i) => (
            <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
              <td
                style={{
                  padding: "10px 12px",
                  fontSize: "12px",
                  color: "var(--text-muted)",
                  fontFamily: "Geist Mono, monospace",
                }}
              >
                {e.index !== undefined ? e.index + 1 : i + 1}
              </td>
              <td
                style={{
                  padding: "10px 12px",
                  fontSize: "13px",
                  color: "var(--text-primary)",
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
                  color: "var(--text-secondary)",
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
        backgroundColor: "var(--bg-surface)",
        borderRadius: "8px",
        border: "1px solid var(--border)",
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
          color: "var(--text-secondary)",
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
            borderTop: "1px solid var(--border)",
            backgroundColor: "var(--bg-base)",
            maxHeight: "500px",
            overflowY: "auto",
          }}
        >
          <div
            style={{
              fontSize: "13px",
              lineHeight: "1.7",
              color: "var(--text-primary)",
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
        backgroundColor: "var(--bg-surface)",
        border: "1px solid var(--border)",
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
      <div style={{ fontSize: "13px", color: "var(--text-primary)", lineHeight: 1.4 }}>
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
            backgroundColor: "var(--accent)",
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
            border: "1px solid var(--border)",
            backgroundColor: "transparent",
            color: "var(--text-muted)",
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
  const [completionVisible, setCompletionVisible] = useState(false);
  const [showNotifBanner, setShowNotifBanner] = useState(false);
  const [notifGranted, setNotifGranted] = useState(() =>
    typeof Notification !== "undefined" && Notification.permission === "granted"
  );
  const notifPromptedRef = useRef(false);
  const cleanupStreamRef = useRef<(() => void) | null>(null);
  const detailRef = useRef<RunDetail | null>(null);

  // Keep detailRef in sync so handleStreamClose always has fresh data
  useEffect(() => { detailRef.current = detail; }, [detail]);

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
    setCompletionVisible(true);
    // Refresh detail to get final state from conduct log, then notify with
    // fresh data (avoids stale closure on detail + notification fires correctly)
    if (id) {
      fetchRunDetail(id)
        .then((data) => {
          setDetail(data);
          notifyRunComplete(data.entry.goal, data.entry.success);
        })
        .catch(() => {/* ignore */});
    }
  }, [id]); // detail intentionally omitted — use detailRef for sync reads if needed

  // 5-second delayed notification prompt for live runs
  useEffect(() => {
    if (!isLive || notifGranted) return;
    const timer = setTimeout(() => {
      if (
        !notifPromptedRef.current &&
        typeof Notification !== "undefined" &&
        Notification.permission === "default"
      ) {
        const alreadyPrompted = (() => {
          try {
            return !!sessionStorage.getItem(NOTIF_PROMPTED_KEY);
          } catch {
            return false;
          }
        })();
        if (!alreadyPrompted) {
          setShowNotifBanner(true);
          notifPromptedRef.current = true;
        }
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, [isLive, notifGranted]);

  useEffect(() => {
    if (!isLive || !id) return;

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
      document.title = DEFAULT_TAB_TITLE;
    };
  }, [isLive, liveEvents, detail]);

  // Reset title on unmount
  useEffect(() => {
    return () => {
      document.title = DEFAULT_TAB_TITLE;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Notification banner handlers
  // ---------------------------------------------------------------------------

  const handleNotifAllow = async () => {
    setShowNotifBanner(false);
    try {
      sessionStorage.setItem(NOTIF_PROMPTED_KEY, "1");
    } catch {
      // ignore
    }
    await requestNotificationPermission();
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      setNotifGranted(true);
    }
  };

  const handleNotifDismiss = () => {
    setShowNotifBanner(false);
    try {
      sessionStorage.setItem(NOTIF_PROMPTED_KEY, "1");
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
        color: "var(--text-muted)",
        fontSize: "13px",
        textDecoration: "none",
        marginBottom: "24px",
        transition: "color 0.15s",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = "var(--text-secondary)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = "var(--text-muted)"; }}
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
                backgroundColor: "var(--bg-subtle)",
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
            backgroundColor: "var(--status-failed-bg)",
            border: "1px solid var(--status-failed-bg)",
            borderRadius: "8px",
            padding: "16px",
            color: "var(--status-failed-text)",
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
  const runStatus = entry.success ? "success" : "failed";

  return (
    <div>
      {backLink}

      {/* Completion banner */}
      {completionVisible && (
        <CompletionBanner
          success={runStatus === "success"}
          onDismiss={() => setCompletionVisible(false)}
        />
      )}

      {/* Header card with status stripe */}
      <div
        style={{
          backgroundColor: "var(--bg-surface)",
          borderRadius: "8px",
          border: "1px solid var(--border)",
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
              color: "var(--text-primary)",
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
            color: "var(--text-secondary)",
            alignItems: "center",
          }}
        >
          {isLive || liveDone ? (
            <ElapsedTimer startTs={entry.ts} isComplete={liveDone && !isLive} />
          ) : (
            <span title="Wall-clock duration">{formatDuration(entry.durationMs)}</span>
          )}
          <span>{entry.subtaskCount} subtasks</span>
          {entry.rounds > 0 && (
            <span>{entry.rounds} round{entry.rounds !== 1 ? "s" : ""}</span>
          )}
          <span title={entry.ts}>{formatDate(entry.ts)}</span>
          {entry.dryRun && (
            <span style={{ color: "var(--status-running-text)" }}>dry-run</span>
          )}
          {liveDone && !isLive && (
            <span style={{ color: "var(--status-success-text)", fontSize: "12px" }}>● completed</span>
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
            color: "var(--text-muted)",
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
                color: "var(--accent)",
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
          <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>No run log available.</p>
        )}
      </div>

      {/* Re-run hint */}
      <div
        style={{
          backgroundColor: "var(--bg-surface)",
          borderRadius: "8px",
          border: "1px solid var(--border)",
          padding: "16px",
          marginTop: "32px",
        }}
      >
        <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "8px", fontFamily: "Geist Mono, monospace" }}>
          Re-run this goal
        </div>
        <code
          style={{
            display: "block",
            backgroundColor: "var(--bg-base)",
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
