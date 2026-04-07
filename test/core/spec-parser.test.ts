import { describe, it, expect } from "vitest";
import { parseSpec } from "../../src/core/spec-parser.js";

const FULL_SPEC = `# Spec: Rate Limiting

Generated: 2026-04-04
Spec ID: rate-limiting

## Problem Statement
Add token-bucket rate limiting to the API middleware. Protects against overuse.

## Acceptance Criteria
1. Authenticated users: 100 requests per minute, 429 on exceed
2. Unauthenticated IPs: 20 requests per minute, 429 on exceed
3. npm test passes after implementation

## Constraint Architecture
**Must Do:** Use in-memory store; add Retry-After header on 429
**Cannot Do:** Redis backend; distributed rate limiting
**Should Prefer:** Token bucket algorithm over sliding window
**Should Escalate:** If existing middleware registration order is unclear

## Decomposition
### Sub-task 1: Token bucket implementation
- **Input:** Request with user ID or IP
- **Output:** RateLimiter class in src/utils/rate-limiter.ts
- **Success criteria:** Unit tests for bucket fill/drain and 429 on exceed pass

### Sub-task 2: Middleware integration
- **Input:** RateLimiter class
- **Output:** Middleware registered in src/app.ts
- **Success criteria:** Integration tests with real HTTP requests pass

## Evaluation Design
| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| Auth user under limit | 50 requests | 200 for all |
| Auth user over limit | 101 requests | 429 on 101st |

## Eval Command
npm test -- --grep "rate limiting"
`;

const MINIMAL_SPEC = `# Spec: Minimal

## Problem Statement
A minimal spec with no optional sections.

## Acceptance Criteria
1. Basic criterion
`;

