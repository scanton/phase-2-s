import { describe, it, expect } from 'vitest';
import { ROLE_PROMPTS, type Role } from '../../src/orchestrator/role-prompts.js';

const EXPECTED_ROLES: Role[] = ['architect', 'implementer', 'tester', 'reviewer'];

describe('ROLE_PROMPTS', () => {
  it('has all 4 roles defined', () => {
    for (const role of EXPECTED_ROLES) {
      expect(ROLE_PROMPTS).toHaveProperty(role);
    }
  });

  it('architect prompt contains the sentinel comment', () => {
    expect(ROLE_PROMPTS.architect).toContain('<!-- CONTEXT -->');
  });

  it('each role prompt is a non-empty string', () => {
    for (const role of EXPECTED_ROLES) {
      expect(typeof ROLE_PROMPTS[role]).toBe('string');
      expect(ROLE_PROMPTS[role].length).toBeGreaterThan(0);
    }
  });

  it('non-architect roles do NOT contain the sentinel comment', () => {
    const nonArchitectRoles: Role[] = ['implementer', 'tester', 'reviewer'];
    for (const role of nonArchitectRoles) {
      expect(ROLE_PROMPTS[role]).not.toContain('<!-- CONTEXT -->');
    }
  });

  it('Role type covers exactly the 4 expected values', () => {
    // Verify object keys match exactly
    const keys = Object.keys(ROLE_PROMPTS).sort();
    expect(keys).toEqual(['architect', 'implementer', 'reviewer', 'tester']);
  });
});
