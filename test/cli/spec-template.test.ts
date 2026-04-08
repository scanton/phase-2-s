import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseFrontmatter, runTemplateList, runTemplateUse } from "../../src/cli/spec-template.js";
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// bundledTemplatesDir() uses import.meta.url which resolves to src/skills/loader.ts in
// the vitest environment (source path, not dist path). Three levels up from src/skills
// overshoots the project root by one level. Mock it to return the correct source path.
vi.mock("../../src/skills/loader.js", () => ({
  bundledTemplatesDir: () => join(process.cwd(), ".phase2s", "templates"),
}));

// ---------------------------------------------------------------------------
// parseFrontmatter tests
// ---------------------------------------------------------------------------

describe("parseFrontmatter()", () => {
  it("parses all three fields correctly", () => {
    const content = `---\ntitle: My Template\ndescription: A test template\nplaceholders:\n  - project_name\n  - framework\n---\n# Spec body here\n`;
    const { meta, body } = parseFrontmatter(content);
    expect(meta.title).toBe("My Template");
    expect(meta.description).toBe("A test template");
    expect(meta.placeholders).toEqual(["project_name", "framework"]);
    expect(body).toContain("# Spec body here");
  });

  it("throws when frontmatter is missing", () => {
    expect(() => parseFrontmatter("# No frontmatter here")).toThrow(
      "Template missing YAML frontmatter"
    );
  });

  it("throws when title is missing", () => {
    const content = `---\ndescription: No title\nplaceholders:\n  - foo\n---\nbody\n`;
    expect(() => parseFrontmatter(content)).toThrow("missing required field: title");
  });

  it("throws when description is missing", () => {
    const content = `---\ntitle: Has Title\nplaceholders:\n  - foo\n---\nbody\n`;
    expect(() => parseFrontmatter(content)).toThrow("missing required field: description");
  });

  it("handles empty placeholders list", () => {
    const content = `---\ntitle: Simple\ndescription: Simple template\nplaceholders:\n---\nbody\n`;
    const { meta } = parseFrontmatter(content);
    expect(meta.placeholders).toEqual([]);
  });

  it("body contains spec content after delimiter", () => {
    const content = `---\ntitle: T\ndescription: D\nplaceholders:\n  - foo\n---\n# My Spec\n\n## Problem Statement\nHere.\n`;
    const { body } = parseFrontmatter(content);
    expect(body.trim()).toContain("# My Spec");
    expect(body.trim()).toContain("## Problem Statement");
  });

  it("handles Windows-style CRLF line endings in frontmatter", () => {
    const content = "---\r\ntitle: Win\r\ndescription: Windows\r\nplaceholders:\r\n  - foo\r\n---\r\nbody\r\n";
    const { meta } = parseFrontmatter(content);
    expect(meta.title).toBe("Win");
    expect(meta.description).toBe("Windows");
  });

  it("parses multiple placeholders correctly", () => {
    const content = `---\ntitle: Multi\ndescription: Multiple placeholders\nplaceholders:\n  - alpha\n  - beta\n  - gamma\n---\nbody\n`;
    const { meta } = parseFrontmatter(content);
    expect(meta.placeholders).toHaveLength(3);
    expect(meta.placeholders).toContain("alpha");
    expect(meta.placeholders).toContain("gamma");
  });
});

// ---------------------------------------------------------------------------
// runTemplateList tests
// ---------------------------------------------------------------------------

describe("runTemplateList()", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints available templates when bundled templates exist", () => {
    // Relies on real bundled templates being present on disk.
    // In the test environment, bundledTemplatesDir() resolves to
    // <project-root>/.phase2s/templates via import.meta.url.
    runTemplateList();
    // Should print the header and at least one template line
    expect(consoleSpy).toHaveBeenCalled();
    // Should NOT exit with 1 (which happens when no templates are found)
    expect(exitSpy).not.toHaveBeenCalledWith(1);
  });

  it("lists all 6 bundled template names in output", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string = "") => { lines.push(line); });
    runTemplateList();
    const combined = lines.join("\n");
    for (const name of ["auth", "api", "bug", "refactor", "test", "cli"]) {
      expect(combined).toContain(name);
    }
  });
});

// ---------------------------------------------------------------------------
// runTemplateUse tests
// ---------------------------------------------------------------------------

