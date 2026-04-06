import { describe, it, expect } from "vitest";
import {
  buildDependencyGraph,
  getExecutionLevels,
  extractFileReferences,
  formatExecutionLevels,
} from "../../src/goal/dependency-graph.js";
import type { SubTask } from "../../src/core/spec-parser.js";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeSubTask(name: string, overrides: Partial<SubTask> = {}): SubTask {
  return {
    name,
    input: overrides.input ?? "",
    output: overrides.output ?? "",
    successCriteria: overrides.successCriteria ?? "",
    files: overrides.files,
  };
}

// ---------------------------------------------------------------------------
// extractFileReferences
// ---------------------------------------------------------------------------

describe("extractFileReferences", () => {
  it("extracts explicit paths", () => {
    const refs = extractFileReferences("Modify src/core/agent.ts and test/core/agent.test.ts");
    expect(refs).toContain("src/core/agent.ts");
    expect(refs).toContain("test/core/agent.test.ts");
  });

  it("extracts verb + file patterns", () => {
    const refs = extractFileReferences("Create config/settings.json for the new feature");
    expect(refs).toContain("config/settings.json");
  });

  it("returns empty for text with no file references", () => {
    const refs = extractFileReferences("Refactor the auth module for better performance");
    expect(refs).toEqual([]);
  });

  it("deduplicates references", () => {
    const refs = extractFileReferences("Update src/core/agent.ts, then modify src/core/agent.ts again");
    expect(refs.filter(r => r === "src/core/agent.ts")).toHaveLength(1);
  });

  it("strips trailing punctuation", () => {
    const refs = extractFileReferences("See src/core/agent.ts.");
    expect(refs).toContain("src/core/agent.ts");
  });
});

// ---------------------------------------------------------------------------
// buildDependencyGraph — basic
// ---------------------------------------------------------------------------

