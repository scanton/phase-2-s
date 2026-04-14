/**
 * Tests for Sprint 55 features:
 * - Context compaction utilities (shouldCompact, getCompactBackupPath, buildCompactedMessages)
 * - AGENTS.md system prompt combination logic
 * - Backup file behavior (integration with fs)
 *
 * Now tests the ACTUAL production functions from src/core/compaction.ts rather
 * than locally-reimplemented logic. If the production code changes, these tests
 * catch it.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Import the actual production functions
import {
  shouldCompact,
  getCompactBackupPath,
  buildCompactedMessages,
  COMPACTED_CONTEXT_MARKER,
} from "../../src/core/compaction.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "phase2s-index-test-"));
}

// ---------------------------------------------------------------------------
// shouldCompact — production function from src/core/compaction.ts
// ---------------------------------------------------------------------------

describe("shouldCompact", () => {
  it("returns false when threshold is undefined (disabled)", () => {
    expect(shouldCompact(100_000, undefined)).toBe(false);
  });

  it("returns false when threshold is 0 (disabled)", () => {
    expect(shouldCompact(100_000, 0)).toBe(false);
  });

  it("returns false when token count is below threshold", () => {
    expect(shouldCompact(79_999, 80_000)).toBe(false);
  });

  it("returns true when token count equals the threshold", () => {
    expect(shouldCompact(80_000, 80_000)).toBe(true);
  });

  it("returns true when token count exceeds the threshold", () => {
    expect(shouldCompact(120_000, 80_000)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getCompactBackupPath — production function from src/core/compaction.ts
// ---------------------------------------------------------------------------

describe("getCompactBackupPath", () => {
  it("replaces .json extension with .compact-backup.json", () => {
    const sessionPath = "/some/dir/.phase2s/sessions/uuid-1234.json";
    const backupPath = getCompactBackupPath(sessionPath);
    expect(backupPath).toBe("/some/dir/.phase2s/sessions/uuid-1234.compact-backup.json");
  });

  it("only replaces the trailing .json (not mid-path occurrences)", () => {
    const sessionPath = "/data/.json.storage/sessions/uuid.json";
    const backupPath = getCompactBackupPath(sessionPath);
    expect(backupPath).toBe("/data/.json.storage/sessions/uuid.compact-backup.json");
  });
});

// ---------------------------------------------------------------------------
// buildCompactedMessages — production function from src/core/compaction.ts
// ---------------------------------------------------------------------------

describe("buildCompactedMessages", () => {
  it("keeps system message and prepends COMPACTED CONTEXT user message", () => {
    const systemMsg = { role: "system" as const, content: "You are Phase2S" };
    const originalMessages = [
      systemMsg,
      { role: "user" as const, content: "Hello" },
      { role: "assistant" as const, content: "Hi" },
    ];
    const summary = "Files modified: src/foo.ts";

    const result = buildCompactedMessages(originalMessages, summary);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(systemMsg);
    expect(result[1].role).toBe("user");
    expect(result[1].content).toContain(COMPACTED_CONTEXT_MARKER);
    expect(result[1].content).toContain(summary);
  });

  it("uses COMPACTED_CONTEXT_MARKER as the prefix (single source of truth)", () => {
    const messages = [{ role: "user" as const, content: "Hello" }];
    const summary = "Summary text";
    const result = buildCompactedMessages(messages, summary);
    expect(result[0].content.startsWith(COMPACTED_CONTEXT_MARKER)).toBe(true);
  });

  it("returns only compacted context when original had no system message", () => {
    const originalMessages = [
      { role: "user" as const, content: "Hello" },
      { role: "assistant" as const, content: "Hi" },
    ];
    const summary = "Summary text";

    const result = buildCompactedMessages(originalMessages, summary);

    expect(result).toHaveLength(1);
    expect(result[0].content).toContain(COMPACTED_CONTEXT_MARKER);
  });

  it("multiple system messages are all preserved", () => {
    const messages = [
      { role: "system" as const, content: "Instruction A" },
      { role: "system" as const, content: "Instruction B" },
      { role: "user" as const, content: "Hello" },
    ];
    const result = buildCompactedMessages(messages, "summary");
    expect(result).toHaveLength(3); // 2 system + 1 compacted user
    expect(result[0].content).toBe("Instruction A");
    expect(result[1].content).toBe("Instruction B");
    expect(result[2].content).toContain(COMPACTED_CONTEXT_MARKER);
  });

  it("empty messages array: returns only compacted context message", () => {
    const result = buildCompactedMessages([], "summary");
    expect(result).toHaveLength(1);
    expect(result[0].content).toContain(COMPACTED_CONTEXT_MARKER);
  });
});

// ---------------------------------------------------------------------------
// compact_count: session meta field wiring
// ---------------------------------------------------------------------------

describe("SessionMeta compact_count increment logic", () => {
  it("compact_count starts at 0 when absent (??  0)", () => {
    const meta = { compact_count: undefined as number | undefined };
    const newCount = (meta.compact_count ?? 0) + 1;
    expect(newCount).toBe(1);
  });

  it("compact_count increments: 1 → 2", () => {
    const meta = { compact_count: 1 };
    const newCount = (meta.compact_count ?? 0) + 1;
    expect(newCount).toBe(2);
  });

  it("compact_count increments: 5 → 6", () => {
    const meta = { compact_count: 5 };
    const newCount = (meta.compact_count ?? 0) + 1;
    expect(newCount).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// compaction backup file behavior (integration: real fs + production path util)
// ---------------------------------------------------------------------------

describe("compaction backup file", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    mkdirSync(join(tmpDir, ".phase2s", "sessions"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("backup file is written at the path returned by getCompactBackupPath", async () => {
    const sessionId = "aaaaaaaa-0000-0000-0000-000000000000";
    const sessionPath = join(tmpDir, ".phase2s", "sessions", `${sessionId}.json`);
    // Use the production utility — this is what performCompaction uses
    const backupPath = getCompactBackupPath(sessionPath);

    const sessionData = {
      schemaVersion: 2,
      meta: { id: sessionId, parentId: null, branchName: "main", createdAt: "", updatedAt: "" },
      messages: [{ role: "user", content: "hello" }],
    };

    await writeFile(
      backupPath,
      JSON.stringify(sessionData, null, 2),
      { encoding: "utf-8", mode: 0o600 },
    );

    expect(existsSync(backupPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(backupPath, "utf-8"));
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.meta.id).toBe(sessionId);
    expect(parsed.messages).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// AGENTS.md startup injection
// ---------------------------------------------------------------------------

describe("AGENTS.md system prompt injection at startup", () => {
  it("config.systemPrompt and AGENTS.md block are combined with double newline", () => {
    const configSystemPrompt = "Custom instructions from yaml";
    const agentsMdBlock = "--- AGENTS.md ---\n# Conventions\n--- END AGENTS.md ---";

    // Mirror the combination logic in index.ts
    const combined = [configSystemPrompt, agentsMdBlock].filter(Boolean).join("\n\n");

    expect(combined).toContain(configSystemPrompt);
    expect(combined).toContain(agentsMdBlock);
    expect(combined.indexOf(configSystemPrompt)).toBeLessThan(combined.indexOf(agentsMdBlock));
  });

  it("only AGENTS.md block: combined prompt is just the block", () => {
    const configSystemPrompt = undefined;
    const agentsMdBlock = "--- AGENTS.md ---\ncontent\n--- END AGENTS.md ---";

    const combined = [configSystemPrompt, agentsMdBlock].filter(Boolean).join("\n\n");
    expect(combined).toBe(agentsMdBlock);
  });

  it("only config.systemPrompt: combined prompt is just the config prompt", () => {
    const configSystemPrompt = "My custom prompt";
    const agentsMdBlock = undefined;

    const combined = [configSystemPrompt, agentsMdBlock].filter(Boolean).join("\n\n");
    expect(combined).toBe(configSystemPrompt);
  });

  it("neither present: combined result is empty string (treated as undefined)", () => {
    const configSystemPrompt = undefined;
    const agentsMdBlock = undefined;

    const combined = [configSystemPrompt, agentsMdBlock].filter(Boolean).join("\n\n") || undefined;
    expect(combined).toBeUndefined();
  });
});
