/**
 * phase2s web dashboard — New Run page (Sprint 98)
 *
 * Guided form for starting a conduct run from the browser:
 *   - Goal textarea
 *   - Template picker (6 bundled templates + free-form)
 *   - Model tier toggle (Fast | Smart)
 *   - Parallel toggle
 *   - Lint button (advisory — Run button stays enabled regardless)
 *   - Run button → POST /api/runs → redirect to /runs/:id live view
 */

import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { postLint, postRun } from "../api.ts";
import type { LintResult } from "../types.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEMPLATES = [
  { value: "", label: "None (free-form goal)" },
  { value: "auth", label: "auth — Authentication Feature" },
  { value: "api", label: "api — REST API Endpoint" },
  { value: "bug", label: "bug — Bug Fix" },
  { value: "refactor", label: "refactor — Code Refactor" },
  { value: "test", label: "test — Test Coverage" },
  { value: "cli", label: "cli — CLI Command" },
] as const;

type ModelTier = "fast" | "smart";

// ---------------------------------------------------------------------------
// Styles (inline — matches existing page pattern)
// ---------------------------------------------------------------------------

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "12px",
  fontFamily: "Geist Mono, monospace",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "var(--text-muted)",
  marginBottom: "6px",
};

const inputBase: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  backgroundColor: "var(--bg-base)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  color: "var(--text-primary)",
  fontFamily: "inherit",
  fontSize: "14px",
  padding: "10px 12px",
  outline: "none",
};

const sectionStyle: React.CSSProperties = {
  marginBottom: "24px",
};

// ---------------------------------------------------------------------------
// SegmentedControl — Fast | Smart model tier toggle
// ---------------------------------------------------------------------------

interface SegmentedControlProps {
  value: ModelTier;
  onChange: (v: ModelTier) => void;
}

