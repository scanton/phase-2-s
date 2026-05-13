type Status = "success" | "failed" | "running";

const config: Record<Status, { icon: string; bgVar: string; textVar: string; label: string }> = {
  success: { icon: "✓", bgVar: "var(--status-success-bg)", textVar: "var(--status-success-text)", label: "success" },
  failed:  { icon: "×", bgVar: "var(--status-failed-bg)",  textVar: "var(--status-failed-text)",  label: "failed" },
  running: { icon: "●", bgVar: "var(--status-running-bg)", textVar: "var(--status-running-text)", label: "running" },
};

interface Props {
  status: Status | string;
  large?: boolean;
}

function normalizeStatus(s: string): Status {
  if (s === "success" || s === "passed") return "success";
  if (s === "failed") return "failed";
  return "running";
}

export default function StatusBadge({ status, large }: Props) {
  const norm = normalizeStatus(status);
  const c = config[norm];
  const size = large ? "13px" : "11px";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        padding: large ? "3px 8px" : "2px 6px",
        borderRadius: "9999px",
        backgroundColor: c.bgVar,
        color: c.textVar,
        fontSize: size,
        fontWeight: 500,
        fontFamily: "Geist Mono, monospace",
        whiteSpace: "nowrap",
      }}
    >
      <span style={norm === "running" ? { animation: "pulse 1.5s infinite" } : undefined}>
        {c.icon}
      </span>
      {c.label}
    </span>
  );
}