describe("spec-parser", () => {
  describe("parseSpec — full spec", () => {
    it("parses title correctly", () => {
      const spec = parseSpec(FULL_SPEC);
      expect(spec.title).toBe("Rate Limiting");
    });

    it("parses problem statement", () => {
      const spec = parseSpec(FULL_SPEC);
      expect(spec.problemStatement).toContain("token-bucket rate limiting");
    });

    it("parses acceptance criteria as array", () => {
      const spec = parseSpec(FULL_SPEC);
      expect(spec.acceptanceCriteria).toHaveLength(3);
      expect(spec.acceptanceCriteria[0]).toContain("100 requests per minute");
      expect(spec.acceptanceCriteria[2]).toBe("npm test passes after implementation");
    });

    it("parses constraint architecture", () => {
      const spec = parseSpec(FULL_SPEC);
      expect(spec.constraints.mustDo).toContain("Use in-memory store");
      expect(spec.constraints.cannotDo).toContain("Redis backend");
      expect(spec.constraints.shouldPrefer).toContain("Token bucket algorithm over sliding window");
      expect(spec.constraints.shouldEscalate.join("")).toContain("middleware registration order");
    });

    it("parses decomposition into sub-tasks", () => {
      const spec = parseSpec(FULL_SPEC);
      expect(spec.decomposition).toHaveLength(2);
      expect(spec.decomposition[0].name).toBe("Token bucket implementation");
      expect(spec.decomposition[0].input).toContain("user ID or IP");
      expect(spec.decomposition[0].output).toContain("RateLimiter class");
      expect(spec.decomposition[0].successCriteria).toContain("Unit tests");
      expect(spec.decomposition[1].name).toBe("Middleware integration");
    });

    it("parses evaluation design as test cases", () => {
      const spec = parseSpec(FULL_SPEC);
      expect(spec.evaluationDesign).toHaveLength(2);
      expect(spec.evaluationDesign[0].name).toBe("Auth user under limit");
      expect(spec.evaluationDesign[0].input).toContain("50 requests");
      expect(spec.evaluationDesign[0].expectedOutput).toContain("200");
    });

    it("extracts eval command from ## Eval Command section", () => {
      const spec = parseSpec(FULL_SPEC);
      expect(spec.evalCommand).toBe("npm test -- --grep \"rate limiting\"");
    });
  });

  describe("parseSpec — partial specs (lenient behavior)", () => {
    it("returns empty array for missing decomposition", () => {
      const spec = parseSpec(MINIMAL_SPEC);
      expect(spec.decomposition).toEqual([]);
    });

    it("returns empty array for missing evaluation design", () => {
      const spec = parseSpec(MINIMAL_SPEC);
      expect(spec.evaluationDesign).toEqual([]);
    });

    it("falls back to npm test when no eval command present", () => {
      const spec = parseSpec(MINIMAL_SPEC);
      expect(spec.evalCommand).toBe("npm test");
    });

    it("returns empty constraints when section is missing", () => {
      const spec = parseSpec(MINIMAL_SPEC);
      expect(spec.constraints.mustDo).toEqual([]);
      expect(spec.constraints.cannotDo).toEqual([]);
    });

    it("returns Untitled Spec when no title found", () => {
      const spec = parseSpec("## Problem Statement\nsome text");
      expect(spec.title).toBe("Untitled Spec");
    });
  });

  // -------------------------------------------------------------------------
  // files: field (Sprint 35 — parallel execution dependency detection)
  // -------------------------------------------------------------------------

  describe("files: annotation", () => {
    it("parses files: field as comma-separated list", () => {
      const markdown = `# Spec: Test
## Decomposition
### Sub-task 1: Create API
- **Input:** API spec
- **Output:** Routes
- **Success criteria:** Tests pass
- **Files:** src/api/routes.ts, src/api/middleware.ts
`;
      const spec = parseSpec(markdown);
      expect(spec.decomposition[0].files).toEqual(["src/api/routes.ts", "src/api/middleware.ts"]);
    });

    it("parses files: with backtick-wrapped paths", () => {
      const markdown = `# Spec: Test
## Decomposition
### Sub-task 1: Create helper
- **Input:** None
- **Output:** Helper module
- **Success criteria:** Tests pass
- **Files:** \`src/util/helper.ts\`, \`test/util/helper.test.ts\`
`;
      const spec = parseSpec(markdown);
      expect(spec.decomposition[0].files).toEqual(["src/util/helper.ts", "test/util/helper.test.ts"]);
    });

    it("omits files field when not present in spec", () => {
      const markdown = `# Spec: Test
## Decomposition
### Sub-task 1: Simple task
- **Input:** None
- **Output:** Done
- **Success criteria:** Works
`;
      const spec = parseSpec(markdown);
      expect(spec.decomposition[0].files).toBeUndefined();
    });

    it("handles semicolon-separated file lists", () => {
      const markdown = `# Spec: Test
## Decomposition
### Sub-task 1: Multi-file
- **Input:** None
- **Output:** Done
- **Success criteria:** Works
- **Files:** src/a.ts; src/b.ts; src/c.ts
`;
      const spec = parseSpec(markdown);
      expect(spec.decomposition[0].files).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    });

    it("handles File: (singular) annotation", () => {
      const markdown = `# Spec: Test
## Decomposition
### Sub-task 1: Single file
- **Input:** None
- **Output:** Done
- **Success criteria:** Works
- **File:** src/single.ts
`;
      const spec = parseSpec(markdown);
      expect(spec.decomposition[0].files).toEqual(["src/single.ts"]);
    });
  });
});

// ---------------------------------------------------------------------------
// Role annotation parsing
// ---------------------------------------------------------------------------

