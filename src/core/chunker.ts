/**
 * Function/method-level chunker for the semantic code index.
 *
 * Uses @ast-grep/napi (prebuilt native binaries via napi-rs) for parsing.
 * Falls back gracefully to [] when:
 *   - The native module is unavailable (Alpine/musl Linux)
 *   - The file extension is unsupported
 *   - Parsing fails (syntax error in user's file)
 *
 * Caller uses [] as the signal to apply whole-file embedding instead.
 *
 * NOTE: createRequire(import.meta.url) is required because the package is ESM
 * ("type":"module") and bare require() is not available in ESM context. We use
 * createRequire to load the optional native addon inside a try/catch so that
 * platforms without a prebuilt binary (Alpine/musl, unsupported arch) degrade
 * gracefully to whole-file embedding rather than crashing.
 */

import { createRequire } from "node:module";
import { extname } from "node:path";

const _require = createRequire(import.meta.url);
let astGrep: typeof import("@ast-grep/napi") | null = null;
try {
  astGrep = _require("@ast-grep/napi") as typeof import("@ast-grep/napi");
} catch {
  // Platform not supported (Alpine/musl, unsupported arch) — chunkFile returns []
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface Chunk {
  /** First 80 chars of the node's source text (function signature or heading) */
  name: string;
  /** Start line, 0-indexed */
  start: number;
  /** End line, inclusive, 0-indexed */
  end: number;
  /** Raw source text of the chunk */
  content: string;
}

// ---------------------------------------------------------------------------
// Language routing
// ---------------------------------------------------------------------------

/** Languages that support arrow function parent-walk (TS, TSX, JS variants) */
const ARROW_WALK_LANGS = new Set(["TypeScript", "Tsx", "JavaScript"]);

/** Map file extension → ast-grep Language name */
const EXT_TO_LANG: Record<string, string> = {
  ".ts":   "TypeScript",
  ".tsx":  "Tsx",
  ".js":   "JavaScript",
  ".jsx":  "JavaScript",
  ".mjs":  "JavaScript",
  ".cjs":  "JavaScript",
  ".py":   "Python",
  ".rb":   "Ruby",
  ".go":   "Go",
  ".rs":   "Rust",
  ".java": "Java",
  ".kt":   "Kotlin",
  ".c":    "C",
  ".cpp":  "Cpp",
  ".h":    "C",
  ".cs":   "CSharp",
  ".swift":"Swift",
};

/**
 * Node kinds for function/method-level chunking per language.
 *
 * arrow_function intentionally omitted from CHUNK_KINDS — anonymous and
 * callback arrows produce meaningless names. Named arrows are handled by a
 * separate parent-walk pass (see ARROW_WALK_LANGS) that reads the binding
 * identifier from the variable_declarator parent for clean chunk names.
 *
 * class_declaration omitted from all languages — findAll descends into class
 * bodies and returns inner methods, so class chunks would swallow their methods.
 *
 * interface_declaration (Java, Kotlin, C#) and struct_declaration (C#, Swift)
 * included: they are not classes and give meaningful type-boundary context.
 */
const CHUNK_KINDS: Record<string, string[]> = {
  TypeScript: ["function_declaration", "method_definition"],     // verified: ts grammar v0.20
  Tsx:        ["function_declaration", "method_definition"],     // verified: tsx grammar v0.20
  JavaScript: ["function_declaration", "method_definition"],     // verified: js grammar v0.20
  Python:     ["function_definition"],                           // verified: py grammar v0.21 — `def foo():`
  Ruby:       ["method", "singleton_method"],                    // verified: rb grammar v0.19 — `def foo` / `def self.foo`
  Go:         ["function_declaration", "method_declaration"],    // verified: go grammar v0.19 — `func foo()` / `func (r T) foo()`
  Rust:       ["function_item"],                                 // verified: rs grammar v0.21 — `fn foo()`
  Java:       ["method_declaration", "constructor_declaration", "interface_declaration"], // verified: java grammar v0.21
  Kotlin:     ["function_declaration", "interface_declaration"], // verified: kt grammar v0.3 — `fun foo()`
  C:          ["function_definition"],                           // verified: c grammar v0.21 — `int foo()`
  Cpp:        ["function_definition"],                           // verified: cpp grammar v0.22 — covers member functions
  CSharp:     ["method_declaration", "interface_declaration", "struct_declaration"],     // verified: cs grammar v0.21
  Swift:      ["function_declaration", "struct_declaration"],    // verified: swift grammar v0.5 — `func foo()`
};

// ---------------------------------------------------------------------------
// Markdown chunker
// ---------------------------------------------------------------------------

/**
 * Heading-based chunking for Markdown and MDX.
 * Splits at ## and ### boundaries. Returns one chunk per section.
 * Filters sections with no non-whitespace content.
 */
function chunkMarkdown(content: string): Chunk[] {
  const lines = content.split("\n");
  const chunks: Chunk[] = [];
  let start = 0;
  let name = "(header)";
  // True once we've seen a ## heading; used to distinguish "initial prose block"
  // (body starts at `start`) from "heading-started section" (body starts at `start+1`).
  let sectionHasHeading = false;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^#{2,3} (.+)/);
    if (m) {
      // Flush the previous section before advancing the window.
      // When i === 0 (heading at document start) there is no previous section
      // to flush, so the push is skipped — but name/start still update correctly.
      if (i > start) {
        const sectionContent = lines.slice(start, i).join("\n");
        // Filter out sections whose body (excluding the heading line) is blank.
        // This prevents heading-only sections (e.g. "## Empty\n\n## Next") from
        // polluting the index with empty embeddings.
        // For the initial "(header)" block (sectionHasHeading=false), the heading
        // line test does not apply — check the full content instead.
        const bodyStart = sectionHasHeading ? start + 1 : start;
        if (lines.slice(bodyStart, i).join("\n").trim().length > 0) {
          chunks.push({ name, start, end: i - 1, content: sectionContent });
        }
      }
      start = i;
      name = m[1].trim();
      sectionHasHeading = true;
    }
  }

  if (start < lines.length) {
    const sectionContent = lines.slice(start).join("\n");
    const bodyStart = sectionHasHeading ? start + 1 : start;
    if (lines.slice(bodyStart).join("\n").trim().length > 0) {
      chunks.push({ name, start, end: lines.length - 1, content: sectionContent });
    }
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Minimum chunk size
// ---------------------------------------------------------------------------

/**
 * Minimum line span for a chunk to be worth embedding.
 * end - start < MIN_CHUNK_LINES → filtered (e.g. one-liner getters, empty stubs).
 * Verified in test/core/chunker.test.ts: sha256 (end-start=1) is correctly filtered.
 */
export const MIN_CHUNK_LINES = 3;

/** Max chars to capture from node source text for the chunk name (function signature). */
export const CHUNK_NAME_CHARS = 80;

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Parse a source file into semantic chunks.
 *
 * Returns [] when:
 *   - Extension not in EXT_TO_LANG (unsupported language)
 *   - Extension is not .md/.mdx and @ast-grep/napi failed to load (Alpine/musl)
 *   - Parse fails (syntax error in user's file)
 *
 * Caller interprets [] as "use whole-file embedding instead."
 */
export function chunkFile(content: string, filePath: string): Chunk[] {
  const ext = extname(filePath).toLowerCase();

  // Markdown: heading-based chunking (no native module needed)
  if (ext === ".md" || ext === ".mdx") return chunkMarkdown(content);

  // All other languages require the native module
  if (!astGrep) return [];

  const langName = EXT_TO_LANG[ext];
  if (!langName) return [];

  const kinds = CHUNK_KINDS[langName];
  if (!kinds || kinds.length === 0) return [];

  const lang = astGrep.Lang[langName as keyof typeof astGrep.Lang];
  if (!lang) return [];

  try {
    const { parse } = astGrep;
    const root = parse(lang, content).root();
    const lines = content.split("\n");
    const chunks: Chunk[] = [];

    for (const kind of kinds) {
      const nodes = root.findAll({ rule: { kind } });
      for (const node of nodes) {
        const range = node.range();
        const start = range.start.line;
        const end = range.end.line;

        // Filter trivial chunks (one-liners, stubs)
        if (end - start < MIN_CHUNK_LINES) continue;

        // Name: first CHUNK_NAME_CHARS of the node's source text (contains the signature)
        const name = node.text().slice(0, CHUNK_NAME_CHARS);

        chunks.push({
          name,
          start,
          end,
          content: lines.slice(start, end + 1).join("\n"),
        });
      }
    }

    // Arrow function parent-walk (TypeScript, TSX, JavaScript only).
    //
    // Finds named arrow functions by walking bottom-up: arrow_function → parent
    // variable_declarator → binding identifier. Only chunks named arrows
    // (anonymous callbacks and one-liners are filtered).
    //
    // Example AST for `export const rateLimitBackoff = async () => {}`:
    //   export_statement
    //     lexical_declaration
    //       variable_declarator        ← immediate parent of arrow_function
    //         identifier (rateLimitBackoff)
    //         arrow_function
    //
    // `.parent()` returns the immediate parent only — always variable_declarator
    // for top-level const/let arrow bindings regardless of export status.
    if (ARROW_WALK_LANGS.has(langName)) {
      const arrowNodes = root.findAll({ rule: { kind: "arrow_function" } });
      for (const node of arrowNodes) {
        const parent = node.parent();
        // Only process arrows whose immediate parent is a variable_declarator
        if (!parent || parent.kind() !== "variable_declarator") continue;

        // Extract the binding identifier (first named child of variable_declarator)
        const nameNode = parent.children().find(
          (c) => c.kind() === "identifier" || c.kind() === "shorthand_property_identifier_pattern",
        );
        if (!nameNode) continue;

        const bindingName = nameNode.text();
        if (!bindingName) continue;

        const range = node.range();
        const start = range.start.line;
        const end = range.end.line;

        // Filter trivial arrows (one-liners, expression bodies)
        if (end - start < MIN_CHUNK_LINES) continue;

        chunks.push({
          name: bindingName.slice(0, CHUNK_NAME_CHARS),
          start,
          end,
          content: lines.slice(start, end + 1).join("\n"),
        });
      }
    }

    // Dedup: sort by start asc, then end asc; keep only non-overlapping chunks.
    // "Outer-wins" applies to different-start overlaps (outer starts earlier, so
    // it's added first and the inner chunk is dropped because inner.start <= outer.end).
    // For same-start ties the shorter chunk wins — a degenerate case that doesn't
    // occur in practice because two declarations can't share a start line.
    // With method-only CHUNK_KINDS (no class_declaration), most overlaps are
    // nested methods inside closures. Outer context provides more embedding signal.
    chunks.sort((a, b) => a.start - b.start || a.end - b.end);
    const deduped: Chunk[] = [];
    let lastEnd = -1;
    for (const c of chunks) {
      if (c.start > lastEnd) {
        deduped.push(c);
        lastEnd = c.end;
      }
    }

    return deduped;
  } catch {
    // Parse failure (syntax error, unsupported grammar variant) → whole-file fallback
    return [];
  }
}
