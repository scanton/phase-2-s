/**
 * phase2s web dashboard — Config Page (Sprint 97)
 *
 * Renders a form for viewing and editing .phase2s.yaml.
 * Fetches GET /api/config on mount; saves via POST /api/config on submit.
 *
 * Sensitive fields (API keys, webhook URLs) are masked as "***SET***" by
 * the server. The component tracks per-field hasExisting state so that
 * untouched password fields send "***SET***" on POST (not ""), preventing
 * accidental key deletion.
 *
 * Sections:
 *   1. Provider & Model
 *   2. API Keys
 *   3. Ollama (de-emphasized when provider ≠ "ollama")
 *   4. Notifications
 *   5. Behavior
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { EyeIcon, EyeSlashIcon } from "@heroicons/react/24/outline";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROVIDERS = [
  "codex-cli",
  "openai-api",
  "anthropic",
  "ollama",
  "openrouter",
  "gemini",
  "minimax",
] as const;

type Provider = (typeof PROVIDERS)[number];

const MASKED = "***SET***";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** State for a sensitive field (API key, webhook URL) */
interface SensitiveField {
  /** Current text in the input; empty if user hasn't typed anything new */
  value: string;
  /** True when the field was loaded as "***SET***" and hasn't been modified */
  hasExisting: boolean;
  /** Password visibility toggle */
  show: boolean;
}

interface FormState {
  // Provider & Model
  provider: Provider;
  model: string;
  fast_model: string;
  smart_model: string;
  // API Keys
  apiKey: SensitiveField;
  anthropicApiKey: SensitiveField;
  openrouterApiKey: SensitiveField;
  geminiApiKey: SensitiveField;
  minimaxApiKey: SensitiveField;
  // Ollama
  ollamaBaseUrl: string;
  ollamaEmbedModel: string;
  // Notifications
  notifyMac: boolean;
  notifySlack: SensitiveField;
  notifyDiscord: SensitiveField;
  notifyTeams: SensitiveField;
  telegramToken: SensitiveField;
  telegramChatId: string;
  // Behavior
  allowDestructive: boolean;
  requireSpecification: boolean;
  verifyCommand: string;
  browser: boolean;
}

type ToastState = { type: "success" | "error"; message: string } | null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkSensitive(serverVal?: unknown): SensitiveField {
  if (serverVal === MASKED) {
    return { value: "", hasExisting: true, show: false };
  }
  return { value: typeof serverVal === "string" ? serverVal : "", hasExisting: false, show: false };
}

