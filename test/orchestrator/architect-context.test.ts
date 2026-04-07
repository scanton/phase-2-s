import { describe, it, expect } from 'vitest';
import {
  parseArchitectContext,
  formatArchitectContextInstructions,
  ARCHITECT_CONTEXT_JSON_SENTINEL,
  type ArchitectContext,
} from '../../src/orchestrator/architect-context.js';

const VALID_CTX: ArchitectContext = {
  decisions: [{ component: 'auth', decision: 'use JWT', rationale: 'stateless' }],
  activeFiles: ['src/auth.ts'],
  constraintsForDownstream: ['Use bearer token header'],
};

function wrapInBlock(json: string): string {
  return `Some preamble\n\`\`\`context-json\n${json}\n\`\`\`\nSome postamble`;
}

describe('parseArchitectContext', () => {
  it('round-trip: valid JSON block → ArchitectContext', () => {
    const stdout = wrapInBlock(JSON.stringify(VALID_CTX));
    const result = parseArchitectContext(stdout);
    expect(result).toEqual(VALID_CTX);
  });

  it('null on malformed JSON', () => {
    const stdout = wrapInBlock('{ "decisions": [BROKEN }');
    expect(parseArchitectContext(stdout)).toBeNull();
  });

  it('null when no sentinel present', () => {
    expect(parseArchitectContext('No sentinel here at all')).toBeNull();
  });

  it('null when sentinel present but no closing fence', () => {
    const stdout = `\`\`\`context-json\n${JSON.stringify(VALID_CTX)}\nno closing fence`;
    expect(parseArchitectContext(stdout)).toBeNull();
  });

  it('null when JSON is valid but not an ArchitectContext shape', () => {
    const stdout = wrapInBlock('{"wrong":"shape"}');
    expect(parseArchitectContext(stdout)).toBeNull();
  });

  it('null when decisions entries are missing required fields', () => {
    const bad = { decisions: [{ component: 'x' }], activeFiles: [], constraintsForDownstream: [] };
    const stdout = wrapInBlock(JSON.stringify(bad));
    expect(parseArchitectContext(stdout)).toBeNull();
  });
});

describe('formatArchitectContextInstructions', () => {
  it('contains the ARCHITECT_CONTEXT_JSON_SENTINEL string', () => {
    expect(formatArchitectContextInstructions()).toContain(ARCHITECT_CONTEXT_JSON_SENTINEL);
  });

  it('contains all three required field names', () => {
    const instructions = formatArchitectContextInstructions();
    expect(instructions).toContain('decisions');
    expect(instructions).toContain('activeFiles');
    expect(instructions).toContain('constraintsForDownstream');
  });
});
