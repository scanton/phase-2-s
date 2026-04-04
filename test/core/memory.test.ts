import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadLearnings, formatLearningsForPrompt, type Learning } from "../../src/core/memory.js";

/**
 * Tests for the memory system: loadLearnings() and formatLearningsForPrompt().
 *
 * These functions read .phase2s/memory/learnings.jsonl from the project root
 * and format the contents for injection into the system prompt.
 */
describe("loadLearnings()", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(process.cwd(), ".test-memory-"));
    // Create the .phase2s/memory directory inside tmp
    await mkdir(join(tmpDir, ".phase2s", "memory"), { recursive: true });
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true }).catch(() => {});
  });

  it("returns [] when learnings.jsonl does not exist", async () => {
    const results = await loadLearnings(tmpDir);
    expect(results).toEqual([]);
  });

  it("parses valid JSONL lines into Learning objects", async () => {
    const filePath = join(tmpDir, ".phase2s", "memory", "learnings.jsonl");
    await writeFile(
      filePath,
      [
        '{"key":"use-vitest","insight":"This project uses vitest not jest","type":"preference","confidence":1,"ts":"2026-04-04T00:00:00Z"}',
        '{"key":"codex-path","insight":"The codex binary lives at /opt/homebrew/bin/codex","type":"tool","confidence":1,"ts":"2026-04-04T01:00:00Z"}',
      ].join("\n") + "\n",
      "utf-8",
    );

    const results = await loadLearnings(tmpDir);
    expect(results).toHaveLength(2);
    expect(results[0].key).toBe("use-vitest");
    expect(results[0].insight).toBe("This project uses vitest not jest");
    expect(results[0].type).toBe("preference");
    expect(results[1].key).toBe("codex-path");
    expect(results[1].insight).toBe("The codex binary lives at /opt/homebrew/bin/codex");
  });

  it("skips invalid JSON lines silently", async () => {
    const dir2 = join(tmpDir, "bad-lines");
    await mkdir(join(dir2, ".phase2s", "memory"), { recursive: true });
    await writeFile(
      join(dir2, ".phase2s", "memory", "learnings.jsonl"),
      [
        '{"key":"valid-key","insight":"valid insight"}',
        "this is not json at all",
        '{"key":"another-valid","insight":"also valid"}',
        "",
        "   ",
      ].join("\n"),
      "utf-8",
    );

    const results = await loadLearnings(dir2);
    expect(results).toHaveLength(2);
    expect(results[0].key).toBe("valid-key");
    expect(results[1].key).toBe("another-valid");
  });

  it("skips lines missing required key or insight fields", async () => {
    const dir3 = join(tmpDir, "missing-fields");
    await mkdir(join(dir3, ".phase2s", "memory"), { recursive: true });
    await writeFile(
      join(dir3, ".phase2s", "memory", "learnings.jsonl"),
      [
        '{"key":"no-insight-here"}',
        '{"insight":"no key here"}',
        '{"key":"","insight":"empty key"}',
        '{"key":"good-key","insight":"good insight"}',
      ].join("\n"),
      "utf-8",
    );

    const results = await loadLearnings(dir3);
    expect(results).toHaveLength(1);
    expect(results[0].key).toBe("good-key");
  });
});

describe("formatLearningsForPrompt()", () => {
  it("returns empty string for empty learnings array", () => {
    const result = formatLearningsForPrompt([]);
    expect(result).toBe("");
  });

  it("formats learnings as a block with header and count", () => {
    const learnings: Learning[] = [
      { key: "use-vitest", insight: "This project uses vitest not jest", type: "preference" },
      { key: "strict-mode", insight: "Always use TypeScript strict mode", type: "preference" },
    ];
    const result = formatLearningsForPrompt(learnings);

    expect(result).toContain("## Project memory");
    expect(result).toContain("learnings from previous sessions");
    expect(result).toContain("- [use-vitest]: This project uses vitest not jest");
    expect(result).toContain("- [strict-mode]: Always use TypeScript strict mode");
    expect(result).toContain("2 learnings loaded from .phase2s/memory/learnings.jsonl");
  });

  it("trims oldest learnings first when total chars exceed budget", () => {
    // Create a learning with a very long insight to force trimming
    const longInsight = "x".repeat(1200);
    const learnings: Learning[] = [
      { key: "oldest", insight: longInsight, type: "preference" },
      { key: "second", insight: longInsight, type: "preference" },
      { key: "newest", insight: "short insight", type: "decision" },
    ];

    const result = formatLearningsForPrompt(learnings);

    // Oldest should be trimmed, newest should survive
    expect(result).not.toContain("[oldest]:");
    expect(result).toContain("[newest]: short insight");
    // Result should be non-empty
    expect(result.length).toBeGreaterThan(0);
  });

  it("uses singular 'learning' for exactly one entry", () => {
    const learnings: Learning[] = [
      { key: "single", insight: "only one entry", type: "preference" },
    ];
    const result = formatLearningsForPrompt(learnings);
    expect(result).toContain("1 learning loaded");
    expect(result).not.toContain("learnings loaded"); // no plural
  });
});