describe("Role annotation parsing", () => {
  it("parses **Role:** architect", () => {
    const markdown = `# Spec: Role Test
## Decomposition
### Sub-task 1: Design schema
- **Input:** None
- **Output:** Schema
- **Success criteria:** Done
- **Role:** architect
`;
    const spec = parseSpec(markdown);
    expect(spec.decomposition[0].role).toBe("architect");
  });

  it("parses **Role:** tester", () => {
    const markdown = `# Spec: Role Test
## Decomposition
### Sub-task 1: Write tests
- **Input:** None
- **Output:** Tests
- **Success criteria:** Done
- **Role:** tester
`;
    const spec = parseSpec(markdown);
    expect(spec.decomposition[0].role).toBe("tester");
  });

  it("parses **Role:** reviewer", () => {
    const markdown = `# Spec: Role Test
## Decomposition
### Sub-task 1: Review code
- **Input:** None
- **Output:** Review
- **Success criteria:** Done
- **Role:** reviewer
`;
    const spec = parseSpec(markdown);
    expect(spec.decomposition[0].role).toBe("reviewer");
  });

  it("parses **Role:** implementer", () => {
    const markdown = `# Spec: Role Test
## Decomposition
### Sub-task 1: Implement feature
- **Input:** None
- **Output:** Code
- **Success criteria:** Done
- **Role:** implementer
`;
    const spec = parseSpec(markdown);
    expect(spec.decomposition[0].role).toBe("implementer");
  });

  it("parses role case-insensitively (ARCHITECT → architect)", () => {
    const markdown = `# Spec: Role Test
## Decomposition
### Sub-task 1: Design something
- **Input:** None
- **Output:** Design
- **Success criteria:** Done
- **Role:** ARCHITECT
`;
    const spec = parseSpec(markdown);
    expect(spec.decomposition[0].role).toBe("architect");
  });

  it("no role annotation → role === undefined", () => {
    const markdown = `# Spec: Role Test
## Decomposition
### Sub-task 1: No role here
- **Input:** None
- **Output:** Output
- **Success criteria:** Done
`;
    const spec = parseSpec(markdown);
    expect(spec.decomposition[0].role).toBeUndefined();
  });

  it("multiple subtasks with different roles parsed correctly", () => {
    const markdown = `# Spec: Multi Role
## Decomposition
### Sub-task 1: Design
- **Input:** Req
- **Output:** Design
- **Success criteria:** OK
- **Role:** architect

### Sub-task 2: Implement
- **Input:** Design
- **Output:** Code
- **Success criteria:** OK
- **Role:** implementer

### Sub-task 3: Test
- **Input:** Code
- **Output:** Tests
- **Success criteria:** OK
- **Role:** tester
`;
    const spec = parseSpec(markdown);
    expect(spec.decomposition[0].role).toBe("architect");
    expect(spec.decomposition[1].role).toBe("implementer");
    expect(spec.decomposition[2].role).toBe("tester");
  });
});

// ---------------------------------------------------------------------------
// model: annotation (Sprint 41 — multi-provider parallel workers)
// ---------------------------------------------------------------------------

describe("model: annotation", () => {
  it("parses 'model: fast' annotation → subtask.model = 'fast'", () => {
    const markdown = `# Spec: Model Annotation
## Decomposition
### Sub-task 1: Quick task
model: fast
- **Input:** source
- **Output:** result
- **Success criteria:** done
`;
    const spec = parseSpec(markdown);
    expect(spec.decomposition[0].model).toBe("fast");
  });

  it("parses 'model: smart' annotation → subtask.model = 'smart'", () => {
    const markdown = `# Spec: Model Annotation
## Decomposition
### Sub-task 1: Complex analysis
model: smart
- **Input:** source
- **Output:** result
- **Success criteria:** done
`;
    const spec = parseSpec(markdown);
    expect(spec.decomposition[0].model).toBe("smart");
  });

  it("parses literal model name passthrough", () => {
    const markdown = `# Spec: Model Annotation
## Decomposition
### Sub-task 1: Custom model task
model: claude-3-haiku-20240307
- **Input:** source
- **Output:** result
- **Success criteria:** done
`;
    const spec = parseSpec(markdown);
    expect(spec.decomposition[0].model).toBe("claude-3-haiku-20240307");
  });

  it("subtask without model annotation → model === undefined", () => {
    const markdown = `# Spec: Model Annotation
## Decomposition
### Sub-task 1: No model
- **Input:** source
- **Output:** result
- **Success criteria:** done
`;
    const spec = parseSpec(markdown);
    expect(spec.decomposition[0].model).toBeUndefined();
  });

  it("multiple subtasks with different model annotations parsed independently", () => {
    const markdown = `# Spec: Multi Model
## Decomposition
### Sub-task 1: Fast task
model: fast
- **Input:** A
- **Output:** B
- **Success criteria:** OK

### Sub-task 2: Smart task
model: smart
- **Input:** B
- **Output:** C
- **Success criteria:** OK

### Sub-task 3: Default task
- **Input:** C
- **Output:** D
- **Success criteria:** OK
`;
    const spec = parseSpec(markdown);
    expect(spec.decomposition[0].model).toBe("fast");
    expect(spec.decomposition[1].model).toBe("smart");
    expect(spec.decomposition[2].model).toBeUndefined();
  });

  it("parses **Model:** bold annotation format", () => {
    const markdown = `# Spec: Model Annotation
## Decomposition
### Sub-task 1: Bold format
- **Model:** fast
- **Input:** source
- **Output:** result
- **Success criteria:** done
`;
    const spec = parseSpec(markdown);
    expect(spec.decomposition[0].model).toBe("fast");
  });
});
