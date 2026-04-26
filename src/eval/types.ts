// Shared eval types — imported by both runner.ts and judge.ts.
// Keeping these separate avoids any circular-import or mock-boundary issues
// when judge.ts needs to reference runner output types in tests.

export interface CriterionSpec {
  text: string;
  type?: "structural" | "quality";
  match?: string;
}

export interface EvalCase {
  name: string;
  skill: string;
  inputs: Record<string, string>;
  acceptance_criteria: CriterionSpec[];
  timeout_ms?: number;
}

export interface RunnerResult {
  case: EvalCase;
  output: string;
  elapsed_ms: number;
  error?: string;
}
