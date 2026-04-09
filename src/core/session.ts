/**
 * Session storage — DAG-shaped conversation persistence.
 *
 * Session files live at .phase2s/sessions/<uuid>.json and use schema v2:
 *   { schemaVersion: 2, meta: SessionMeta, messages: Message[] }
 *
 * Legacy files (plain array of messages, schema v1) are migrated transparently
 * the first time Phase2S starts after an upgrade. Migration is resumable: a
 * manifest file tracks per-file completion so a crash mid-migration doesn't
 * leave the directory permanently half-migrated.
 *
 * The active REPL session is tracked in .phase2s/state.json (top-level, not
 * inside .phase2s/state/ which is used for goal executor state).
 *
 * DAG structure
 * =============
 *
 *   root session (parentId: null)
 *        │
 *        ├── clone A (parentId: root.id)
 *        │       └── clone A2 (parentId: A.id)
 *        └── clone B (parentId: root.id)
 *
 * Each session file is self-contained. Clone inherits full message history
 * from parent (deep copy). parentId is a soft reference — no referential
 * integrity enforcement (Sprint 45: doctor check).
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { readdir, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import chalk from "chalk";
import type { Message } from "../providers/types.js";
import { Conversation } from "./conversation.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionMeta {
  id: string;
  parentId: string | null;
  branchName: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionV2 {
  schemaVersion: 2;
  meta: SessionMeta;
  messages: Message[];
}

/** Repl-level state: which session is currently active. */
export interface ReplState {
  currentSessionId: string;
}

/** Per-file entry in the migration manifest. */
interface MigrationEntry {
  originalName: string;
  newId: string;
  done: boolean;
}

/** Migration manifest — tracks resumable progress. */
interface MigrationManifest {
  version: 1;
  entries: MigrationEntry[];
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function sessionsDir(cwd: string): string {
  return join(cwd, ".phase2s", "sessions");
}

function sessionPath(cwd: string, id: string): string {
  return join(sessionsDir(cwd), `${id}.json`);
}

function replStatePath(cwd: string): string {
  return join(cwd, ".phase2s", "state.json");
}

function migrationManifestPath(cwd: string): string {
  return join(sessionsDir(cwd), "migration.json");
}

// ---------------------------------------------------------------------------
// REPL state.json I/O
// ---------------------------------------------------------------------------

/** Read the REPL state from .phase2s/state.json. Returns null if not found. */
export function readReplState(cwd: string): ReplState | null {
  const path = replStatePath(cwd);
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as ReplState;
  } catch {
    return null;
  }
}

/**
 * Write REPL state atomically (tmp → rename).
 * Creates parent directory if needed.
 */
export function writeReplState(cwd: string, state: ReplState): void {
  const path = replStatePath(cwd);
  const tmp = path + ".tmp";
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
  renameSync(tmp, path);
}

// ---------------------------------------------------------------------------
// Session file I/O
// ---------------------------------------------------------------------------

/**
 * Save a conversation in v2 format.
 * Writes { schemaVersion: 2, meta, messages } with mode 0o600.
 */
