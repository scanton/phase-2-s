/**
 * Tests for loadAgentsMd (src/core/agents-md.ts).
 *
 * node:fs/promises is mocked so we can simulate file system state without
 * touching the real filesystem.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadAgentsMd, formatAgentsMdBlock } from "../../src/core/agents-md.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock node:fs/promises so we control file reads.
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

// Mock node:os so homedir() returns a controlled path.
vi.mock("node:os", () => ({
  homedir: vi.fn().mockReturnValue("/home/testuser"),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getReadFileMock() {
  const { readFile } = await import("node:fs/promises");
  return vi.mocked(readFile);
}

function makeEnoent(): NodeJS.ErrnoException {
  const err = new Error("ENOENT: no such file or directory") as NodeJS.ErrnoException;
  err.code = "ENOENT";
  return err;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("loadAgentsMd", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("project-level AGENTS.md found: returns its content", async () => {
    const readFile = await getReadFileMock();
    readFile.mockImplementation((path) => {
      if (String(path).includes("testuser")) return Promise.reject(makeEnoent()); // user-global missing
      return Promise.resolve("# Project conventions\n- No semicolons");
    });

    const result = await loadAgentsMd("/my/project");
    expect(result).toBe("# Project conventions\n- No semicolons");
  });

  it("user-global AGENTS.md found when project-level missing: returns fallback content", async () => {
    const readFile = await getReadFileMock();
    readFile.mockImplementation((path) => {
      if (String(path).includes("testuser")) return Promise.resolve("# Global rules\n- Always write tests");
      return Promise.reject(makeEnoent()); // project-level missing
    });

    const result = await loadAgentsMd("/my/project");
    expect(result).toBe("# Global rules\n- Always write tests");
  });

  it("both exist: user-global content appears first, project content appended after", async () => {
    const readFile = await getReadFileMock();
    readFile.mockImplementation((path) => {
      if (String(path).includes("testuser")) return Promise.resolve("GLOBAL CONTENT");
      return Promise.resolve("PROJECT CONTENT");
    });

    const result = await loadAgentsMd("/my/project");
    // Verify exact separator: global + "\n\n" + project
    expect(result).toBe("GLOBAL CONTENT\n\nPROJECT CONTENT");
  });

  it("neither exists: returns null", async () => {
    const readFile = await getReadFileMock();
    readFile.mockRejectedValue(makeEnoent());

    const result = await loadAgentsMd("/my/project");
    expect(result).toBeNull();
  });

  it("empty file: treated as absent (no injection)", async () => {
    const readFile = await getReadFileMock();
    readFile.mockResolvedValue("");

    const result = await loadAgentsMd("/my/project");
    expect(result).toBeNull();
  });

  it("whitespace-only file: treated as absent", async () => {
    const readFile = await getReadFileMock();
    readFile.mockResolvedValue("   \n\t\n   ");

    const result = await loadAgentsMd("/my/project");
    expect(result).toBeNull();
  });

  it("read error (non-ENOENT): warns and skips that file, still returns the other", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const readFile = await getReadFileMock();
    readFile.mockImplementation((path) => {
      if (String(path).includes("testuser")) {
        const err = new Error("Permission denied") as NodeJS.ErrnoException;
        err.code = "EACCES";
        return Promise.reject(err);
      }
      return Promise.resolve("Project instructions");
    });

    const result = await loadAgentsMd("/my/project");
    // Project-level should still be returned
    expect(result).toBe("Project instructions");
    // Warning should have been printed for the user-global read error
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("⚠"));
    warnSpy.mockRestore();
  });

  it("8k char cap: truncates and warns when combined content exceeds 8192 chars", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const readFile = await getReadFileMock();
    // Generate content just over 8k chars
    const bigContent = "A".repeat(9000);
    readFile.mockImplementation((path) => {
      if (String(path).includes("testuser")) return Promise.reject(makeEnoent());
      return Promise.resolve(bigContent);
    });

    const result = await loadAgentsMd("/my/project");
    expect(result).not.toBeNull();
    expect(result!.length).toBe(8192);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("truncated"));
    warnSpy.mockRestore();
  });

  it("8k char cap: truncates at last newline boundary when content has newlines", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const readFile = await getReadFileMock();
    // Put a newline at position 8000, then more content up to 9000 chars.
    // Truncation should land at position 8000, not 8192.
    const beforeNewline = "C".repeat(8000);
    const afterNewline = "D".repeat(999);
    const bigContent = beforeNewline + "\n" + afterNewline;
    readFile.mockImplementation((path) => {
      if (String(path).includes("testuser")) return Promise.reject(makeEnoent());
      return Promise.resolve(bigContent);
    });

    const result = await loadAgentsMd("/my/project");
    expect(result).not.toBeNull();
    // Should truncate at the newline at position 8000, not at 8192
    expect(result!.length).toBe(8000);
    expect(result!.endsWith("C")).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("truncated"));
    warnSpy.mockRestore();
  });

  it("content exactly at 8k chars: not truncated, no warning", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const readFile = await getReadFileMock();
    const exactContent = "B".repeat(8192);
    readFile.mockImplementation((path) => {
      if (String(path).includes("testuser")) return Promise.reject(makeEnoent());
      return Promise.resolve(exactContent);
    });

    const result = await loadAgentsMd("/my/project");
    expect(result!.length).toBe(8192);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("reads from correct paths: user-global uses homedir, project uses cwd", async () => {
    const readFile = await getReadFileMock();
    readFile.mockRejectedValue(makeEnoent());

    await loadAgentsMd("/my/custom/project");

    const calledPaths = readFile.mock.calls.map(([p]) => String(p));
    expect(calledPaths.some((p) => p.includes("/home/testuser"))).toBe(true);
    expect(calledPaths.some((p) => p.includes("/my/custom/project"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// formatAgentsMdBlock
// ---------------------------------------------------------------------------

describe("formatAgentsMdBlock", () => {
  it("wraps content in labeled block", () => {
    const result = formatAgentsMdBlock("my instructions");
    expect(result).toBe("--- AGENTS.md ---\nmy instructions\n--- END AGENTS.md ---");
  });
});
