// Shared eval types — imported by both runner.ts and judge.ts.
// Keeping these separate avoids any circular-import or mock-boundary issues
// when judge.ts needs to reference runner output types in tests.

export interface CriterionSpec {
  text: string;
  type?: "structural" | "quality";
  match?: string;
}

export interface EvalFixtureFile {
  path: string;    // relative to fixture root
  content: string;
}

export interface EvalFixture {
  type: "node-project" | "bare-dir";
  files: EvalFixtureFile[];
}

export interface EvalCase {
  name: string;
  skill: string;
  inputs: Record<string, string>;
  acceptance_criteria: CriterionSpec[];
  timeout_ms?: number;
  fixture?: EvalFixture;
  // Paths relative to fixture root. Checked for existence only after the eval run.
  verify_files?: string[];
}

export interface RunnerResult {
  case: EvalCase;
  output: string;
  elapsed_ms: number;
  error?: string;
}