function SegmentedControl({ value, onChange }: SegmentedControlProps) {
  const options: ModelTier[] = ["fast", "smart"];
  return (
    <div
      role="group"
      aria-label="Model tier"
      style={{
        display: "inline-flex",
        border: "1px solid var(--border)",
        borderRadius: "8px",
        overflow: "hidden",
        backgroundColor: "var(--bg-base)",
      }}
    >
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          aria-pressed={value === opt}
          style={{
            padding: "7px 18px",
            fontSize: "13px",
            fontFamily: "Geist Mono, monospace",
            border: "none",
            cursor: "pointer",
            backgroundColor: value === opt ? "var(--accent)" : "transparent",
            color: value === opt ? "#fff" : "var(--text-secondary)",
            fontWeight: value === opt ? 600 : 400,
            transition: "background 0.15s, color 0.15s",
          }}
        >
          {opt === "fast" ? "Fast" : "Smart"}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LintErrors — inline error list below the textarea
// ---------------------------------------------------------------------------

interface LintErrorsProps {
  result: LintResult;
}

function LintErrors({ result }: LintErrorsProps) {
  if (result.valid) {
    return (
      <div
        role="status"
        style={{
          marginTop: "8px",
          padding: "8px 12px",
          borderRadius: "6px",
          backgroundColor: "rgba(34,197,94,0.1)",
          border: "1px solid rgba(34,197,94,0.3)",
          color: "var(--status-success-text)",
          fontSize: "13px",
        }}
      >
        Looks good — no issues found.
      </div>
    );
  }
  return (
    <div
      role="alert"
      style={{
        marginTop: "8px",
        padding: "10px 12px",
        borderRadius: "6px",
        backgroundColor: "rgba(239,68,68,0.08)",
        border: "1px solid rgba(239,68,68,0.25)",
        color: "var(--status-failed-text)",
        fontSize: "13px",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: "4px" }}>Lint issues:</div>
      <ul style={{ margin: 0, paddingLeft: "16px" }}>
        {result.errors.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NewRunPage
// ---------------------------------------------------------------------------

export default function NewRunPage() {
  const navigate = useNavigate();

  const [goal, setGoal] = useState("");
  const [template, setTemplate] = useState("");
  const [modelTier, setModelTier] = useState<ModelTier>("smart");
  const [parallel, setParallel] = useState(false);

  const [lintResult, setLintResult] = useState<LintResult | null>(null);
  const [linting, setLinting] = useState(false);
  const [lintError, setLintError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleLint = useCallback(async () => {
    if (!goal.trim()) return;
    setLinting(true);
    setLintResult(null);
    setLintError(null);
    try {
      const result = await postLint({ goal, template: template || undefined });
      setLintResult(result);
    } catch (err) {
      setLintError(err instanceof Error ? err.message : String(err));
    } finally {
      setLinting(false);
    }
  }, [goal, template]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!goal.trim() || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { id } = await postRun({
        goal,
        template: template || undefined,
        modelTier,
        parallel,
      });
      navigate(`/runs/${id}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }, [goal, template, modelTier, parallel, submitting, navigate]);

  const canSubmit = goal.trim().length > 0 && !submitting;

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: "24px" }}>
        <h1
          style={{
            fontSize: "18px",
            fontWeight: 600,
            color: "var(--text-primary)",
            margin: 0,
            flex: 1,
          }}
        >
          New Run
        </h1>
      </div>

      <form onSubmit={(e) => { void handleSubmit(e); }}>
        {/* Goal textarea */}
        <div style={sectionStyle}>
          <label htmlFor="goal-input" style={labelStyle}>Goal</label>
          <textarea
            id="goal-input"
            rows={4}
            placeholder="What should Phase2S build?"
            value={goal}
            onChange={(e) => {
              setGoal(e.target.value);
              setLintResult(null);
            }}
            style={{
              ...inputBase,
              resize: "vertical",
              minHeight: "96px",
            }}
            disabled={submitting}
          />
          {/* Lint button */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "8px" }}>
            <button
              type="button"
              onClick={() => { void handleLint(); }}
              disabled={!goal.trim() || linting || submitting}
              style={{
                padding: "6px 14px",
                fontSize: "13px",
                fontFamily: "Geist Mono, monospace",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                backgroundColor: "var(--bg-surface)",
                color: "var(--text-secondary)",
                cursor: goal.trim() && !linting && !submitting ? "pointer" : "not-allowed",
                opacity: goal.trim() && !linting && !submitting ? 1 : 0.5,
              }}
            >
              {linting ? "Checking..." : "Check goal"}
            </button>
            {lintError && (
              <span style={{ fontSize: "13px", color: "var(--status-failed-text)" }}>
                {lintError}
              </span>
            )}
          </div>
          {lintResult && <LintErrors result={lintResult} />}
        </div>

        {/* Template picker */}
        <div style={sectionStyle}>
          <label htmlFor="template-select" style={labelStyle}>Template</label>
          <select
            id="template-select"
            value={template}
            onChange={(e) => {
              setTemplate(e.target.value);
              setLintResult(null);
            }}
            disabled={submitting}
            style={{
              ...inputBase,
              cursor: "pointer",
            }}
          >
            {TEMPLATES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        {/* Model tier + Parallel */}
        <div style={{ ...sectionStyle, display: "flex", gap: "32px", alignItems: "flex-start", flexWrap: "wrap" }}>
          <div>
            <div style={labelStyle}>Model</div>
            <SegmentedControl value={modelTier} onChange={setModelTier} />
          </div>
          <div>
            <div style={labelStyle}>Options</div>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "14px",
                color: "var(--text-secondary)",
                cursor: submitting ? "not-allowed" : "pointer",
                userSelect: "none",
              }}
            >
              <input
                type="checkbox"
                checked={parallel}
                onChange={(e) => setParallel(e.target.checked)}
                disabled={submitting}
                style={{ accentColor: "var(--accent)", width: "15px", height: "15px" }}
              />
              Run subtasks in parallel (auto-detect)
            </label>
          </div>
        </div>

        {/* Submit error banner */}
        {submitError && (
          <div
            role="alert"
            style={{
              marginBottom: "16px",
              padding: "10px 12px",
              borderRadius: "6px",
              backgroundColor: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.25)",
              color: "var(--status-failed-text)",
              fontSize: "13px",
            }}
          >
            {submitError}
          </div>
        )}

        {/* Run button */}
        <button
          type="submit"
          disabled={!canSubmit}
          style={{
            padding: "10px 28px",
            fontSize: "14px",
            fontWeight: 600,
            fontFamily: "Geist Mono, monospace",
            border: "none",
            borderRadius: "8px",
            backgroundColor: canSubmit ? "var(--accent)" : "var(--bg-subtle)",
            color: canSubmit ? "#fff" : "var(--text-muted)",
            cursor: canSubmit ? "pointer" : "not-allowed",
            transition: "background 0.15s, color 0.15s",
          }}
        >
          {submitting ? "Starting..." : "Run"}
        </button>
      </form>
    </div>
  );
}
