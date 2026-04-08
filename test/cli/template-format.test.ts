import { describe, it, expect } from "vitest";
import { parseSpec } from "../../src/core/spec-parser.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TEMPLATES = ["auth", "api", "refactor", "test", "cli", "bug"];

describe("template format compatibility with spec-parser", () => {
  for (const name of TEMPLATES) {
    it(`${name}.md parses to valid spec with subtasks`, () => {
      const content = readFileSync(join(".phase2s/templates", `${name}.md`), "utf8");
      const body = content.replace(/^---[\s\S]*?---\n/, "").replace(/\{\{[^}]+\}\}/g, "TEST_VALUE");
      const spec = parseSpec(body);
      expect(spec.decomposition.length, `${name} should have subtasks`).toBeGreaterThan(0);
      expect(spec.constraints.mustDo.length, `${name} should have mustDo constraints`).toBeGreaterThan(0);
      expect(spec.evalCommand, `${name} evalCommand`).not.toBe("");
    });
  }
});
