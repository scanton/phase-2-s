type Status = "success" | "failed" | "running";

const config: Record<Status, { icon: string; bg: string; text: string; label: string }> = {
  success: { icon: "✓", bg: "rgba(16,185,129,0.15)", text: "#34d399", label: "success" },
  failed:  { icon: "×", bg: "rgba(239,68,68,0.15)",   text: "#f87171", label: "failed" },
  running: { icon: "●", bg: "rgba(251,191,36,0.15)",   text: "#fbbf24", label: "running" },
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
        backgroundColor: c.bg,
        color: c.text,
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
