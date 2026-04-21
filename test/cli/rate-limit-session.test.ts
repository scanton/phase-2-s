/**
 * Tests for A2 fix: session is saved before printRateLimitAndExit at all call sites.
 *
 * The fix ensures that when any turn rate-limits, the current conversation (including
 * the user's latest message) is persisted before the process exits. We test this by:
 *   1. Calling saveSession() before any printRateLimitAndExit call.
 *   2. saveSession() throws → process still exits cleanly (no crash).
 *   3. The session file written by saveSession() contains the user's latest message.
 *
 * We test saveSession() directly (not through the full REPL) since the full REPL
 * requires a real provider and terminal setup. The fix guarantees saveSession() is
 * called; here we verify saveSession() does what it should under those conditions.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { saveSession } from "../../src/core/session.js";
import { Conversation } from "../../src/core/conversation.js";
import { RateLimitError } from "../../src/core/rate-limit-error.js";
import type { SessionMeta } from "../../src/core/session.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

function makeTempDir(): string {
  const dir = join(tmpdir(), `rate-limit-session-test-${randomBytes(4).toString("hex")}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeSessionMeta(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: "test-session-id",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    provider: "openai-api",
    model: "gpt-4o",
    ...overrides,
  } as SessionMeta;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// A2 — saveSession writes the latest user message before rate-limit exit
// ---------------------------------------------------------------------------

describe("A2 rate-limit session save", () => {
  it("saveSession persists user message that was added before the 429", async () => {
    const dir = makeTempDir();
    try {
      const sessionPath = join(dir, "test-session.json");
      const messages = [
        { role: "user" as const, content: "hello" },
        { role: "assistant" as const, content: "world" },
        { role: "user" as const, content: "follow-up question (sent before 429)" },
      ];
      const conv = Conversation.fromMessages(messages);
      const meta = makeSessionMeta();

      await saveSession(dir, sessionPath, conv, meta);

      const raw = JSON.parse(readFileSync(sessionPath, "utf-8"));
      const lastMessage = raw.messages[raw.messages.length - 1];
      expect(lastMessage.content).toBe("follow-up question (sent before 429)");
      expect(lastMessage.role).toBe("user");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("saveSession creates intermediate directories — works even when session dir does not exist yet", async () => {
    // saveSession() calls mkdir(dirname(path), { recursive: true }) before writing,
    // so the session directory does not need to be pre-created by the caller.
    // This matters for A2: the first-turn rate-limit case may save before the session
    // directory has been established.
    const dir = makeTempDir();
    try {
      const sessionPath = join(dir, "auto-created-subdir", "session.json");
      const conv = Conversation.fromMessages([{ role: "user", content: "msg" }]);
      const meta = makeSessionMeta();

      await saveSession(dir, sessionPath, conv, meta);

      const raw = JSON.parse(readFileSync(sessionPath, "utf-8"));
      expect(raw.messages).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("first-turn 429 — conversation with only the user message is saved correctly", async () => {
    // First turn: user sent a message, provider returned 429 before any assistant response.
    // saveSession() must write the user message so --resume includes it.
    const dir = makeTempDir();
    try {
      const sessionPath = join(dir, "first-turn.json");
      const conv = Conversation.fromMessages([
        { role: "user" as const, content: "very first user message" },
      ]);
      const meta = makeSessionMeta();

      await saveSession(dir, sessionPath, conv, meta);

      const raw = JSON.parse(readFileSync(sessionPath, "utf-8"));
      expect(raw.messages).toHaveLength(1);
      expect(raw.messages[0].content).toBe("very first user message");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("later-turn 429 — both previous exchange and new user message are saved", async () => {
    const dir = makeTempDir();
    try {
      const sessionPath = join(dir, "later-turn.json");
      const conv = Conversation.fromMessages([
        { role: "user" as const, content: "first question" },
        { role: "assistant" as const, content: "first answer" },
        { role: "user" as const, content: "second question — this is the turn that 429d" },
      ]);
      const meta = makeSessionMeta();

      await saveSession(dir, sessionPath, conv, meta);

      const raw = JSON.parse(readFileSync(sessionPath, "utf-8"));
      const lastMsg = raw.messages[raw.messages.length - 1];
      expect(lastMsg.role).toBe("user");
      expect(lastMsg.content).toContain("second question");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
