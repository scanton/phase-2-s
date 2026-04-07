/**
 * Typed architect context for the multi-agent orchestrator (Sprint 39).
 *
 * Replaces the freeform `<!-- CONTEXT -->` sentinel with a structured
 * `context-json` block that downstream workers and replanOnFailure() can parse.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArchitectContext {
  decisions: Array<{ component: string; decision: string; rationale: string }>;
  activeFiles: string[];
  constraintsForDownstream: string[];
}

// ---------------------------------------------------------------------------
// Sentinel
// ---------------------------------------------------------------------------

export const ARCHITECT_CONTEXT_JSON_SENTINEL = '```context-json';

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse an ArchitectContext from architect worker stdout.
 *
 * Looks for a ```context-json block, extracts the content up to the closing
 * ``` fence, and JSON.parse with validation. Returns null on any failure —
 * never throws. Callers treat null as "no context available".
 */
export function parseArchitectContext(stdout: string): ArchitectContext | null {
  const start = stdout.indexOf(ARCHITECT_CONTEXT_JSON_SENTINEL);
  if (start === -1) return null;

  const contentStart = start + ARCHITECT_CONTEXT_JSON_SENTINEL.length;
  const end = stdout.indexOf('```', contentStart);
  if (end === -1) return null;

  const raw = stdout.slice(contentStart, end).trim();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isArchitectContext(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

function isArchitectContext(x: unknown): x is ArchitectContext {
  if (typeof x !== 'object' || x === null) return false;
  const obj = x as Record<string, unknown>;

  if (!Array.isArray(obj.decisions)) return false;
  for (const d of obj.decisions) {
    if (typeof d !== 'object' || d === null) return false;
    const dec = d as Record<string, unknown>;
    if (typeof dec.component !== 'string') return false;
    if (typeof dec.decision !== 'string') return false;
    if (typeof dec.rationale !== 'string') return false;
  }

  if (!Array.isArray(obj.activeFiles)) return false;
  if (!obj.activeFiles.every((f: unknown) => typeof f === 'string')) return false;

  if (!Array.isArray(obj.constraintsForDownstream)) return false;
  if (!obj.constraintsForDownstream.every((c: unknown) => typeof c === 'string')) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Instruction formatter
// ---------------------------------------------------------------------------

/**
 * Returns the instruction text injected into the architect role prompt.
 * Tells the architect worker to emit a context-json block.
 */
export function formatArchitectContextInstructions(): string {
  return `After completing your architectural analysis, emit a context-json block so downstream workers can use your decisions. Format:

\`\`\`context-json
{"decisions":[{"component":"...","decision":"...","rationale":"..."}],"activeFiles":["..."],"constraintsForDownstream":["..."]}
\`\`\`

This block will be parsed by the orchestrator and injected into downstream worker prompts. The "decisions", "activeFiles", and "constraintsForDownstream" fields are all required.`;
}
