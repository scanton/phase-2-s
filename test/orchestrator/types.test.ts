/**
 * Unit tests for isDeltaResponse() type predicate in orchestrator/types.ts.
 * Covers slug validation (path traversal prevention) and dependsOn element typing.
 */

import { describe, it, expect } from 'vitest';
import { isDeltaResponse } from '../../src/orchestrator/types.js';

const validJob = {
  id: 'fix-schema',
  title: 'Fix schema',
  role: 'implementer' as const,
  prompt: 'Do something',
  files: [],
  criteria: [],
  dependsOn: [],
  systemPromptPrefix: '',
};

describe('isDeltaResponse', () => {
  it('valid delta with one job passes', () => {
    expect(isDeltaResponse({ delta: [validJob] })).toBe(true);
  });

  it('empty delta array passes', () => {
    expect(isDeltaResponse({ delta: [] })).toBe(true);
  });

  it('null input fails', () => {
    expect(isDeltaResponse(null)).toBe(false);
  });

  it('non-object input fails', () => {
    expect(isDeltaResponse('string')).toBe(false);
    expect(isDeltaResponse(42)).toBe(false);
  });

  it('delta: null fails', () => {
    expect(isDeltaResponse({ delta: null })).toBe(false);
  });

  it('delta: string fails', () => {
    expect(isDeltaResponse({ delta: 'not-array' })).toBe(false);
  });

  it('delta item missing id fails', () => {
    const bad = { ...validJob };
    delete (bad as { id?: string }).id;
    expect(isDeltaResponse({ delta: [bad] })).toBe(false);
  });

  it('delta item with path-traversal id fails', () => {
    expect(isDeltaResponse({ delta: [{ ...validJob, id: '../evil' }] })).toBe(false);
  });

  it('delta item with absolute path id fails', () => {
    expect(isDeltaResponse({ delta: [{ ...validJob, id: '/etc/passwd' }] })).toBe(false);
  });

  it('delta item with uppercase id fails', () => {
    expect(isDeltaResponse({ delta: [{ ...validJob, id: 'MyJob' }] })).toBe(false);
  });

  it('delta item with spaces in id fails', () => {
    expect(isDeltaResponse({ delta: [{ ...validJob, id: 'fix schema' }] })).toBe(false);
  });

  it('delta item with slug starting with hyphen fails', () => {
    expect(isDeltaResponse({ delta: [{ ...validJob, id: '-bad-start' }] })).toBe(false);
  });

  it('valid slug with internal hyphens passes', () => {
    expect(isDeltaResponse({ delta: [{ ...validJob, id: 'fix-db-schema-v2' }] })).toBe(true);
  });

  it('delta item missing title fails', () => {
    const bad = { ...validJob };
    delete (bad as { title?: string }).title;
    expect(isDeltaResponse({ delta: [bad] })).toBe(false);
  });

  it('delta item with invalid role fails', () => {
    expect(isDeltaResponse({ delta: [{ ...validJob, role: 'hacker' }] })).toBe(false);
  });

  it('delta item missing prompt fails', () => {
    const bad = { ...validJob };
    delete (bad as { prompt?: string }).prompt;
    expect(isDeltaResponse({ delta: [bad] })).toBe(false);
  });

  it('delta item missing dependsOn fails', () => {
    const bad = { ...validJob };
    delete (bad as { dependsOn?: string[] }).dependsOn;
    expect(isDeltaResponse({ delta: [bad] })).toBe(false);
  });

  it('delta item with non-string dependsOn element fails', () => {
    expect(isDeltaResponse({ delta: [{ ...validJob, dependsOn: [42] }] })).toBe(false);
  });

  it('delta item with non-string dependsOn element (null) fails', () => {
    expect(isDeltaResponse({ delta: [{ ...validJob, dependsOn: [null] }] })).toBe(false);
  });

  it('delta item with valid string dependsOn elements passes', () => {
    expect(isDeltaResponse({ delta: [{ ...validJob, dependsOn: ['job-a', 'job-b'] }] })).toBe(true);
  });
});