function sensitivePostValue(field: SensitiveField): string {
  // User typed a new value
  if (!field.hasExisting && field.value !== "") return field.value;
  // User cleared an existing value → delete the key
  if (!field.hasExisting && field.value === "") return "";
  // Existing value, user didn't touch it → preserve
  if (field.hasExisting && field.value === "") return MASKED;
  // Existing value, user typed something new
  return field.value;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildFormState(config: Record<string, any>): FormState {
  const notify = config.notify ?? {};
  const telegram = notify.telegram ?? {};
  return {
    provider: (PROVIDERS.includes(config.provider) ? config.provider : "codex-cli") as Provider,
    model: config.model ?? "",
    fast_model: config.fast_model ?? "",
    smart_model: config.smart_model ?? "",
    apiKey: mkSensitive(config.apiKey),
    anthropicApiKey: mkSensitive(config.anthropicApiKey),
    openrouterApiKey: mkSensitive(config.openrouterApiKey),
    geminiApiKey: mkSensitive(config.geminiApiKey),
    minimaxApiKey: mkSensitive(config.minimaxApiKey),
    ollamaBaseUrl: config.ollamaBaseUrl ?? "",
    ollamaEmbedModel: config.ollamaEmbedModel ?? "",
    notifyMac: notify.mac === true,
    notifySlack: mkSensitive(notify.slack),
    notifyDiscord: mkSensitive(notify.discord),
    notifyTeams: mkSensitive(notify.teams),
    telegramToken: mkSensitive(telegram.token),
    telegramChatId: telegram.chatId ?? "",
    allowDestructive: config.allowDestructive === true,
    requireSpecification: config.requireSpecification === true,
    verifyCommand: config.verifyCommand ?? "",
    browser: config.browser === true,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildPostBody(form: FormState): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: Record<string, any> = {};

  body.provider = form.provider;
  if (form.model.trim()) body.model = form.model.trim();
  if (form.fast_model.trim()) body.fast_model = form.fast_model.trim();
  if (form.smart_model.trim()) body.smart_model = form.smart_model.trim();

  // API keys: only include if not empty string (empty string = delete)
  const apiKey = sensitivePostValue(form.apiKey);
  const anthropicApiKey = sensitivePostValue(form.anthropicApiKey);
  const openrouterApiKey = sensitivePostValue(form.openrouterApiKey);
  const geminiApiKey = sensitivePostValue(form.geminiApiKey);
  const minimaxApiKey = sensitivePostValue(form.minimaxApiKey);

  if (apiKey !== "") body.apiKey = apiKey;
  if (anthropicApiKey !== "") body.anthropicApiKey = anthropicApiKey;
  if (openrouterApiKey !== "") body.openrouterApiKey = openrouterApiKey;
  if (geminiApiKey !== "") body.geminiApiKey = geminiApiKey;
  if (minimaxApiKey !== "") body.minimaxApiKey = minimaxApiKey;

  if (form.ollamaBaseUrl.trim()) body.ollamaBaseUrl = form.ollamaBaseUrl.trim();
  if (form.ollamaEmbedModel.trim()) body.ollamaEmbedModel = form.ollamaEmbedModel.trim();

  // Notifications
  const slack = sensitivePostValue(form.notifySlack);
  const discord = sensitivePostValue(form.notifyDiscord);
  const teams = sensitivePostValue(form.notifyTeams);
  const telegramToken = sensitivePostValue(form.telegramToken);
  const hasTelegramChatId = form.telegramChatId.trim() !== "";

  const notify: Record<string, unknown> = {};
  if (form.notifyMac) notify.mac = true;
  if (slack && slack !== "") notify.slack = slack;
  if (discord && discord !== "") notify.discord = discord;
  if (teams && teams !== "") notify.teams = teams;
  if (telegramToken && telegramToken !== "" && hasTelegramChatId) {
    notify.telegram = { token: telegramToken, chatId: form.telegramChatId.trim() };
  }
  if (Object.keys(notify).length > 0) body.notify = notify;

  // Behavior
  body.allowDestructive = form.allowDestructive;
  body.requireSpecification = form.requireSpecification;
  if (form.verifyCommand.trim()) body.verifyCommand = form.verifyCommand.trim();
  body.browser = form.browser;

  return body;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionHeader({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      style={{
        fontSize: "13px",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: "var(--text-secondary)",
        margin: "0 0 12px",
        paddingBottom: "6px",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {children}
    </h2>
  );
}

function FieldRow({ label, htmlFor, children, hint }: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "14px" }}>
      <label
        htmlFor={htmlFor}
        style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-primary)" }}
      >
        {label}
      </label>
      {children}
      {hint && (
        <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>{hint}</span>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: "6px",
  border: "1px solid var(--border)",
  background: "var(--bg-secondary)",
  color: "var(--text-primary)",
  fontSize: "13px",
  fontFamily: "inherit",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

function TextInput({
  id,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <input
      id={id}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      style={{ ...inputStyle, opacity: disabled ? 0.5 : 1 }}
    />
  );
}

function PasswordInput({
  id,
  field,
  onChange,
  onToggleShow,
  placeholder,
}: {
  id: string;
  field: SensitiveField;
  onChange: (v: string) => void;
  onToggleShow: () => void;
  placeholder?: string;
}) {
  const displayPlaceholder = field.hasExisting ? "(currently set)" : (placeholder ?? "");
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
      <input
        id={id}
        type={field.show ? "text" : "password"}
        value={field.value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={displayPlaceholder}
        style={{ ...inputStyle, paddingRight: "36px" }}
      />
      <button
        type="button"
        onClick={onToggleShow}
        aria-label={field.show ? "Hide" : "Show"}
        style={{
          position: "absolute",
          right: "8px",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--text-secondary)",
          padding: "2px",
          display: "flex",
          alignItems: "center",
        }}
      >
        {field.show
          ? <EyeSlashIcon width={16} height={16} aria-hidden="true" />
          : <EyeIcon width={16} height={16} aria-hidden="true" />}
      </button>
    </div>
  );
}

function CheckboxRow({ id, label, checked, onChange, hint }: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px", marginBottom: "14px" }}>
      <label
        htmlFor={id}
        style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px", color: "var(--text-primary)" }}
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          style={{ cursor: "pointer" }}
        />
        {label}
      </label>
      {hint && (
        <span style={{ fontSize: "12px", color: "var(--text-secondary)", marginLeft: "24px" }}>{hint}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ConfigPage() {
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismissToast = useCallback(() => {
    setToast(null);
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const showToast = useCallback((type: "success" | "error", message: string) => {
    setToast({ type, message });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    if (type === "success") {
      toastTimer.current = setTimeout(dismissToast, 3000);
    }
  }, [dismissToast]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  // Fetch config on mount
  useEffect(() => {
    setLoading(true);
    fetch("/api/config")
      .then(async (res) => {
        if (res.status === 404) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setLoadError((data as Record<string, string>).error ?? `HTTP ${res.status}`);
          setLoading(false);
          return;
        }
        const data = await res.json() as { config: Record<string, unknown> };
        setForm(buildFormState(data.config));
        setIsDirty(false);
        setLoading(false);
      })
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, []);

  // Helper: update any form field and mark dirty
  function updateForm(updater: (prev: FormState) => FormState) {
    setForm((prev) => prev ? updater(prev) : prev);
    setIsDirty(true);
  }

  function updateSensitive(
    field: keyof Pick<FormState, "apiKey" | "anthropicApiKey" | "openrouterApiKey" | "geminiApiKey" | "minimaxApiKey" | "notifySlack" | "notifyDiscord" | "notifyTeams" | "telegramToken">,
    newVal: string,
  ) {
    updateForm((prev) => ({
      ...prev,
      [field]: { value: newVal, hasExisting: false, show: prev[field as keyof FormState] && typeof prev[field as keyof FormState] === "object" ? (prev[field as keyof FormState] as SensitiveField).show : false },
    }));
  }

  function toggleShow(
    field: keyof Pick<FormState, "apiKey" | "anthropicApiKey" | "openrouterApiKey" | "geminiApiKey" | "minimaxApiKey" | "notifySlack" | "notifyDiscord" | "notifyTeams" | "telegramToken">,
  ) {
    setForm((prev) => {
      if (!prev) return prev;
      const current = prev[field] as SensitiveField;
      return { ...prev, [field]: { ...current, show: !current.show } };
    });
  }

  // Handle allowDestructive: confirm dialog on false→true
  function handleAllowDestructiveChange(newVal: boolean) {
    if (newVal) {
      const confirmed = window.confirm(
        "Enable allowDestructive?\n\nThis allows the agent to delete files and make potentially irreversible changes. Only enable if you understand the risks.",
      );
      if (!confirmed) return;
    }
    updateForm((prev) => ({ ...prev, allowDestructive: newVal }));
  }

  async function handleSave() {
    if (!form) return;
    setSaving(true);
    setSaveError(null);

    const body = buildPostBody(form);

    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({})) as Record<string, unknown>;

      if (!res.ok) {
        const msg = typeof data.error === "string" ? data.error : `HTTP ${res.status}`;
        setSaveError(msg);
        setSaving(false);
        return;
      }

      // Reload to pick up masked values from server
      const reloadRes = await fetch("/api/config");
      if (reloadRes.ok) {
        const reloadData = await reloadRes.json() as { config: Record<string, unknown> };
        setForm(buildFormState(reloadData.config));
      }

      setIsDirty(false);
      setSaving(false);
      showToast("success", "Config saved");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render states
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div style={{ color: "var(--text-secondary)", fontSize: "14px" }}>
        Loading config…
      </div>
    );
  }

  if (notFound) {
    return (
      <div
        role="status"
        style={{
          padding: "16px",
          borderRadius: "8px",
          background: "var(--bg-secondary)",
          border: "1px solid var(--border)",
          fontSize: "14px",
          color: "var(--text-secondary)",
        }}
      >
        No .phase2s.yaml found in this project directory.
        Run <code style={{ fontFamily: "monospace" }}>phase2s init</code> to create one.
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={{ color: "var(--status-failed-text)", fontSize: "14px" }}>
        Error loading config: {loadError}
      </div>
    );
  }

  if (!form) return null;

  const isOllama = form.provider === "ollama";

  // ---------------------------------------------------------------------------
  // Main form
  // ---------------------------------------------------------------------------

  const sectionStyle: React.CSSProperties = {
    marginBottom: "32px",
  };

  return (
    <div style={{ maxWidth: "640px" }}>
      <h1
        style={{
          fontSize: "20px",
          fontWeight: 600,
          color: "var(--text-primary)",
          margin: "0 0 24px",
        }}
      >
        Config
      </h1>

      {/* Toast notification */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          onClick={dismissToast}
          style={{
            padding: "10px 16px",
            borderRadius: "8px",
            marginBottom: "16px",
            fontSize: "14px",
            fontWeight: 500,
            cursor: "pointer",
            backgroundColor:
              toast.type === "success"
                ? "var(--status-success-bg)"
                : "var(--status-failed-bg)",
            color:
              toast.type === "success"
                ? "var(--status-success-text)"
                : "var(--status-failed-text)",
          }}
        >
          {toast.message}
        </div>
      )}

      {/* Save error */}
      {saveError && (
        <div
          role="alert"
          style={{
            padding: "10px 16px",
            borderRadius: "8px",
            marginBottom: "16px",
            fontSize: "14px",
            color: "var(--status-failed-text)",
            background: "var(--status-failed-bg)",
          }}
        >
          {saveError}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Section 1: Provider & Model */}
      {/* ------------------------------------------------------------------ */}
      <section style={sectionStyle} aria-labelledby="section-provider">
        <SectionHeader id="section-provider">{"Provider & Model"}</SectionHeader>

        <FieldRow label="Provider" htmlFor="config-provider">
          <select
            id="config-provider"
            value={form.provider}
            onChange={(e) => updateForm((prev) => ({ ...prev, provider: e.target.value as Provider }))}
            style={{ ...inputStyle }}
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </FieldRow>

        <FieldRow label="Model" htmlFor="config-model" hint="Leave blank to use provider default">
          <TextInput
            id="config-model"
            value={form.model}
            onChange={(v) => updateForm((prev) => ({ ...prev, model: v }))}
            placeholder="e.g. gpt-4o"
          />
        </FieldRow>

        <FieldRow label="Fast model" htmlFor="config-fast-model" hint="Used for lightweight tasks">
          <TextInput
            id="config-fast-model"
            value={form.fast_model}
            onChange={(v) => updateForm((prev) => ({ ...prev, fast_model: v }))}
          />
        </FieldRow>

        <FieldRow label="Smart model" htmlFor="config-smart-model" hint="Used for complex reasoning tasks">
          <TextInput
            id="config-smart-model"
            value={form.smart_model}
            onChange={(v) => updateForm((prev) => ({ ...prev, smart_model: v }))}
          />
        </FieldRow>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Section 2: API Keys */}
      {/* ------------------------------------------------------------------ */}
      <section style={sectionStyle} aria-labelledby="section-api-keys">
        <SectionHeader id="section-api-keys">API Keys</SectionHeader>

        <FieldRow label="OpenAI API key" htmlFor="config-apiKey">
          <PasswordInput
            id="config-apiKey"
            field={form.apiKey}
            onChange={(v) => updateSensitive("apiKey", v)}
            onToggleShow={() => toggleShow("apiKey")}
          />
        </FieldRow>

        <FieldRow label="Anthropic API key" htmlFor="config-anthropicApiKey">
          <PasswordInput
            id="config-anthropicApiKey"
            field={form.anthropicApiKey}
            onChange={(v) => updateSensitive("anthropicApiKey", v)}
            onToggleShow={() => toggleShow("anthropicApiKey")}
          />
        </FieldRow>

        <FieldRow label="OpenRouter API key" htmlFor="config-openrouterApiKey">
          <PasswordInput
            id="config-openrouterApiKey"
            field={form.openrouterApiKey}
            onChange={(v) => updateSensitive("openrouterApiKey", v)}
            onToggleShow={() => toggleShow("openrouterApiKey")}
          />
        </FieldRow>

        <FieldRow label="Gemini API key" htmlFor="config-geminiApiKey">
          <PasswordInput
            id="config-geminiApiKey"
            field={form.geminiApiKey}
            onChange={(v) => updateSensitive("geminiApiKey", v)}
            onToggleShow={() => toggleShow("geminiApiKey")}
          />
        </FieldRow>

        <FieldRow label="MiniMax API key" htmlFor="config-minimaxApiKey">
          <PasswordInput
            id="config-minimaxApiKey"
            field={form.minimaxApiKey}
            onChange={(v) => updateSensitive("minimaxApiKey", v)}
            onToggleShow={() => toggleShow("minimaxApiKey")}
          />
        </FieldRow>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Section 3: Ollama */}
      {/* ------------------------------------------------------------------ */}
      <section
        style={{ ...sectionStyle, opacity: isOllama ? 1 : 0.5 }}
        aria-labelledby="section-ollama"
      >
        <SectionHeader id="section-ollama">Ollama</SectionHeader>
        {!isOllama && (
          <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "12px" }}>
            Set provider to &quot;ollama&quot; to use these settings.
          </p>
        )}

        <FieldRow label="Ollama base URL" htmlFor="config-ollamaBaseUrl">
          <TextInput
            id="config-ollamaBaseUrl"
            value={form.ollamaBaseUrl}
            onChange={(v) => updateForm((prev) => ({ ...prev, ollamaBaseUrl: v }))}
            placeholder="http://localhost:11434/v1"
          />
        </FieldRow>

        <FieldRow label="Ollama embed model" htmlFor="config-ollamaEmbedModel" hint="Used for code-RAG embeddings">
          <TextInput
            id="config-ollamaEmbedModel"
            value={form.ollamaEmbedModel}
            onChange={(v) => updateForm((prev) => ({ ...prev, ollamaEmbedModel: v }))}
            placeholder="e.g. nomic-embed-text"
          />
        </FieldRow>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Section 4: Notifications */}
      {/* ------------------------------------------------------------------ */}
      <section style={sectionStyle} aria-labelledby="section-notifications">
        <SectionHeader id="section-notifications">Notifications</SectionHeader>

        <CheckboxRow
          id="config-notifyMac"
          label="macOS system notifications"
          checked={form.notifyMac}
          onChange={(v) => updateForm((prev) => ({ ...prev, notifyMac: v }))}
          hint="Sends a native notification when a run completes (macOS only)"
        />

        <FieldRow label="Slack webhook URL" htmlFor="config-notifySlack">
          <PasswordInput
            id="config-notifySlack"
            field={form.notifySlack}
            onChange={(v) => updateSensitive("notifySlack", v)}
            onToggleShow={() => toggleShow("notifySlack")}
            placeholder="https://hooks.slack.com/services/..."
          />
        </FieldRow>

        <FieldRow label="Discord webhook URL" htmlFor="config-notifyDiscord">
          <PasswordInput
            id="config-notifyDiscord"
            field={form.notifyDiscord}
            onChange={(v) => updateSensitive("notifyDiscord", v)}
            onToggleShow={() => toggleShow("notifyDiscord")}
            placeholder="https://discord.com/api/webhooks/..."
          />
        </FieldRow>

        <FieldRow label="Teams webhook URL" htmlFor="config-notifyTeams">
          <PasswordInput
            id="config-notifyTeams"
            field={form.notifyTeams}
            onChange={(v) => updateSensitive("notifyTeams", v)}
            onToggleShow={() => toggleShow("notifyTeams")}
          />
        </FieldRow>

        <FieldRow label="Telegram bot token" htmlFor="config-telegramToken">
          <PasswordInput
            id="config-telegramToken"
            field={form.telegramToken}
            onChange={(v) => updateSensitive("telegramToken", v)}
            onToggleShow={() => toggleShow("telegramToken")}
          />
        </FieldRow>

        <FieldRow label="Telegram chat ID" htmlFor="config-telegramChatId">
          <TextInput
            id="config-telegramChatId"
            value={form.telegramChatId}
            onChange={(v) => updateForm((prev) => ({ ...prev, telegramChatId: v }))}
            placeholder="e.g. -1001234567890"
          />
        </FieldRow>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Section 5: Behavior */}
      {/* ------------------------------------------------------------------ */}
      <section style={sectionStyle} aria-labelledby="section-behavior">
        <SectionHeader id="section-behavior">Behavior</SectionHeader>

        <CheckboxRow
          id="config-allowDestructive"
          label="Allow destructive operations"
          checked={form.allowDestructive}
          onChange={handleAllowDestructiveChange}
          hint="Allows the agent to delete files and make irreversible changes"
        />

        <CheckboxRow
          id="config-requireSpecification"
          label="Require specification"
          checked={form.requireSpecification}
          onChange={(v) => updateForm((prev) => ({ ...prev, requireSpecification: v }))}
          hint="Agent must load a spec file before starting a run"
        />

        <FieldRow label="Verify command" htmlFor="config-verifyCommand" hint="Run after each successful task (default: npm test)">
          <TextInput
            id="config-verifyCommand"
            value={form.verifyCommand}
            onChange={(v) => updateForm((prev) => ({ ...prev, verifyCommand: v }))}
            placeholder="npm test"
          />
        </FieldRow>

        <CheckboxRow
          id="config-browser"
          label="Enable browser tool"
          checked={form.browser}
          onChange={(v) => updateForm((prev) => ({ ...prev, browser: v }))}
          hint="Requires playwright to be installed"
        />
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Sticky Save footer */}
      {/* ------------------------------------------------------------------ */}
      <div
        style={{
          position: "sticky",
          bottom: 0,
          background: "var(--bg-primary)",
          borderTop: "1px solid var(--border)",
          padding: "12px 0",
          display: "flex",
          alignItems: "center",
          gap: "12px",
        }}
      >
        <button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || saving}
          style={{
            padding: "8px 20px",
            borderRadius: "6px",
            border: "none",
            background: isDirty && !saving ? "var(--accent)" : "var(--border)",
            color: isDirty && !saving ? "white" : "var(--text-secondary)",
            fontSize: "14px",
            fontWeight: 500,
            fontFamily: "inherit",
            cursor: isDirty && !saving ? "pointer" : "not-allowed",
            transition: "background 0.15s",
          }}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        {!isDirty && !saving && (
          <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
            No unsaved changes
          </span>
        )}
      </div>
    </div>
  );
}
