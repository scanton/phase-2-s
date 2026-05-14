import { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  TableCellsIcon,
  SignalIcon,
  Cog6ToothIcon,
  QuestionMarkCircleIcon,
  SunIcon,
  MoonIcon,
  ComputerDesktopIcon,
  XMarkIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";
import { fetchActiveRuns } from "../api.ts";
import type { ActiveRun } from "../types.ts";
import { useTheme, type Theme } from "../hooks/useTheme.ts";

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const THEME_OPTIONS: { value: Theme; label: string; Icon: React.ComponentType<any> }[] = [
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "system", label: "System", Icon: ComputerDesktopIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
];

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const navigate = useNavigate();
  const [activeRuns, setActiveRuns] = useState<ActiveRun[]>([]);
  const { theme, setTheme } = useTheme();

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
      onClose();
    }
  };

  const hasLive = activeRuns.length > 0;

  const navItemBase: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 14px",
    fontSize: "14px",
    textDecoration: "none",
    cursor: "pointer",
    width: "100%",
    textAlign: "left" as const,
    fontFamily: "inherit",
    background: "none",
    border: "none",
    borderLeft: "2px solid transparent",
  };

  const cycleTheme = () => {
    const order: Theme[] = ["light", "system", "dark"];
    const next = order[(order.indexOf(theme) + 1) % order.length];
    setTheme(next);
  };

  const ThemeIcon = THEME_OPTIONS.find(o => o.value === theme)?.Icon ?? ComputerDesktopIcon;
  const themeLabel = THEME_OPTIONS.find(o => o.value === theme)?.label ?? "System";

  return (
    <nav
      aria-label="Main navigation"
      className={`sidebar${isOpen ? " sidebar-open" : ""}`}
    >
      {/* Close button (mobile overlay) — only visible on mobile via CSS in parent context */}
      <button
        onClick={onClose}
        aria-label="Close navigation menu"
        style={{
          position: "absolute",
          top: "12px",
          right: "12px",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--text-secondary)",
          padding: "4px",
          display: "none",
        }}
        className="sidebar-close-btn"
      >
        <XMarkIcon width={18} height={18} aria-hidden="true" />
      </button>

      {/* Brand */}
      <div
        className="sidebar-brand"
        style={{
          padding: "8px 16px 16px",
          fontFamily: "Geist Mono, monospace",
          fontSize: "13px",
          color: "var(--text-primary)",
          borderBottom: "1px solid var(--border)",
          marginBottom: "8px",
        }}
      >
        Phase2S
      </div>

      {/* New Run — primary action */}
      <NavLink
        to="/runs/new"
        onClick={onClose}
        style={({ isActive }) => ({
          ...navItemBase,
          color: isActive ? "var(--accent-hover)" : "var(--accent)",
          backgroundColor: isActive ? "var(--accent-dim)" : "transparent",
          borderLeft: isActive ? "2px solid var(--accent)" : "2px solid transparent",
          fontWeight: 600,
        })}
      >
        <PlusIcon width={16} height={16} aria-hidden="true" className="sidebar-icon" style={{ flexShrink: 0 }} />
        <span className="sidebar-label">New Run</span>
      </NavLink>

      {/* Runs */}
      <NavLink
        to="/"
        end
        onClick={onClose}
        style={({ isActive }) => ({
          ...navItemBase,
          color: isActive ? "var(--accent-hover)" : "var(--text-secondary)",
          backgroundColor: isActive ? "var(--accent-dim)" : "transparent",
          borderLeft: isActive ? "2px solid var(--accent)" : "2px solid transparent",
        })}
      >
        <TableCellsIcon width={16} height={16} aria-hidden="true" className="sidebar-icon" style={{ flexShrink: 0 }} />
        <span className="sidebar-label">Runs</span>
      </NavLink>

      {/* Live */}
      {hasLive ? (
        <button
          onClick={handleLiveClick}
          title={`${activeRuns.length} run${activeRuns.length > 1 ? "s" : ""} live`}
          style={{
            ...navItemBase,
            color: "var(--live-color)",
            backgroundColor: "var(--live-bg)",
            borderLeft: "2px solid var(--accent)",
          }}
        >
          <span
            className="sidebar-label"
            style={{
              display: "inline-block",
              width: "7px",
              height: "7px",
              borderRadius: "50%",
              backgroundColor: "var(--accent)",
              animation: "live-pulse 1.2s ease-in-out infinite",
              flexShrink: 0,
            }}
            aria-hidden="true"
          />
          <SignalIcon width={16} height={16} aria-hidden="true" className="sidebar-icon" style={{ flexShrink: 0 }} />
          <span className="sidebar-label">
            Live{activeRuns.length > 1 ? ` (${activeRuns.length})` : ""}
          </span>
        </button>
      ) : (
        <span
          title="No active runs"
          style={{
            ...navItemBase,
            display: "flex",
            color: "var(--text-secondary)",
            opacity: 0.4,
            cursor: "default",
            userSelect: "none",
          }}
        >
          <SignalIcon width={16} height={16} aria-hidden="true" className="sidebar-icon" style={{ flexShrink: 0 }} />
          <span className="sidebar-label">Live</span>
        </span>
      )}

      {/* Config */}
      <NavLink
        to="/config"
        onClick={onClose}
        style={({ isActive }) => ({
          ...navItemBase,
          color: isActive ? "var(--accent-hover)" : "var(--text-secondary)",
          backgroundColor: isActive ? "var(--accent-dim)" : "transparent",
          borderLeft: isActive ? "2px solid var(--accent)" : "2px solid transparent",
        })}
      >
        <Cog6ToothIcon width={16} height={16} aria-hidden="true" className="sidebar-icon" style={{ flexShrink: 0 }} />
        <span className="sidebar-label">Config</span>
      </NavLink>

      {/* Help */}
      <NavLink
        to="/help"
        onClick={onClose}
        style={({ isActive }) => ({
          ...navItemBase,
          color: isActive ? "var(--accent-hover)" : "var(--text-secondary)",
          backgroundColor: isActive ? "var(--accent-dim)" : "transparent",
          borderLeft: isActive ? "2px solid var(--accent)" : "2px solid transparent",
        })}
      >
        <QuestionMarkCircleIcon width={16} height={16} aria-hidden="true" className="sidebar-icon" style={{ flexShrink: 0 }} />
        <span className="sidebar-label">Help</span>
      </NavLink>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Theme toggle */}
      <button
        onClick={cycleTheme}
        aria-label={`Theme: ${themeLabel}. Click to cycle.`}
        title={`Theme: ${themeLabel}`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "10px 14px",
          borderTop: "1px solid var(--border)",
          borderLeft: "none",
          borderRight: "none",
          borderBottom: "none",
          background: "none",
          color: "var(--text-secondary)",
          fontSize: "13px",
          fontFamily: "inherit",
          cursor: "pointer",
          width: "100%",
          textAlign: "left",
        }}
      >
        <ThemeIcon width={15} height={15} aria-hidden="true" style={{ flexShrink: 0 }} />
        <span className="sidebar-label">{themeLabel}</span>
      </button>
    </nav>
  );
}