describe("buildDependencyGraph", () => {
  it("returns empty for no subtasks", () => {
    const result = buildDependencyGraph([]);
    expect(result.nodes).toEqual([]);
    expect(result.levels).toEqual([]);
    expect(result.hasCycles).toBe(false);
  });

  it("puts single subtask in level 0", () => {
    const result = buildDependencyGraph([makeSubTask("only task")]);
    expect(result.levels).toHaveLength(1);
    expect(result.levels[0].level).toBe(0);
    expect(result.levels[0].subtaskIndices).toEqual([0]);
  });

  it("puts all independent subtasks in level 0", () => {
    const subtasks = [
      makeSubTask("task A", { input: "Create src/a.ts" }),
      makeSubTask("task B", { input: "Create src/b.ts" }),
      makeSubTask("task C", { input: "Create src/c.ts" }),
    ];
    const result = buildDependencyGraph(subtasks);
    expect(result.levels).toHaveLength(1);
    expect(result.levels[0].subtaskIndices).toHaveLength(3);
  });

  it("creates dependency when subtask B references file from subtask A", () => {
    const subtasks = [
      makeSubTask("create util", { input: "Create src/util/helper.ts" }),
      makeSubTask("use util", { input: "Import from src/util/helper.ts in the controller" }),
    ];
    const result = buildDependencyGraph(subtasks);
    expect(result.levels.length).toBeGreaterThanOrEqual(2);
    // subtask 0 should be in an earlier level than subtask 1
    const level0 = result.levels.find(l => l.subtaskIndices.includes(0));
    const level1 = result.levels.find(l => l.subtaskIndices.includes(1));
    expect(level0!.level).toBeLessThan(level1!.level);
  });

  it("no file references = all independent", () => {
    const subtasks = [
      makeSubTask("vague task 1"),
      makeSubTask("vague task 2"),
      makeSubTask("vague task 3"),
    ];
    const result = buildDependencyGraph(subtasks);
    expect(result.levels).toHaveLength(1);
    expect(result.levels[0].subtaskIndices).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// buildDependencyGraph — files: annotation
// ---------------------------------------------------------------------------

describe("buildDependencyGraph — files: annotation", () => {
  it("uses explicit files when provided", () => {
    const subtasks = [
      makeSubTask("task A", { files: ["src/a.ts"] }),
      makeSubTask("task B", { files: ["src/b.ts"] }),
    ];
    const result = buildDependencyGraph(subtasks);
    expect(result.nodes[0].produces).toEqual(["src/a.ts"]);
    expect(result.nodes[1].produces).toEqual(["src/b.ts"]);
    // Independent — different files
    expect(result.levels).toHaveLength(1);
  });

  it("files: overrides regex heuristic", () => {
    const subtasks = [
      makeSubTask("create helper", { input: "Create src/shared.ts", files: ["src/a-only.ts"] }),
      makeSubTask("use shared", { input: "Use src/shared.ts", files: ["src/b-only.ts"] }),
    ];
    const result = buildDependencyGraph(subtasks);
    // Should be independent (files: says different files, even though description mentions same file)
    expect(result.levels).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// buildDependencyGraph — cycle detection
// ---------------------------------------------------------------------------

describe("buildDependencyGraph — cycle detection", () => {
  it("detects cycles and falls back to sequential", () => {
    const subtasks = [
      makeSubTask("task A creates B's input", { files: ["src/b-input.ts"], input: "Depends on src/a-input.ts" }),
      makeSubTask("task B creates A's input", { files: ["src/a-input.ts"], input: "Depends on src/b-input.ts" }),
    ];
    const result = buildDependencyGraph(subtasks);
    expect(result.hasCycles).toBe(true);
    expect(result.cycleIndices.length).toBeGreaterThan(0);
  });

  it("handles self-referencing subtask", () => {
    const subtasks = [
      makeSubTask("self ref", { files: ["src/self.ts"], input: "Modify src/self.ts" }),
    ];
    const result = buildDependencyGraph(subtasks);
    // Self-reference should not create a cycle (node depends on itself is filtered)
    expect(result.hasCycles).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildDependencyGraph — package.json special case
// ---------------------------------------------------------------------------

describe("buildDependencyGraph — package.json", () => {
  it("package.json mention makes subtask depend on all others", () => {
    const subtasks = [
      makeSubTask("feature A", { input: "Create src/a.ts" }),
      makeSubTask("feature B", { input: "Create src/b.ts" }),
      makeSubTask("update deps", { input: "Update package.json with new dependency" }),
    ];
    const result = buildDependencyGraph(subtasks);
    // "update deps" should be in a later level than A and B
    const depNode = result.nodes[2];
    expect(depNode.dependsOn).toContain(0);
    expect(depNode.dependsOn).toContain(1);
  });
});

// ---------------------------------------------------------------------------
// getExecutionLevels — convenience
// ---------------------------------------------------------------------------

describe("getExecutionLevels", () => {
  it("returns levels from subtasks", () => {
    const subtasks = [makeSubTask("a"), makeSubTask("b")];
    const levels = getExecutionLevels(subtasks);
    expect(levels.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// formatExecutionLevels
// ---------------------------------------------------------------------------

describe("formatExecutionLevels", () => {
  it("produces human-readable output", () => {
    const subtasks = [
      makeSubTask("auth", { files: ["src/auth.ts"] }),
      makeSubTask("api", { files: ["src/api.ts"] }),
      makeSubTask("tests", { files: ["test/auth.test.ts"] }),
    ];
    const result = buildDependencyGraph(subtasks);
    const output = formatExecutionLevels(result, subtasks);
    expect(output).toContain("Execution Plan:");
    expect(output).toContain("Level 0");
    expect(output).toContain("auth");
    expect(output).toContain("api");
  });

  it("shows cycle warning", () => {
    const subtasks = [
      makeSubTask("A", { files: ["src/b.ts"], input: "Read src/a.ts" }),
      makeSubTask("B", { files: ["src/a.ts"], input: "Read src/b.ts" }),
    ];
    const result = buildDependencyGraph(subtasks);
    if (result.hasCycles) {
      const output = formatExecutionLevels(result, subtasks);
      expect(output).toContain("WARNING");
    }
  });

  it("shows produces/consumes for nodes with file refs", () => {
    const subtasks = [makeSubTask("task", { files: ["src/foo.ts"] })];
    const result = buildDependencyGraph(subtasks);
    const output = formatExecutionLevels(result, subtasks);
    expect(output).toContain("src/foo.ts");
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("handles many subtasks efficiently", () => {
    const subtasks = Array.from({ length: 20 }, (_, i) =>
      makeSubTask(`task-${i}`, { files: [`src/module-${i}.ts`] }),
    );
    const result = buildDependencyGraph(subtasks);
    // All independent — should be one level
    expect(result.levels).toHaveLength(1);
    expect(result.levels[0].subtaskIndices).toHaveLength(20);
  });

  it("fully serial chain produces N levels", () => {
    // Each subtask depends on the previous one's file
    const subtasks = [
      makeSubTask("step 1", { files: ["src/step1.ts"] }),
      makeSubTask("step 2", { files: ["src/step2.ts"], input: "Read src/step1.ts" }),
      makeSubTask("step 3", { files: ["src/step3.ts"], input: "Read src/step2.ts" }),
    ];
    const result = buildDependencyGraph(subtasks);
    expect(result.levels).toHaveLength(3);
  });
});
