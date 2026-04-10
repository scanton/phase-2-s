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
import { existsSync, mkdirSync, renameSync, writeFileSync, readFileSync, unlinkSync, statSync } from "node:fs";
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

/** One entry in the session index, cached for fast listing. */
export interface SessionIndexEntry {
  id: string;
  parentId: string | null;
  branchName: string;
  createdAt: string;
  updatedAt: string;
  /** First user message, sanitized and truncated to 80 chars. */
  firstMessage: string;
}

/** The session index file — one entry per session, keyed by UUID. */
export interface SessionIndex {
  version: 1;
  sessions: Record<string, SessionIndexEntry>;
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

function sessionIndexPath(cwd: string): string {
  return join(sessionsDir(cwd), "index.json");
}

function sessionIndexLockPath(cwd: string): string {
  return join(sessionsDir(cwd), ".index.lock");
}

function replStateLockPath(cwd: string): string {
  return join(cwd, ".phase2s", ".state.lock");
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Stale lock timeout: locks older than this are assumed to belong to crashed processes. */
const STALE_LOCK_TIMEOUT_MS = 30_000;
/** Delay before retrying lock acquisition when contended. */
const LOCK_RETRY_DELAY_MS = 50;
/** Maximum characters to store/display as the session preview (first user message). */
const SESSION_PREVIEW_MAX_CHARS = 80;

// ---------------------------------------------------------------------------
// Lock helpers
// ---------------------------------------------------------------------------

/**
 * Acquires a POSIX exclusive-create lock file.
 * Stale locks (older than STALE_LOCK_TIMEOUT_MS) are removed automatically.
 * Retries once after LOCK_RETRY_DELAY_MS on contention.
 *
 * NOTE: `{ flag: "wx" }` is atomic on local POSIX filesystems (Linux, macOS).
 * It is NOT guaranteed atomic on NFSv2/v3 mounts. For NFS environments,
 * consider a fencing token or a distributed lock service.
 *
 * @returns `true` if the lock was acquired, `false` if we're proceeding without it.
 * @throws  Any error other than EEXIST from the underlying writeFileSync.
 */
async function acquirePosixLock(lockFile: string): Promise<boolean> {
  // Stale lock detection: if the lock is older than 30 s, the process that
  // created it has almost certainly crashed — remove it before trying to acquire.
  try {
    const stat = statSync(lockFile);
    if (Date.now() - stat.mtimeMs > STALE_LOCK_TIMEOUT_MS) unlinkSync(lockFile);
  } catch {
    /* no lock file — normal path */
  }

  // Acquire lock. "wx" = O_WRONLY | O_CREAT | O_EXCL — atomic on POSIX.
  const tryAcquire = (): boolean => {
    try {
      writeFileSync(lockFile, process.pid.toString(), { flag: "wx", mode: 0o600 });
      return true;
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw e;
    }
  };

  if (tryAcquire()) return true;

  // Another process holds the lock — wait and retry once.
  await new Promise<void>((resolve) => setTimeout(resolve, LOCK_RETRY_DELAY_MS));
  if (tryAcquire()) return true;

  // Still contended after retry — proceed without lock.
  // This preserves liveness over strict mutual exclusion.
  return false;
}

/**
 * Release a POSIX lock file acquired by acquirePosixLock().
 *
 * Reads the lock file's PID before unlinking. Only unlinks if the PID matches
 * the current process — guards against the ABA scenario where a stale-lock
 * cleanup removed our lock and another process acquired a new one before our
 * finally block runs. If the PID doesn't match, the unlink is skipped silently.
 */
export function releasePosixLock(lockFile: string): void {
  try {
    const content = readFileSync(lockFile, "utf-8");
    const pid = parseInt(content.trim(), 10);
    if (!Number.isInteger(pid) || pid !== process.pid) return; // not our lock (or unreadable) — skip
    unlinkSync(lockFile);
  } catch { /* already gone — fine */ }
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
 * Uses a POSIX exclusive-create lock (.state.lock) to serialize concurrent
 * writers (e.g., two REPL instances in split terminals). Stale locks older
 * than 30 s are removed automatically (handles crashed processes).
 * Retries once after 50 ms on contention.
 */
export async function writeReplState(cwd: string, state: ReplState): Promise<void> {
  const phase2sDir = join(cwd, ".phase2s");
  mkdirSync(phase2sDir, { recursive: true });

  const lockFile = replStateLockPath(cwd);
  const lockAcquired = await acquirePosixLock(lockFile);

  try {
    const path = replStatePath(cwd);
    const tmp = path + ".tmp";
    writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
    renameSync(tmp, path);
  } finally {
    if (lockAcquired) releasePosixLock(lockFile);
  }
}

// ---------------------------------------------------------------------------
// Session file I/O
// ---------------------------------------------------------------------------

/**
 * Save a conversation in v2 format.
 * Writes { schemaVersion: 2, meta, messages } atomically (tmp → rename) with mode 0o600.
 *
 * Also triggers a best-effort fire-and-forget upsert of the session index
 * (.phase2s/sessions/index.json). Index failures are logged to stderr as
 * chalk.dim warnings but do NOT throw — they never interrupt the user.
 *
 * @param cwd  Project working directory (parent of .phase2s/).
 * @param path Full path to the session JSON file.
 */
export async function saveSession(cwd: string, path: string, conv: Conversation, meta: SessionMeta): Promise<void> {
  const messages = conv.getMessages();
  const updatedAt = new Date().toISOString();
  const updated: SessionV2 = {
    schemaVersion: 2,
    meta: { ...meta, updatedAt },
    messages,
  };
  await mkdir(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  await writeFile(tmp, JSON.stringify(updated, null, 2), { encoding: "utf-8", mode: 0o600 });
  renameSync(tmp, path);

  // Update session index (best-effort — don't interrupt the user on failure)
  upsertSessionIndex(cwd, { ...meta, updatedAt }, extractFirstMessage(messages)).catch((err: unknown) => {
    console.error(chalk.dim(`[phase2s] session index update failed: ${err instanceof Error ? err.message : String(err)}`));
  });
}

// ---------------------------------------------------------------------------
// Session index — O(1) listing cache
// ---------------------------------------------------------------------------

/**
 * Read the session index from disk.
 * Returns null if the index doesn't exist or is corrupt.
 */
export async function readSessionIndex(cwd: string): Promise<SessionIndex | null> {
  try {
    const raw = await readFile(sessionIndexPath(cwd), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as Record<string, unknown>).version === 1
    ) {
      return parsed as SessionIndex;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Upsert one session's entry in the index.
 * Reads the current index (or starts fresh), merges the entry, writes atomically.
 * Serialized with a POSIX exclusive-create lock (.index.lock) to prevent
 * concurrent upserts from losing each other's updates.
 */
export async function upsertSessionIndex(cwd: string, meta: SessionMeta & { updatedAt: string }, firstMessage: string): Promise<void> {
  const indexPath = sessionIndexPath(cwd);
  await mkdir(dirname(indexPath), { recursive: true });

  const lockFile = sessionIndexLockPath(cwd);
  const lockAcquired = await acquirePosixLock(lockFile);

  try {
    let index = await readSessionIndex(cwd);
    if (!index) {
      index = { version: 1, sessions: {} };
    }

    index.sessions[meta.id] = {
      id: meta.id,
      parentId: meta.parentId,
      branchName: meta.branchName,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      firstMessage,
    };

    const tmp = indexPath + ".tmp." + process.pid;
    await writeFile(tmp, JSON.stringify(index, null, 2), { encoding: "utf-8", mode: 0o600 });
    renameSync(tmp, indexPath);
  } finally {
    if (lockAcquired) releasePosixLock(lockFile);
  }
}

/**
 * Rebuild the session index from scratch by scanning all session files.
 * Called automatically when the index is missing or corrupt.
 *
 * Acquires `.index.lock` before writing to prevent interleaving with concurrent
 * `upsertSessionIndex` calls. Returns null if the lock is held — the caller in
 * `listSessions` handles this gracefully by returning an empty result set.
 * No explicit retry is needed: the fallback disk-scan path in `listSessions` covers it.
 */
export async function rebuildSessionIndex(cwd: string): Promise<SessionIndex | null> {
  const dir = sessionsDir(cwd);

  // Scan the sessions directory first. If it doesn't exist there is nothing to
  // rebuild and nothing to write — return an empty index without touching any lock.
  // acquirePosixLock would ENOENT if the parent directory is missing, so this
  // early-return also avoids that failure mode.
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return { version: 1, sessions: {} };
  }

  // Acquire the index lock before writing. Without this, a concurrent
  // upsertSessionIndex could interleave after our rename and lose its update.
  const lockFile = sessionIndexLockPath(cwd);
  const acquired = await acquirePosixLock(lockFile);
  if (!acquired) {
    // Lock is held by a concurrent upsert. Skip this rebuild attempt.
    // Safe to skip: listSessions() falls back to a full disk scan when the index
    // is missing or invalid, so callers are resilient regardless. The concurrent
    // upsert will write a fresh, consistent entry in the common case.
    return null;
  }

  try {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i;
    const jsonFiles = entries.filter((e) => uuidPattern.test(e));

    const index: SessionIndex = { version: 1, sessions: {} };
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
          const { meta, messages } = parsed as SessionV2;
          if (!uuidPattern.test(`${meta.id}.json`)) continue;
          index.sessions[meta.id] = {
            id: meta.id,
            parentId: meta.parentId,
            branchName: meta.branchName,
            createdAt: meta.createdAt,
            updatedAt: meta.updatedAt,
            firstMessage: extractFirstMessage(messages as Message[]),
          };
        }
      } catch {
        /* skip corrupt files */
      }
    }

    // Write the rebuilt index to disk (best-effort).
    // Use a per-process tmp path to avoid colliding with concurrent upsertSessionIndex writes.
    try {
      const indexPath = sessionIndexPath(cwd);
      await mkdir(dirname(indexPath), { recursive: true });
      const tmp = indexPath + ".tmp." + process.pid;
      await writeFile(tmp, JSON.stringify(index, null, 2), { encoding: "utf-8", mode: 0o600 });
      renameSync(tmp, indexPath);
    } catch {
      /* best-effort */
    }

    return index;
  } finally {
    releasePosixLock(lockFile);
  }
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
      await writeReplState(cwd, { currentSessionId: lastEntry.newId });
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

  // Update session index with the new clone (best-effort)
  upsertSessionIndex(cwd, newMeta, extractFirstMessage(messages)).catch((err: unknown) => {
    console.error(chalk.dim(`[phase2s] session index update failed: ${err instanceof Error ? err.message : String(err)}`));
  });

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
 * Extract the first user message from a message list for index/preview display.
 * Sanitizes control characters and truncates to 80 chars.
 */
function extractFirstMessage(messages: Message[]): string {
  const first = messages.find((m) => m.role === "user");
  return sanitizeForTerminal(first?.content ?? "").slice(0, SESSION_PREVIEW_MAX_CHARS);
}

/**
 * List all sessions in the sessions directory, sorted newest-first.
 *
 * Reads from the session index (O(1) file reads) when available.
 * Falls back to scanning all session files if the index is missing or corrupt,
 * and rebuilds the index from the scan result.
 */
export async function listSessions(cwd: string): Promise<Array<{ meta: SessionMeta; path: string; firstMessage: string }>> {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i;
  const dir = sessionsDir(cwd);

  // Fast path: read from index
  const index = await readSessionIndex(cwd);
  if (index) {
    const results = Object.values(index.sessions)
      .filter((entry) => uuidPattern.test(`${entry.id}.json`))
      .map((entry) => ({
        meta: {
          id: entry.id,
          parentId: entry.parentId,
          branchName: entry.branchName,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        },
        path: join(dir, `${entry.id}.json`),
        firstMessage: entry.firstMessage,
      }))
      // Stale entries (sessions deleted from disk since last index write) are silently
      // skipped here. They accumulate in index.json until the next full rebuildSessionIndex().
      // No active pruning is needed — the next rebuild cleans them up.
      .filter((e) => existsSync(e.path));
    results.sort((a, b) => b.meta.createdAt.localeCompare(a.meta.createdAt));
    return results;
  }

  // Slow path: scan all session files, then rebuild the index.
  // rebuildSessionIndex returns null if .index.lock is held by a concurrent upsert;
  // in that case return an empty list — the caller can retry.
  const rebuiltIndex = await rebuildSessionIndex(cwd);
  if (!rebuiltIndex) return [];
  const results = Object.values(rebuiltIndex.sessions)
    .filter((entry) => uuidPattern.test(`${entry.id}.json`))
    .map((entry) => ({
      meta: {
        id: entry.id,
        parentId: entry.parentId,
        branchName: entry.branchName,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      },
      path: join(dir, `${entry.id}.json`),
      firstMessage: entry.firstMessage,
    }))
    .filter((e) => existsSync(e.path)); // Stale index entries skipped (same as fast-path)
  results.sort((a, b) => b.meta.createdAt.localeCompare(a.meta.createdAt));
  return results;
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
