/**
 * phase2s web dashboard — /api/config handlers (Sprint 97)
 *
 * GET /api/config
 *   Reads .phase2s.yaml (or .phase2s.yml) from the project directory,
 *   validates with configSchema.passthrough().partial(), masks sensitive
 *   fields (API keys, webhook URLs) as "***SET***", and returns JSON.
 *   Returns 404 when no config file exists.
 *   Returns 500 when the YAML is malformed.
 *
 * POST /api/config
 *   Accepts a partial config body, merges at the section level over the
 *   existing file, validates, and writes atomically (tmp + rename).
 *   Rules:
 *     - Field value "***SET***"  → preserve existing value (do not overwrite)
 *     - Field value ""           → delete the key from the YAML
 *     - Any other value          → write new value
 *   The server rejects "***SET***" only when the field is NOT a known
 *   sensitive field (i.e. user is trying to write the literal sentinel).
 *   Returns 400 on validation errors or literal "***SET***" writes.
 *   Returns 500 on YAML syntax errors.
 *
 * Notes:
 *   - loadConfig() reads from process.cwd(), NOT the per-request `cwd`.
 *     We must use raw fs.readFile(join(cwd, filename)) here.
 *   - configSchema is used with .passthrough().partial() so unknown keys
 *     (tools, deny, codeRag, etc.) survive the round-trip unchanged.
 */

import { readFile, writeFile, rename, copyFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { Request, Response } from "express";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { configSchema } from "../../core/config.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONFIG_FILENAMES = [".phase2s.yaml", ".phase2s.yml"] as const;

/** Sentinel returned to the client for fields that exist but should not be sent */
const MASKED = "***SET***";

/** Fields whose values are masked on GET */
const SENSITIVE_FIELDS = new Set([
  "apiKey",
  "anthropicApiKey",
  "openrouterApiKey",
  "geminiApiKey",
  "minimaxApiKey",
]);

/** Sensitive nested fields: "section.field" → field inside notify object */
const SENSITIVE_NESTED: Record<string, Set<string>> = {
  notify: new Set(["slack", "discord", "teams"]),
};

// telegram.token is handled specially (object with token + chatId)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Detect which config filename exists; returns the filename and raw YAML content. */
async function readConfigFile(
  cwd: string,
): Promise<{ filename: string; raw: string } | null> {
  for (const filename of CONFIG_FILENAMES) {
    try {
      const raw = await readFile(join(cwd, filename), "utf-8");
      return { filename, raw };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") continue;
      throw err;
    }
  }
  return null;
}

/** Parse YAML and validate with passthrough+partial. Throws on syntax error. */
function parseConfig(raw: string): Record<string, unknown> {
  const parsed = parseYaml(raw);
  if (parsed === null || parsed === undefined) return {};
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Config file must be a YAML mapping");
  }
  // passthrough() keeps unknown keys; partial() makes all fields optional
  const result = configSchema.passthrough().partial().parse(parsed);
  return result as Record<string, unknown>;
}

/** Mask sensitive top-level string fields with "***SET***". */
function maskConfig(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...obj };

  for (const field of SENSITIVE_FIELDS) {
    if (typeof out[field] === "string" && (out[field] as string).length > 0) {
      out[field] = MASKED;
    }
  }

  // notify sub-fields
  if (out.notify && typeof out.notify === "object" && !Array.isArray(out.notify)) {
    const notify = { ...(out.notify as Record<string, unknown>) };
    for (const field of SENSITIVE_NESTED.notify ?? []) {
      if (typeof notify[field] === "string" && (notify[field] as string).length > 0) {
        notify[field] = MASKED;
      }
    }
    // telegram.token
    if (notify.telegram && typeof notify.telegram === "object" && !Array.isArray(notify.telegram)) {
      const tg = { ...(notify.telegram as Record<string, unknown>) };
      if (typeof tg.token === "string" && tg.token.length > 0) {
        tg.token = MASKED;
      }
      notify.telegram = tg;
    }
    out.notify = notify;
  }

  return out;
}

/** All sensitive field paths as dot-notation strings (for sentinel validation). */
function isSensitiveField(fieldPath: string): boolean {
  if (SENSITIVE_FIELDS.has(fieldPath)) return true;
  // notify.slack, notify.discord, etc.
  const parts = fieldPath.split(".");
  if (parts.length === 2) {
    return (SENSITIVE_NESTED[parts[0]] ?? new Set()).has(parts[1]);
  }
  if (fieldPath === "notify.telegram.token") return true;
  return false;
}

// ---------------------------------------------------------------------------
// Section-level merge
// ---------------------------------------------------------------------------

