import { COMMANDS, SHORTCUTS, DASHBOARD_SECTIONS } from "../data/help.ts";

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const sectionStyle: React.CSSProperties = {
  marginBottom: "36px",
};

const headingStyle: React.CSSProperties = {
  fontSize: "15px",
  fontWeight: 600,
  color: "var(--text-primary)",
  marginBottom: "12px",
  paddingBottom: "8px",
  borderBottom: "1px solid var(--border)",
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "13px",
};

const thStyle: React.CSSProperties = {
  padding: "8px 12px",
  textAlign: "left",
  fontSize: "11px",
  fontFamily: "Geist Mono, monospace",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--text-muted)",
  borderBottom: "1px solid var(--border)",
  backgroundColor: "var(--bg-base)",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid var(--border)",
  color: "var(--text-primary)",
  verticalAlign: "top",
};

const codeStyle: React.CSSProperties = {
  fontFamily: "Geist Mono, monospace",
  fontSize: "12px",
  backgroundColor: "var(--bg-subtle)",
  padding: "2px 6px",
  borderRadius: "4px",
  color: "var(--accent)",
  whiteSpace: "nowrap",
};

// ---------------------------------------------------------------------------
// Getting Started
// ---------------------------------------------------------------------------

function GettingStarted() {
  const steps = [
    {
      num: "1",
      title: "Install",
      body: (
        <>
          <code style={codeStyle}>npm install -g @scanton/phase2s</code>
        </>
      ),
    },
    {
      num: "2",
      title: "Start the dashboard",
      body: (
        <>
          <code style={codeStyle}>phase2s serve</code>
          <span style={{ color: "var(--text-secondary)", marginLeft: "8px", fontSize: "13px" }}>
            — then open{" "}
            <code style={{ ...codeStyle, color: "var(--text-primary)" }}>http://localhost:3010</code>
          </span>
        </>
      ),
    },
    {
      num: "3",
      title: "Run a goal",
      body: (
        <>
          Click <strong>+ New Run</strong> in the dashboard, or run{" "}
          <code style={codeStyle}>phase2s conduct ./my-spec.md</code> from the terminal.
        </>
      ),
    },
  ];

  return (
    <section style={sectionStyle} aria-labelledby="getting-started-heading">
      <h2 id="getting-started-heading" style={headingStyle}>Getting Started</h2>
      <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "16px" }}>
        {steps.map((step) => (
          <li key={step.num} style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "28px",
                height: "28px",
                borderRadius: "50%",
                backgroundColor: "var(--accent)",
                color: "#fff",
                fontSize: "13px",
                fontWeight: 700,
                fontFamily: "Geist Mono, monospace",
                flexShrink: 0,
              }}
            >
              {step.num}
            </span>
            <div>
              <div style={{ fontWeight: 600, color: "var(--text-primary)", marginBottom: "4px", fontSize: "14px" }}>
                {step.title}
              </div>
              <div style={{ color: "var(--text-secondary)", fontSize: "13px" }}>{step.body}</div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function Commands() {
  return (
    <section style={sectionStyle} aria-labelledby="commands-heading">
      <h2 id="commands-heading" style={headingStyle}>Commands</h2>
      <div style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "8px", overflow: "hidden" }}>
        <table style={tableStyle} aria-label="CLI command reference">
          <thead>
            <tr>
              <th style={thStyle}>Command</th>
              <th style={thStyle}>Description</th>
              <th style={thStyle}>Example</th>
            </tr>
          </thead>
          <tbody>
            {COMMANDS.map((cmd) => (
              <tr key={cmd.command}>
                <td style={tdStyle}>
                  <code style={codeStyle}>{cmd.command}</code>
                </td>
                <td style={{ ...tdStyle, color: "var(--text-secondary)" }}>{cmd.description}</td>
                <td style={tdStyle}>
                  <code style={{ ...codeStyle, color: "var(--text-muted)" }}>{cmd.example}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function Dashboard() {
  return (
    <section style={sectionStyle} aria-labelledby="dashboard-heading">
      <h2 id="dashboard-heading" style={headingStyle}>Dashboard</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {DASHBOARD_SECTIONS.map((sec) => (
          <div
            key={sec.name}
            style={{
              backgroundColor: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              padding: "14px 16px",
            }}
          >
            <div style={{ fontWeight: 600, color: "var(--text-primary)", marginBottom: "4px", fontSize: "14px" }}>
              {sec.name}
            </div>
            <div style={{ color: "var(--text-secondary)", fontSize: "13px", lineHeight: "1.5" }}>
              {sec.description}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

function KeyboardShortcuts() {
  return (
    <section style={sectionStyle} aria-labelledby="shortcuts-heading">
      <h2 id="shortcuts-heading" style={headingStyle}>Keyboard Shortcuts</h2>
      <div style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "8px", overflow: "hidden" }}>
        <table style={tableStyle} aria-label="Keyboard shortcuts">
          <thead>
            <tr>
              <th style={thStyle}>Shortcut</th>
              <th style={thStyle}>Action</th>
            </tr>
          </thead>
          <tbody>
            {SHORTCUTS.map((sc) => (
              <tr key={sc.keys}>
                <td style={tdStyle}>
                  <kbd
                    style={{
                      fontFamily: "Geist Mono, monospace",
                      fontSize: "12px",
                      backgroundColor: "var(--bg-base)",
                      border: "1px solid var(--border)",
                      borderRadius: "4px",
                      padding: "2px 8px",
                      color: "var(--text-primary)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {sc.keys}
                  </kbd>
                </td>
                <td style={{ ...tdStyle, color: "var(--text-secondary)" }}>{sc.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function HelpPage() {
  return (
    <div>
      <h1 style={{ fontSize: "18px", fontWeight: 600, color: "var(--text-primary)", margin: "0 0 24px" }}>
        Help
      </h1>
      <GettingStarted />
      <Commands />
      <Dashboard />
      <KeyboardShortcuts />
    </div>
  );
}
