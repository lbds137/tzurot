import { describe, it, expect } from 'vitest';
import { DeploymentMetaSchema } from './deployment-meta.js';

function accepts(commitHash: string): boolean {
  return DeploymentMetaSchema.safeParse({ commitHash }).success;
}

describe('DeploymentMetaSchema commitHash', () => {
  it('accepts a 7-character lowercase short SHA', () => {
    expect(accepts('1234abc')).toBe(true);
  });

  it('accepts a 40-character lowercase full SHA', () => {
    expect(accepts('a'.repeat(40))).toBe(true);
  });

  // A leading '-' would be read by git as a flag, not a revision.
  it("rejects a leading '-'", () => {
    expect(accepts('-1234abc')).toBe(false);
  });

  it('rejects uppercase hex', () => {
    expect(accepts('ABC1234')).toBe(false);
  });

  it('rejects a 41-character string', () => {
    expect(accepts('a'.repeat(41))).toBe(false);
  });
});
