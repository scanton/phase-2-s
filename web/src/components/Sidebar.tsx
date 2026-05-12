import { NavLink } from "react-router-dom";

const navItems = [
  { label: "Runs", path: "/", comingSoon: false },
  { label: "Live", path: "/live", comingSoon: true },
  { label: "Config", path: "/config", comingSoon: true },
  { label: "Help", path: "/help", comingSoon: true },
];

export default function Sidebar() {
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
      {navItems.map((item) =>
        item.comingSoon ? (
          <span
            key={item.label}
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
            {item.label}
          </span>
        ) : (
          <NavLink
            key={item.label}
            to={item.path}
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
            {item.label}
          </NavLink>
        )
      )}
    </nav>
  );
}
