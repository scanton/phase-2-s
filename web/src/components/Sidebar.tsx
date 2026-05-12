import { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { fetchActiveRuns } from "../api.ts";
import type { ActiveRun } from "../types.ts";

export default function Sidebar() {
  const navigate = useNavigate();
  const [activeRuns, setActiveRuns] = useState<ActiveRun[]>([]);

  // Poll for active runs to power the Live nav item
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const runs = await fetchActiveRuns();
        if (!cancelled) setActiveRuns(runs);
      } catch {
        // Ignore — server may not be ready
      }
    };
    void poll();
    const id = setInterval(() => { void poll(); }, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const handleLiveClick = () => {
    if (activeRuns.length > 0) {
      navigate(`/runs/${activeRuns[0].specHash}`);
    }
  };

  const hasLive = activeRuns.length > 0;

  return (
    <nav
      aria-label="Main navigation"
      style={{
        width: "220px",
        minWidth: "220px",
        backgroundColor: "#27272a",
        borderRight: "1px solid #3f3f46",
        padding: "16px 0",
        display: "flex",
        flexDirection: "column",
        gap: "4px",
      }}
    >
      <div
        style={{
          padding: "8px 16px 16px",
          fontFamily: "Geist Mono, monospace",
          fontSize: "13px",
          color: "#f4f4f5",
          borderBottom: "1px solid #3f3f46",
          marginBottom: "8px",
        }}
      >
        Phase2S
      </div>

      {/* Runs */}
      <NavLink
        to="/"
        end
        style={({ isActive }) => ({
          display: "block",
          padding: "8px 16px",
          fontSize: "14px",
          textDecoration: "none",
          color: isActive ? "#818cf8" : "#a1a1aa",
          backgroundColor: isActive ? "rgba(99,102,241,0.1)" : "transparent",
          borderLeft: isActive ? "2px solid #6366f1" : "2px solid transparent",
        })}
      >
        Runs
      </NavLink>

      {/* Live — unlocked in Sprint 95 */}
      {hasLive ? (
        <button
          onClick={handleLiveClick}
          title={`${activeRuns.length} run${activeRuns.length > 1 ? "s" : ""} live`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 14px",
            paddingLeft: "14px",
            borderLeft: "2px solid #6366f1",
            borderTop: "none",
            borderRight: "none",
            borderBottom: "none",
            fontSize: "14px",
            color: "#818cf8",
            backgroundColor: "rgba(99,102,241,0.1)",
            cursor: "pointer",
            width: "100%",
            textAlign: "left",
            fontFamily: "inherit",
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: "7px",
              height: "7px",
              borderRadius: "50%",
              backgroundColor: "#6366f1",
              animation: "live-pulse 1.2s ease-in-out infinite",
              flexShrink: 0,
            }}
            aria-hidden="true"
          />
          Live
        </button>
      ) : (
        <span
          title="No active runs"
          style={{
            display: "block",
            padding: "8px 16px",
            fontSize: "14px",
            color: "#a1a1aa",
            opacity: 0.4,
            cursor: "default",
            userSelect: "none",
          }}
        >
          Live
        </span>
      )}

      {/* Config — Coming soon */}
      <span
        title="Coming soon"
        style={{
          display: "block",
          padding: "8px 16px",
          fontSize: "14px",
          color: "#a1a1aa",
          opacity: 0.4,
          cursor: "default",
          userSelect: "none",
        }}
      >
        Config
      </span>

      {/* Help — Coming soon */}
      <span
        title="Coming soon"
        style={{
          display: "block",
          padding: "8px 16px",
          fontSize: "14px",
          color: "#a1a1aa",
          opacity: 0.4,
          cursor: "default",
          userSelect: "none",
        }}
      >
        Help
      </span>
    </nav>
  );
}
