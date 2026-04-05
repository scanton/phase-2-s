/**
 * Spec parser for the 5-pillar spec format produced by /deep-specify.
 *
 * The parser is intentionally lenient — partial specs (missing decomposition,
 * eval design, or acceptance criteria) still parse with reduced fields. The
 * goal executor handles each missing field gracefully.
 */

export interface Spec {
  title: string;
  problemStatement: string;
  acceptanceCriteria: string[];
  constraints: {
    mustDo: string[];
    cannotDo: string[];
    shouldPrefer: string[];
    shouldEscalate: string[];
  };
  decomposition: SubTask[];
  evaluationDesign: TestCase[];
  /** Command to run to validate. Defaults to "npm test" if absent from spec. */
  evalCommand: string;
}

export interface SubTask {
  name: string;
  input: string;
  output: string;
  successCriteria: string;
}

export interface TestCase {
  name: string;
  input: string;
  expectedOutput: string;
}

/**
 * Parse a 5-pillar spec from markdown.
 *
 * Lenient: missing sections return empty defaults. The executor degrades
 * gracefully when sections are absent.
 */
export function parseSpec(markdown: string): Spec {
  const lines = markdown.split("\n");

  const title = extractTitle(lines);
  const problemStatement = extractSection(lines, "## Problem Statement");
  const acceptanceCriteria = extractAcceptanceCriteria(lines);
  const constraints = extractConstraints(lines);
  const decomposition = extractDecomposition(lines);
  const evaluationDesign = extractEvaluationDesign(lines);
  const evalCommand = extractEvalCommand(lines);

  return {
    title,
    problemStatement,
    acceptanceCriteria,
    constraints,
    decomposition,
    evaluationDesign,
    evalCommand,
  };
}

// ---------------------------------------------------------------------------
// Section extractors
// ---------------------------------------------------------------------------

function extractTitle(lines: string[]): string {
  for (const line of lines) {
    const m = line.match(/^#\s+Spec:\s*(.+)/i);
    if (m) return m[1].trim();
    // Fallback: any h1
    const h1 = line.match(/^#\s+(.+)/);
    if (h1 && !line.startsWith("##")) return h1[1].replace(/^spec:\s*/i, "").trim();
  }
  return "Untitled Spec";
}

/**
 * Extract the text content of a named H2 section (up to the next H2 or EOF).
 */
function extractSection(lines: string[], heading: string): string {
  const start = lines.findIndex((l) => l.trim().toLowerCase() === heading.trim().toLowerCase());
  if (start === -1) return "";

  const end = findNextH2(lines, start + 1);
  const body = lines.slice(start + 1, end).join("\n").trim();
  return body;
}

function findNextH2(lines: string[], from: number): number {
  for (let i = from; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) return i;
  }
  return lines.length;
}

function extractAcceptanceCriteria(lines: string[]): string[] {
  const raw = extractSection(lines, "## Acceptance Criteria");
  if (!raw) return [];

  return raw
    .split("\n")
    .map((l) => l.replace(/^\s*\d+\.\s*/, "").replace(/^\s*[-*]\s*/, "").trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

function extractConstraints(lines: string[]): Spec["constraints"] {
  const raw = extractSection(lines, "## Constraint Architecture");
  const result: Spec["constraints"] = {
    mustDo: [],
    cannotDo: [],
    shouldPrefer: [],
    shouldEscalate: [],
  };

  if (!raw) return result;

  const patterns: Array<[keyof Spec["constraints"], RegExp]> = [
    ["mustDo", /^\*\*Must Do:\*\*\s*(.+)/i],
    ["cannotDo", /^\*\*Cannot Do:\*\*\s*(.+)/i],
    ["shouldPrefer", /^\*\*Should Prefer:\*\*\s*(.+)/i],
    ["shouldEscalate", /^\*\*Should Escalate:\*\*\s*(.+)/i],
  ];

  for (const line of raw.split("\n")) {
    for (const [key, pattern] of patterns) {
      const m = line.match(pattern);
      if (m) {
        const value = m[1].trim();
        if (value && value !== "{{must_do}}" && value !== "{{cannot_do}}"
          && value !== "{{should_prefer}}" && value !== "{{should_escalate}}") {
          result[key] = value
            .split(/[;,]/)
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
        }
      }
    }
  }

  return result;
}

function extractDecomposition(lines: string[]): SubTask[] {
  const sectionStart = lines.findIndex(
    (l) => l.trim().toLowerCase() === "## decomposition",
  );
  if (sectionStart === -1) return [];

  const sectionEnd = findNextH2(lines, sectionStart + 1);
  const sectionLines = lines.slice(sectionStart + 1, sectionEnd);

  const subtasks: SubTask[] = [];
  let current: Partial<SubTask> | null = null;

  for (const line of sectionLines) {
    const subTaskHeader = line.match(/^###\s+Sub-task\s+\d+:\s*(.+)/i);
    if (subTaskHeader) {
      if (current?.name) subtasks.push(completeSubTask(current));
      current = { name: subTaskHeader[1].trim(), input: "", output: "", successCriteria: "" };
      continue;
    }

    if (!current) continue;

    const input = line.match(/^\s*-\s*\*\*Input:\*\*\s*(.+)/i);
    if (input) { current.input = input[1].trim(); continue; }

    const output = line.match(/^\s*-\s*\*\*Output:\*\*\s*(.+)/i);
    if (output) { current.output = output[1].trim(); continue; }

    const success = line.match(/^\s*-\s*\*\*Success criteria?:\*\*\s*(.+)/i);
    if (success) { current.successCriteria = success[1].trim(); continue; }
  }

  if (current?.name) subtasks.push(completeSubTask(current));
  return subtasks;
}

function completeSubTask(partial: Partial<SubTask>): SubTask {
  return {
    name: partial.name ?? "Unnamed sub-task",
    input: partial.input ?? "",
    output: partial.output ?? "",
    successCriteria: partial.successCriteria ?? "",
  };
}

function extractEvaluationDesign(lines: string[]): TestCase[] {
  const sectionStart = lines.findIndex(
    (l) => l.trim().toLowerCase() === "## evaluation design",
  );
  if (sectionStart === -1) return [];

  const sectionEnd = findNextH2(lines, sectionStart + 1);
  const sectionLines = lines.slice(sectionStart + 1, sectionEnd);

  const testCases: TestCase[] = [];

  for (const line of sectionLines) {
    // Skip table headers and separators
    if (line.includes("---") || line.match(/\|\s*Test Case\s*\|/i)) continue;

    const cells = line.split("|").map((c) => c.trim()).filter((c) => c.length > 0);
    if (cells.length >= 3) {
      const [name, input, expectedOutput] = cells;
      if (
        name && input && expectedOutput &&
        !name.match(/\{\{/) && !input.match(/\{\{/)
      ) {
        testCases.push({ name, input, expectedOutput });
      }
    }
  }

  return testCases;
}

function extractEvalCommand(lines: string[]): string {
  const sectionStart = lines.findIndex(
    (l) => l.trim().toLowerCase() === "## eval command",
  );
  if (sectionStart === -1) return "npm test";

  const sectionEnd = findNextH2(lines, sectionStart + 1);
  const body = lines
    .slice(sectionStart + 1, sectionEnd)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("```"))
    .join("").trim();

  return body || "npm test";
}