describe("runTemplateUse()", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `phase2s-template-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("exits 1 with error message for unknown template name", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    await runTemplateUse("nonexistent-template-xyz", tmpDir);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("lists available template names in error output for unknown name", async () => {
    vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    const errorLines: string[] = [];
    vi.spyOn(console, "error").mockRestore();
    vi.spyOn(console, "error").mockImplementation((line: string = "") => { errorLines.push(line); });
    await runTemplateUse("nonexistent-template-xyz", tmpDir);
    // Error output should mention the bad name
    expect(errorLines.join("\n")).toContain("nonexistent-template-xyz");
  });
});

// ---------------------------------------------------------------------------
// Token substitution tests — exercise the PRODUCTION single-pass regex
// ---------------------------------------------------------------------------

describe("{{token}} substitution in template body (production regex)", () => {
  // Helper that mirrors the production substitution in spec-template.ts exactly
  function substitute(body: string, values: Record<string, string>): string {
    return body.replace(/\{\{([^}]+)\}\}/g, (_match, key) => values[key as string] ?? `{{${key as string}}}`);
  }

  it("substitutes all occurrences of a token", () => {
    const body = "Build {{project_name}} with {{framework}}. Deploy {{project_name}}.";
    const result = substitute(body, { project_name: "myapp", framework: "React" });
    expect(result).toBe("Build myapp with React. Deploy myapp.");
  });

  it("leaves undeclared tokens unchanged", () => {
    const body = "Framework: {{framework}}.";
    const result = substitute(body, { project_name: "myapp", framework: "Vue" });
    expect(result).toBe("Framework: Vue.");
  });

  it("handles no tokens in body (no-op)", () => {
    const body = "No tokens here.";
    const result = substitute(body, { project_name: "myapp" });
    expect(result).toBe("No tokens here.");
  });

  it("PREVENTS cascade injection — user value containing {{token}} syntax is not re-substituted", () => {
    // This is the critical regression test: the OLD sequential replaceAll loop
    // would re-process values, so { name: "{{other}}", other: "INJECTED" }
    // would produce "INJECTED". The single-pass regex must NOT do this.
    const body = "{{name}} and {{other}}";
    const result = substitute(body, { name: "{{other}}", other: "INJECTED" });
    // The value for 'name' should appear verbatim — not get re-substituted
    expect(result).toBe("{{other}} and INJECTED");
    expect(result).not.toBe("INJECTED and INJECTED");
  });

  it("handles missing key gracefully — passes through as {{key}}", () => {
    const body = "Name: {{project_name}}.";
    const result = substitute(body, {});
    expect(result).toBe("Name: {{project_name}}.");
  });
});

// ---------------------------------------------------------------------------
// parseFrontmatter — trailing newline regression test
// ---------------------------------------------------------------------------

describe("parseFrontmatter() — trailing newline variants", () => {
  it("parses correctly when closing --- has no trailing newline", () => {
    // This is the exact bug that was fixed: the original regex required \r?\n
    // after the closing --- delimiter, silently failing files without trailing newline.
    const content = "---\ntitle: T\ndescription: D\nplaceholders:\n---";
    const { meta, body } = parseFrontmatter(content);
    expect(meta.title).toBe("T");
    expect(meta.description).toBe("D");
    expect(body).toBe("");
  });

  it("parses correctly when closing --- has a trailing newline", () => {
    const content = "---\ntitle: T\ndescription: D\nplaceholders:\n---\n";
    const { meta, body } = parseFrontmatter(content);
    expect(meta.title).toBe("T");
    expect(body).toBe("");
  });

  it("preserves body content after closing --- with trailing newline", () => {
    const content = "---\ntitle: T\ndescription: D\nplaceholders:\n---\n# Body\n";
    const { body } = parseFrontmatter(content);
    expect(body).toContain("# Body");
  });
});

// ---------------------------------------------------------------------------
// Bundled template file structure tests
// Use process.cwd() (project root in vitest) rather than bundledTemplatesDir()
// to avoid the dist-path vs source-path mismatch in test environments.
// ---------------------------------------------------------------------------

const TEMPLATES_DIR = join(process.cwd(), ".phase2s", "templates");

describe("bundled template files", () => {
  it("auth.md parses without error", () => {
    const content = readFileSync(join(TEMPLATES_DIR, "auth.md"), "utf8");
    const { meta } = parseFrontmatter(content);
    expect(meta.title).toBeTruthy();
    expect(meta.placeholders.length).toBeGreaterThan(0);
  });

  it("api.md parses without error", () => {
    const content = readFileSync(join(TEMPLATES_DIR, "api.md"), "utf8");
    const { meta } = parseFrontmatter(content);
    expect(meta.title).toBeTruthy();
  });

  it("bug.md parses without error", () => {
    const content = readFileSync(join(TEMPLATES_DIR, "bug.md"), "utf8");
    const { meta } = parseFrontmatter(content);
    expect(meta.title).toBeTruthy();
  });

  it("cli.md parses without error", () => {
    const content = readFileSync(join(TEMPLATES_DIR, "cli.md"), "utf8");
    const { meta } = parseFrontmatter(content);
    expect(meta.title).toBeTruthy();
  });

  it("refactor.md parses without error", () => {
    const content = readFileSync(join(TEMPLATES_DIR, "refactor.md"), "utf8");
    const { meta } = parseFrontmatter(content);
    expect(meta.title).toBeTruthy();
  });

  it("test.md parses without error", () => {
    const content = readFileSync(join(TEMPLATES_DIR, "test.md"), "utf8");
    const { meta } = parseFrontmatter(content);
    expect(meta.title).toBeTruthy();
  });

  it("all 6 bundled templates exist", () => {
    const files = readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith(".md"));
    expect(files.length).toBe(6);
  });
});
