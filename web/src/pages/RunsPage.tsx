import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { fetchRuns, fetchActiveRuns } from "../api.ts";
import type { ConductLogEntry, ActiveRun } from "../types.ts";
import StatusBadge from "../components/StatusBadge.tsx";
import { findGitRoot } from "../utils/gitRoot.ts";

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
  const diffMs = Math.max(0, now - then);
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
// Filter toolbar
// ---------------------------------------------------------------------------

interface FilterToolbarProps {
  search: string;
  status: string;
  after: string;
  before: string;
  hasFilters: boolean;
  onSearchChange: (v: string) => void;
  onStatusChange: (v: string) => void;
  onAfterChange: (v: string) => void;
  onBeforeChange: (v: string) => void;
  onClear: () => void;
}

function FilterToolbar({
  search,
  status,
  after,
  before,
  hasFilters,
  onSearchChange,
  onStatusChange,
  onAfterChange,
  onBeforeChange,
  onClear,
}: FilterToolbarProps) {
  const inputStyle: React.CSSProperties = {
    padding: "6px 10px",
    fontSize: "13px",
    fontFamily: "Geist Mono, monospace",
    backgroundColor: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    color: "var(--text-primary)",
    outline: "none",
  };

  return (
    <div
      role="search"
      aria-label="Filter runs"
      style={{
        display: "flex",
        gap: "8px",
        marginBottom: "16px",
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      <input
        type="search"
        aria-label="Search by goal"
        placeholder="Search by goal..."
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        style={{ ...inputStyle, minWidth: "200px" }}
      />
      <select
        aria-label="Filter by status"
        value={status}
        onChange={(e) => onStatusChange(e.target.value)}
        style={{ ...inputStyle, cursor: "pointer" }}
      >
        <option value="">All statuses</option>
        <option value="success">Success</option>
        <option value="failure">Failure</option>
        <option value="active">Active</option>
        <option value="unknown">Unknown</option>
      </select>
      <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", color: "var(--text-muted)", fontFamily: "Geist Mono, monospace" }}>
        From
        <input
          type="date"
          aria-label="From date"
          value={after}
          onChange={(e) => onAfterChange(e.target.value)}
          style={{ ...inputStyle }}
        />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", color: "var(--text-muted)", fontFamily: "Geist Mono, monospace" }}>
        To
        <input
          type="date"
          aria-label="To date"
          value={before}
          onChange={(e) => onBeforeChange(e.target.value)}
          style={{ ...inputStyle }}
        />
      </label>
      {hasFilters && (
        <button
          type="button"
          onClick={onClear}
          style={{
            padding: "6px 12px",
            fontSize: "12px",
            fontFamily: "Geist Mono, monospace",
            backgroundColor: "transparent",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            color: "var(--text-secondary)",
            cursor: "pointer",
          }}
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Run row
// ---------------------------------------------------------------------------

interface RunRowProps {
  entry: ConductLogEntry;
  isLive: boolean;
}

function RunRow({ entry, isLive }: RunRowProps) {
  const navigate = useNavigate();

  return (
    <tr
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
        {isLive
          ? <LiveBadge />
          : entry.dryRun
            ? <StatusBadge status="unknown" />
            : <StatusBadge status={entry.success ? "success" : "failed"} />}
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
  );
}

// ---------------------------------------------------------------------------
// Runs table (shared across project groups)
// ---------------------------------------------------------------------------

interface RunsTableProps {
  entries: ConductLogEntry[];
  loading: boolean;
  activeSpecHashes: Set<string>;
}

function RunsTable({ entries, loading, activeSpecHashes }: RunsTableProps) {
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
            : entries.map((entry) => (
                <RunRow
                  key={entry.specHash || entry.ts}
                  entry={entry}
                  isLive={activeSpecHashes.has(entry.specHash)}
                />
              ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 300;

export default function RunsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  // Filter state — initialised from URL params
  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [status, setStatus] = useState(searchParams.get("status") ?? "");
  const [after, setAfter] = useState(searchParams.get("after") ?? "");
  const [before, setBefore] = useState(searchParams.get("before") ?? "");

  // Data state
  const [entries, setEntries] = useState<ConductLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSpecHashes, setActiveSpecHashes] = useState<Set<string>>(new Set());
  const visibleRef = useRef(true);

  // Track the pending filter values for debounce
  const pendingSearch = useRef(search);
  const pendingStatus = useRef(status);
  const pendingAfter = useRef(after);
  const pendingBefore = useRef(before);

  // Fetch function — called by debounce timer
  const abortRef = useRef<AbortController | null>(null);

  const doFetch = useCallback((s: string, st: string, a: string, b: string) => {
    // Cancel any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Build server-side params (only search, success/failure status, after, before)
    const params = new URLSearchParams();
    if (s) params.set("search", s);
    if (st === "success" || st === "failure") params.set("status", st);
    if (a) params.set("after", `${a}T00:00:00.000Z`);
    if (b) params.set("before", `${b}T23:59:59.999Z`);

    // Update URL (replace so back button skips filter states)
    // Only write server-accepted params to URL; active/unknown are client-side only
    const urlParams = new URLSearchParams();
    if (s) urlParams.set("search", s);
    if (st === "success" || st === "failure") urlParams.set("status", st);
    if (a) urlParams.set("after", a);
    if (b) urlParams.set("before", b);
    setSearchParams(urlParams, { replace: true });

    setLoading(true);
    setError(null);

    fetchRuns(params.toString() ? params : undefined, controller.signal)
      .then((data) => {
        setEntries(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [setSearchParams]);

  // Debounce timer ref
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleRefetch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      doFetch(
        pendingSearch.current,
        pendingStatus.current,
        pendingAfter.current,
        pendingBefore.current,
      );
    }, DEBOUNCE_MS);
  }, [doFetch]);

  // Initial load
  useEffect(() => {
    doFetch(search, status, after, before);
    return () => {
      abortRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional mount-only effect; doFetch is stable via useCallback
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

  // Handler factories that update both local state and pending refs, then debounce
  const handleSearch = useCallback((v: string) => {
    setSearch(v);
    pendingSearch.current = v;
    scheduleRefetch();
  }, [scheduleRefetch]);

  const handleStatus = useCallback((v: string) => {
    setStatus(v);
    pendingStatus.current = v;
    scheduleRefetch();
  }, [scheduleRefetch]);

  const handleAfter = useCallback((v: string) => {
    setAfter(v);
    pendingAfter.current = v;
    scheduleRefetch();
  }, [scheduleRefetch]);

  const handleBefore = useCallback((v: string) => {
    setBefore(v);
    pendingBefore.current = v;
    scheduleRefetch();
  }, [scheduleRefetch]);

  const handleClear = useCallback(() => {
    setSearch("");
    setStatus("");
    setAfter("");
    setBefore("");
    pendingSearch.current = "";
    pendingStatus.current = "";
    pendingAfter.current = "";
    pendingBefore.current = "";
    if (debounceRef.current) clearTimeout(debounceRef.current);
    doFetch("", "", "", "");
  }, [doFetch]);

  const hasFilters = !!(search || status || after || before);

  // Client-side filter for active/unknown status (server doesn't handle these)
  const visibleEntries = useMemo(() => entries.filter((e) => {
    if (status === "active") return activeSpecHashes.has(e.specHash);
    if (status === "unknown") return !!e.dryRun;
    return true;
  }), [entries, status, activeSpecHashes]);

  // Project grouping — only when 2+ distinct git roots are present.
  // showGroups is derived from ALL entries (pre-filter) so layout is stable
  // regardless of which filter is active.
  const groups = useMemo(() => groupByGitRoot(visibleEntries), [visibleEntries]);
  const showGroups = useMemo(() => groupByGitRoot(entries).size >= 2, [entries]);

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

      <FilterToolbar
        search={search}
        status={status}
        after={after}
        before={before}
        hasFilters={hasFilters}
        onSearchChange={handleSearch}
        onStatusChange={handleStatus}
        onAfterChange={handleAfter}
        onBeforeChange={handleBefore}
        onClear={handleClear}
      />

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

      {!loading && !error && visibleEntries.length === 0 && (
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
          {hasFilters ? (
            <>
              <div style={{ fontSize: "16px", fontWeight: 500, color: "var(--text-secondary)", marginBottom: "8px" }}>
                No runs match your filters.
              </div>
              <button
                type="button"
                onClick={handleClear}
                style={{
                  padding: "7px 14px",
                  fontSize: "13px",
                  fontFamily: "Geist Mono, monospace",
                  backgroundColor: "transparent",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  color: "var(--text-secondary)",
                  cursor: "pointer",
                  marginTop: "8px",
                }}
              >
                Clear filters
              </button>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      )}

      {(!loading || entries.length > 0) && visibleEntries.length > 0 && (
        <StatBar entries={visibleEntries} />
      )}

      {(loading || visibleEntries.length > 0) && (
        showGroups
          ? Array.from(groups.entries()).map(([root, groupEntries]) => (
              <div key={root} style={{ marginBottom: "28px" }}>
                <div
                  style={{
                    fontSize: "12px",
                    fontFamily: "Geist Mono, monospace",
                    color: "var(--text-muted)",
                    marginBottom: "8px",
                    padding: "0 2px",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  {abbreviatePath(root)}
                </div>
                <RunsTable
                  entries={groupEntries}
                  loading={loading && groupEntries.length === 0}
                  activeSpecHashes={activeSpecHashes}
                />
              </div>
            ))
          : <RunsTable
              entries={loading ? [] : visibleEntries}
              loading={loading}
              activeSpecHashes={activeSpecHashes}
            />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Project grouping helpers
// ---------------------------------------------------------------------------

function groupByGitRoot(entries: ConductLogEntry[]): Map<string, ConductLogEntry[]> {
  const map = new Map<string, ConductLogEntry[]>();
  for (const entry of entries) {
    const root = findGitRoot(entry.specPath);
    const existing = map.get(root);
    if (existing) {
      existing.push(entry);
    } else {
      map.set(root, [entry]);
    }
  }
  return map;
}

function abbreviatePath(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~") || p;
}