export async function saveSession(path: string, conv: Conversation, meta: SessionMeta): Promise<void> {
  const updated: SessionV2 = {
    schemaVersion: 2,
    meta: { ...meta, updatedAt: new Date().toISOString() },
    messages: conv.getMessages(),
  };
  await mkdir(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  await writeFile(tmp, JSON.stringify(updated, null, 2), { encoding: "utf-8", mode: 0o600 });
  renameSync(tmp, path);
}

/**
 * Load a session file, handling both v1 (legacy array) and v2 formats.
 * Returns null if the file does not exist.
 * Throws if the file exists but is unparseable or has an unrecognized format.
 */
export async function loadSession(path: string): Promise<{ conv: Conversation; meta: SessionMeta | null }> {
  const raw = await readFile(path, "utf-8");
  const parsed: unknown = JSON.parse(raw);

  // v2 format
  if (
    parsed !== null &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    (parsed as Record<string, unknown>).schemaVersion === 2
  ) {
    const { meta, messages } = parsed as SessionV2;
    return { conv: await Conversation.load(path), meta };
  }

  // v1 legacy format (bare array)
  if (Array.isArray(parsed)) {
    return { conv: await Conversation.load(path), meta: null };
  }

  throw new Error(`Invalid session file at ${path}: unrecognized format`);
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/**
 * Migrate all legacy session files (schema v1 — bare arrays) to schema v2.
 *
 * Strategy:
 * 1. Scan sessions dir for YYYY-MM-DD.json files (legacy naming).
 * 2. If any exist and no backup dir is present, create backup and manifest.
 * 3. For each unfinished entry in the manifest, rename + rewrite the file.
 * 4. Mark each entry done in the manifest after successful write.
 *
 * Resumable: if the process is killed mid-migration, the next run reads the
 * manifest, skips already-done entries, and continues from where it left off.
 *
 * Idempotent: if all entries are done (or no legacy files), does nothing.
 */
export async function migrateAll(cwd: string): Promise<void> {
  const dir = sessionsDir(cwd);
  const manifestPath = migrationManifestPath(cwd);

  // Bail early: if sessions directory doesn't exist and no manifest, nothing to migrate.
  // We check this before acquiring the lock so we don't need the dir to exist for
  // writeFileSync(lockPath) to succeed (avoids ENOENT on lock creation).
  let allEntries: string[] = [];
  try {
    allEntries = await readdir(dir);
  } catch {
    if (!existsSync(manifestPath)) {
      return; // sessions dir doesn't exist yet — nothing to migrate
    }
    // Dir gone but manifest exists — crash recovery; continue without entry list
  }

  // Acquire a migration lock to prevent concurrent Phase2S instances from
  // both running migration at the same time. POSIX "wx" flag is atomic.
  const lockPath = manifestPath + ".lock";
  try {
    writeFileSync(lockPath, "", { flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      console.error(chalk.dim("Migration already in progress — skipping."));
      return;
    }
    throw err; // ENOENT, EACCES = real error — propagate
  }

  try {
    await migrateAllLocked(cwd, dir, manifestPath, allEntries);
  } finally {
    try { unlinkSync(lockPath); } catch { /* ignore — lock cleanup is best-effort */ }
  }
}

/** Inner migration logic, called only after the lockfile is held. */
async function migrateAllLocked(
  cwd: string,
  dir: string,
  manifestPath: string,
  allEntries: string[],
): Promise<void> {
  // Read existing manifest (if any) for resumability
  let manifest: MigrationManifest | null = null;
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as MigrationManifest;
    } catch {
      manifest = null;
    }
  }

  // If no manifest, build one from scanned legacy files
  if (!manifest) {
    const legacyFiles = allEntries.filter((e) => /^\d{4}-\d{2}-\d{2}\.json$/.test(e));
    if (legacyFiles.length === 0) return; // nothing to migrate

    // Create backup before touching anything
    const backupDir = join(cwd, ".phase2s", `sessions-backup-${todayDate()}`);
    await mkdir(backupDir, { recursive: true });
    for (const f of legacyFiles) {
      await copyFile(join(dir, f), join(backupDir, f));
    }

    // Write manifest
    const newEntries: MigrationEntry[] = legacyFiles.map((f) => ({
      originalName: f,
      newId: randomUUID(),
      done: false,
    }));
    manifest = { version: 1, entries: newEntries };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

    console.log(`Migrating sessions to v2 format (backup at ${backupDir.replace(cwd + "/", "")})`);
  }

  // Process unfinished entries
  // Hoist loop-invariant guards outside the loop.
  const resolvedDir = resolve(dir);
  const bareUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let anyMigrated = false;
  for (const entry of manifest.entries) {
    if (entry.done) continue;

    // Guard against path traversal: originalName must resolve inside dir.
    // A crafted manifest could use "../../../etc/passwd" as originalName.
    const oldPath = join(dir, entry.originalName);
    const resolvedOld = resolve(oldPath);
    if (!resolvedOld.startsWith(resolvedDir + "/") && resolvedOld !== resolvedDir) {
      console.error(chalk.yellow(`Skipping manifest entry with suspicious path: ${entry.originalName}`));
      continue;
    }
    // Also validate newId is a UUID so sessionPath() doesn't escape the sessions dir
    if (!bareUuidPattern.test(entry.newId)) {
      console.error(chalk.yellow(`Skipping manifest entry with non-UUID newId: ${entry.newId}`));
      continue;
    }

    const newPath = sessionPath(cwd, entry.newId);

    // Skip if original file was already renamed (crash after rename but before manifest update)
    if (!existsSync(oldPath)) {
      if (existsSync(newPath)) {
        // Already renamed — mark done
        entry.done = true;
        anyMigrated = true;
        writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
      }
      continue;
    }

    // Parse the legacy file
    let messages: Message[] = [];
    try {
      const raw = readFileSync(oldPath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        messages = parsed as Message[];
      } else if (
        typeof parsed === "object" &&
        parsed !== null &&
        (parsed as Record<string, unknown>).schemaVersion === 2
      ) {
        // Already migrated (shouldn't happen if manifest is consistent)
        entry.done = true;
        anyMigrated = true;
        writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
        continue;
      }
    } catch {
      // Corrupted file — skip, leave original in place
      continue;
    }

    // Build v2 content
    const now = new Date().toISOString();
    const v2: SessionV2 = {
      schemaVersion: 2,
      meta: {
        id: entry.newId,
        parentId: null,
        branchName: "main",
        createdAt: now,
        updatedAt: now,
      },
      messages,
    };

    // Write new file atomically, then retire old file
    const tmp = newPath + ".tmp";
    writeFileSync(tmp, JSON.stringify(v2, null, 2), { encoding: "utf-8", mode: 0o600 });
    renameSync(tmp, newPath);
    // Remove old file after successful write
    try { renameSync(oldPath, oldPath + ".migrated"); } catch { /* best-effort */ }

    entry.done = true;
    anyMigrated = true;
    // Flush manifest after each file so crash-resume works
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
  }

  // If the manifest says today's session was the active one, update state.json
  // to point to the new UUID (best-effort — only if state.json doesn't already exist)
  if (anyMigrated && !existsSync(replStatePath(cwd))) {
    const lastEntry = manifest.entries.filter((e) => e.done).pop();
    if (lastEntry) {
      writeReplState(cwd, { currentSessionId: lastEntry.newId });
    }
  }
}

// ---------------------------------------------------------------------------
// Clone
// ---------------------------------------------------------------------------

/**
 * Fork a session: copy its messages into a new session file with a new UUID.
 * The new session has parentId pointing to the source session's id.
 *
 * @param cwd        Project working directory
 * @param sourceId   UUID of the session to clone
 * @param branchName Optional branch name; defaults to "fork-YYYY-MM-DD"
 * @returns          The new session's id and file path
 */
export async function cloneSession(
  cwd: string,
  sourceId: string,
  branchName?: string,
): Promise<{ id: string; path: string; messageCount: number; branchName: string; createdAt: string; updatedAt: string }> {
  const srcPath = sessionPath(cwd, sourceId);

  // Load the source session
  let messages: Message[] = [];
  let sourceMeta: SessionMeta | null = null;
  try {
    const raw = await readFile(srcPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      (parsed as Record<string, unknown>).schemaVersion === 2
    ) {
      const s = parsed as SessionV2;
      messages = [...s.messages]; // deep copy
      sourceMeta = s.meta;
    } else if (Array.isArray(parsed)) {
      messages = [...(parsed as Message[])]; // deep copy
    } else {
      throw new Error(`Unrecognized session format in ${srcPath}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Session not found: ${sourceId}`);
    }
    if (err instanceof SyntaxError) {
      throw new Error(`Session file is corrupted and cannot be cloned: ${srcPath}. Delete it or restore from backup.`);
    }
    throw err;
  }

  const newId = randomUUID();
  const now = new Date().toISOString();
  const newMeta: SessionMeta = {
    id: newId,
    parentId: sourceMeta?.id ?? sourceId,
    branchName: branchName ?? `fork-${todayDate()}`,
    createdAt: now,
    updatedAt: now,
  };

  const newPath = sessionPath(cwd, newId);
  const v2: SessionV2 = { schemaVersion: 2, meta: newMeta, messages };

  await mkdir(dirname(newPath), { recursive: true });
  const tmp = newPath + ".tmp";
  await writeFile(tmp, JSON.stringify(v2, null, 2), { encoding: "utf-8", mode: 0o600 });
  renameSync(tmp, newPath);

  return { id: newId, path: newPath, messageCount: messages.length, branchName: newMeta.branchName, createdAt: newMeta.createdAt, updatedAt: newMeta.updatedAt };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * List all sessions in the sessions directory, sorted newest-first.
 * Skips files that fail to parse (corrupted) and migration artifacts.
 */
export async function listSessions(cwd: string): Promise<Array<{ meta: SessionMeta; path: string }>> {
  const dir = sessionsDir(cwd);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  // Only UUID.json files (not manifest, not .migrated, not .tmp)
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i;
  const jsonFiles = entries.filter((e) => uuidPattern.test(e));

  const results: Array<{ meta: SessionMeta; path: string }> = [];
  for (const f of jsonFiles) {
    const p = join(dir, f);
    try {
      const raw = await readFile(p, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed) &&
        (parsed as Record<string, unknown>).schemaVersion === 2
      ) {
        const meta = (parsed as SessionV2).meta;
        // Validate meta.id as UUID — prevents shell injection if a crafted file has
        // shell metacharacters in meta.id (used as {2} in fzf --preview command).
        if (!uuidPattern.test(`${meta.id}.json`)) {
          continue;
        }
        results.push({ meta, path: p });
      }
    } catch {
      // Skip corrupted files
    }
  }

  // Sort newest-first by createdAt
  results.sort((a, b) => b.meta.createdAt.localeCompare(a.meta.createdAt));
  return results;
}

/**
 * Get the first user message from a session file for display in the browser.
 * Returns empty string if not found or on parse error.
 * Sanitizes control characters (including ANSI escape codes) before returning.
 */
export async function getSessionPreview(path: string): Promise<string> {
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    let messages: Message[] = [];
    if (Array.isArray(parsed)) {
      messages = parsed as Message[];
    } else if (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as Record<string, unknown>).schemaVersion === 2
    ) {
      messages = (parsed as SessionV2).messages;
    }
    const first = messages.find((m) => m.role === "user");
    if (!first) return "";
    // Strip ANSI escape codes and control characters
    return sanitizeForTerminal(first.content ?? "").slice(0, 80);
  } catch {
    return "";
  }
}

/**
 * Strip ANSI escape codes and ASCII control characters from a string.
 * Prevents terminal escape injection in fzf/table display.
 */
export function sanitizeForTerminal(s: string): string {
  // Remove ANSI escape sequences (ESC[ ... m and similar)
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/[\x00-\x1f\x7f]/g, " ").trim();
}
