/**
 * Built-in audit cases for `phase2s search-audit`.
 *
 * These 20 queries target specific Phase2S functions by natural language.
 * Each case was authored by running the query via :search manually and
 * verifying the expected result appears in the top results.
 *
 * The self-referential nature is intentional: Phase2S uses its own semantic
 * search to understand its own architecture. If the stack is working, these
 * cases pass without any user configuration.
 *
 * Authoring protocol: if a new query doesn't land in top-3, either revise
 * the query to be more natural, or mark expectedHit: false to document the
 * gap rather than gaming the benchmark.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AuditCase {
  /** Natural language search query */
  query: string;
  /** Expected relative file path (forward-slash normalized) */
  expectedPath: string;
  /**
   * Optional fragment to includes()-match against the stored chunkName.
   * For regular functions, chunkName is the first 80 chars of node source text
   * (e.g. "async function generateEmbedding(text: string..."). For arrow
   * functions, chunkName is the binding identifier (e.g. "rateLimitBackoff").
   * includes() works correctly for both formats.
   */
  expectedChunk?: string;
  /**
   * When false, this is a known-weak case: shown as [known weak] in the table,
   * excluded from MRR denominator, and not counted against CI thresholds.
   * Use to document gaps rather than gaming the benchmark.
   * Omit (or set to true) for cases expected to pass.
   */
  expectedHit?: false;
  /** Human-readable note for display in verbose output */
  note?: string;
}

// ---------------------------------------------------------------------------
// Built-in Phase2S self-audit queries
// ---------------------------------------------------------------------------

export const BUILT_IN_CASES: AuditCase[] = [
  // Core embedding pipeline
  {
    query: "generate text embedding via Ollama",
    expectedPath: "src/core/embeddings.ts",
    expectedChunk: "generateEmbedding",
    note: "Primary embedding function — heart of the semantic stack",
  },

  // Code index operations
  {
    query: "find top-k similar code chunks cosine similarity",
    expectedPath: "src/core/code-index.ts",
    expectedChunk: "findTopKCode",
    note: "Vector ranking via cosine similarity",
  },
  {
    query: "sync codebase files to vector index",
    expectedPath: "src/core/code-index.ts",
    expectedChunk: "syncCodebase",
    note: "Full incremental sync — git ls-files + embed + JSONL write",
  },
  {
    query: "read existing code index from disk",
    expectedPath: "src/core/code-index.ts",
    expectedChunk: "readCodeIndex",
    note: "JSONL reader for .phase2s/code-index.jsonl",
  },
  {
    query: "check if code index is stale compared to git HEAD",
    expectedPath: "src/core/code-index.ts",
    expectedChunk: "checkIndexStaleness",
    note: "Compares file mtimes vs index timestamp",
  },

  // Chunker
  {
    query: "parse source file into AST semantic chunks",
    expectedPath: "src/core/chunker.ts",
    expectedChunk: "chunkFile",
    note: "Main chunker entry point — dispatches to language-specific chunkers",
  },
  {
    query: "heading-based chunking for markdown files",
    expectedPath: "src/core/chunker.ts",
    expectedChunk: "chunkMarkdown",
    note: "## and ### boundary splitting for .md/.mdx files",
  },
  {
    query: "arrow function variable declarator parent walk naming",
    expectedPath: "src/core/chunker.ts",
    note: "Arrow walk — finds binding identifier from variable_declarator parent",
  },

  // CLI commands
  {
    query: "run semantic search from REPL command line",
    expectedPath: "src/cli/search.ts",
    expectedChunk: "runSearch",
    note: ":search REPL command dispatcher",
  },
  {
    query: "sync codebase from CLI command",
    expectedPath: "src/cli/sync.ts",
    expectedChunk: "runSync",
    note: "phase2s sync CLI entry point",
  },

  // Memory / learnings
  {
    query: "load relevant learnings for a query via semantic search",
    expectedPath: "src/core/memory.ts",
    expectedChunk: "loadRelevantLearnings",
    note: "Learnings retrieval — used to inject context into agent sessions",
  },
  {
    query: "sort learnings by recency and heuristic relevance",
    expectedPath: "src/core/memory.ts",
    expectedChunk: "heuristicSort",
    note: "Fallback ranking when Ollama unavailable — recency + keyword match",
  },

  // Config
  {
    query: "load and parse phase2s configuration file",
    expectedPath: "src/core/config.ts",
    expectedChunk: "loadConfig",
    note: "Reads .phase2s.yaml from cwd or home dir",
  },

  // Agent / tools
  {
    query: "create default agent tool registry with Ollama",
    expectedPath: "src/tools/registry.ts",
    expectedChunk: "createDefaultRegistry",
    note: "Registers code_search and other tools when Ollama configured",
  },
  {
    query: "semantic code search agent tool",
    expectedPath: "src/tools/code-search.ts",
    expectedChunk: "createCodeSearchTool",
    note: "code_search MCP tool — embed + rank + format results for agent",
  },

  // Doctor / health
  {
    query: "check phase2s installation health and dependencies",
    expectedPath: "src/cli/doctor.ts",
    expectedChunk: "runDoctor",
    note: "phase2s doctor — checks Ollama, index, config, node version",
  },

  // MCP
  {
    query: "start phase2s as MCP server exposing tools to Claude",
    expectedPath: "src/mcp/server.ts",
    expectedChunk: "runMCPServer",
    note: "MCP server mode — exposes all skills as Claude Code tools",
  },

  // Retry / rate limiting
  {
    query: "rate limit error class with retry-after and blocked kind",
    expectedPath: "src/core/rate-limit-error.ts",
    expectedChunk: "RateLimitError",
    note: "Rate limit handling — thrown when backoff budget exhausted",
    expectedHit: false,
  },

  // Init
  {
    query: "interactive setup wizard configure ollama base url",
    expectedPath: "src/cli/init.ts",
    note: "phase2s init — interactive config wizard",
  },

  // Goal / dark factory
  {
    query: "run autonomous goal spec file with agent loop",
    expectedPath: "src/cli/goal.ts",
    expectedChunk: "runGoal",
    note: "Dark factory autonomous agent runner",
  },
];
