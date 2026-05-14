import { describe, it, expect } from "vitest";
import { findGitRoot } from "./gitRoot.ts";

describe("findGitRoot", () => {
  it("returns (unknown) for empty string", () => {
    expect(findGitRoot("")).toBe("(unknown)");
  });

  it("extracts project root from canonical .phase2s/specs/ path", () => {
    expect(
      findGitRoot("/Users/alice/dev/my-app/.phase2s/specs/2026-05-13-abc.md")
    ).toBe("/Users/alice/dev/my-app");
  });

  it("extracts project root from .phase2s/ sub-path (non-specs)", () => {
    expect(
      findGitRoot("/Users/alice/dev/my-app/.phase2s/runs/2026-05-13-abc.jsonl")
    ).toBe("/Users/alice/dev/my-app");
  });

  it("returns / when .phase2s/ is at filesystem root", () => {
    expect(findGitRoot("/.phase2s/specs/file.md")).toBe("/");
  });

  it("falls back to parent directory when no .phase2s/ segment", () => {
    expect(findGitRoot("/home/user/projects/repo/spec.md")).toBe(
      "/home/user/projects/repo"
    );
  });

  it("returns path itself for root-level file (no meaningful parent)", () => {
    expect(findGitRoot("/file.md")).toBe("/file.md");
  });

  it("normalises Windows backslashes before parsing", () => {
    expect(
      findGitRoot("C:\\Users\\alice\\dev\\my-app\\.phase2s\\specs\\file.md")
    ).toBe("C:/Users/alice/dev/my-app");
  });
});
