import { useEffect } from "react";

interface CompletionBannerProps {
  success: boolean;
  onDismiss: () => void;
}

export default function CompletionBanner({ success, onDismiss }: CompletionBannerProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 3000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      onClick={onDismiss}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "10px 16px",
        borderRadius: "8px",
        marginBottom: "16px",
        fontSize: "14px",
        fontWeight: 500,
        cursor: "pointer",
        animation: "banner-slide-in 0.2s ease",
        backgroundColor: success ? "var(--status-success-bg)" : "var(--status-failed-bg)",
        color: success ? "var(--status-success-text)" : "var(--status-failed-text)",
        border: `1px solid ${success ? "var(--status-success-bg)" : "var(--status-failed-bg)"}`,
      }}
    >
      <span aria-hidden="true">{success ? "✓" : "×"}</span>
      {success ? "Run complete — success" : "Run failed"}
    </div>
  );
}