/**
 * Merge the incoming POST body over the existing config at the section level.
 *
 * Top-level scalar fields: overwrite / delete (empty string) / preserve (MASKED).
 * Nested objects (notify, commit): merge field-by-field using the same rules.
 * Fields not present in the incoming body are left untouched.
 *
 * Sentinel rules:
 *   - Value === MASKED: keep existing value (skip write)
 *   - Value === "" (empty string): delete key
 *   - Other: overwrite with new value
 */
function mergeConfig(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  path = "",
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...existing };

  for (const [key, value] of Object.entries(incoming)) {
    const fieldPath = path ? `${path}.${key}` : key;

    if (value === MASKED) {
      // Preserve existing value — skip this field entirely
      continue;
    }

    if (value === "" || value === null || value === undefined) {
      // Empty string: delete the key
      delete out[key];
      continue;
    }

    if (typeof value === "object" && !Array.isArray(value) && value !== null) {
      // Nested object: recurse
      const existingNested =
        typeof out[key] === "object" && out[key] !== null && !Array.isArray(out[key])
          ? (out[key] as Record<string, unknown>)
          : {};
      out[key] = mergeConfig(existingNested, value as Record<string, unknown>, fieldPath);
      // If the merged object is empty, remove the key
      if (Object.keys(out[key] as object).length === 0) {
        delete out[key];
      }
      continue;
    }

    out[key] = value;
  }

  return out;
}

class SentinelError extends Error {
  field: string;
  constructor(field: string) {
    super(`Invalid value for field ${field}`);
    this.field = field;
    this.name = "SentinelError";
  }
}

// ---------------------------------------------------------------------------
// GET /api/config
// ---------------------------------------------------------------------------

export async function handleGetConfig(
  _req: Request,
  res: Response,
  cwd: string,
): Promise<void> {
  let fileResult: { filename: string; raw: string } | null;
  try {
    fileResult = await readConfigFile(cwd);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Failed to read config file: ${message}` });
    return;
  }

  if (!fileResult) {
    res.status(404).json({ error: "No .phase2s.yaml found. Run 'phase2s init' to create one." });
    return;
  }

  let config: Record<string, unknown>;
  try {
    config = parseConfig(fileResult.raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Config file has a YAML syntax error: ${message}` });
    return;
  }

  const masked = maskConfig(config);
  res.json({ config: masked, filename: fileResult.filename });
}

// ---------------------------------------------------------------------------
// POST /api/config
// ---------------------------------------------------------------------------

export async function handlePostConfig(
  req: Request,
  res: Response,
  cwd: string,
): Promise<void> {
  const incoming = req.body as Record<string, unknown> | undefined;

  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    res.status(400).json({ error: "Request body must be a JSON object" });
    return;
  }

  // Reject any non-sensitive field that literally equals the sentinel
  for (const [key, value] of Object.entries(incoming)) {
    if (value === MASKED && !isSensitiveField(key)) {
      res.status(400).json({ error: `Invalid value for field ${key}` });
      return;
    }
  }

  // Read existing config (or start empty)
  let existingRaw = "";
  let filename = CONFIG_FILENAMES[0]; // default: .phase2s.yaml

  try {
    const fileResult = await readConfigFile(cwd);
    if (fileResult) {
      existingRaw = fileResult.raw;
      filename = fileResult.filename;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Failed to read config file: ${message}` });
    return;
  }

  // Parse existing YAML
  let existingConfig: Record<string, unknown> = {};
  if (existingRaw.trim()) {
    try {
      existingConfig = parseConfig(existingRaw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Config file has a YAML syntax error: ${message}` });
      return;
    }
  }

  // Merge incoming changes
  let merged: Record<string, unknown>;
  try {
    merged = mergeConfig(existingConfig, incoming);
  } catch (err) {
    if (err instanceof SentinelError) {
      res.status(400).json({ error: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
    return;
  }

  // Validate merged result
  let validated: Record<string, unknown>;
  try {
    validated = configSchema.passthrough().partial().parse(merged) as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: `Invalid config: ${message}` });
    return;
  }

  // Atomic write: write to .tmp then rename (with EXDEV fallback)
  const targetPath = join(cwd, filename);
  const tmpPath = `${targetPath}.tmp`;
  const newYaml = stringifyYaml(validated);

  try {
    await writeFile(tmpPath, newYaml, "utf-8");
    try {
      await rename(tmpPath, targetPath);
    } catch (renameErr) {
      const code = (renameErr as NodeJS.ErrnoException).code;
      if (code === "EXDEV") {
        // Cross-device rename: fall back to copy + delete
        await copyFile(tmpPath, targetPath);
        await unlink(tmpPath);
      } else {
        throw renameErr;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Failed to write config: ${message}` });
    return;
  }

  res.json({ ok: true, filename });
}
