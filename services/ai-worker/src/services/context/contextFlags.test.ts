import { describe, it, expect } from 'vitest';
import { isAssemblyPromoteEnabled } from './contextFlags.js';

describe('isAssemblyPromoteEnabled', () => {
  it('is true only for the exact string "true"', () => {
    expect(isAssemblyPromoteEnabled({ CONTEXT_ASSEMBLY_PROMOTE: 'true' })).toBe(true);
  });

  it('is false when the flag is absent', () => {
    expect(isAssemblyPromoteEnabled({})).toBe(false);
  });

  it('is false for any non-"true" value (no truthy coercion)', () => {
    expect(isAssemblyPromoteEnabled({ CONTEXT_ASSEMBLY_PROMOTE: '1' })).toBe(false);
    expect(isAssemblyPromoteEnabled({ CONTEXT_ASSEMBLY_PROMOTE: 'TRUE' })).toBe(false);
    expect(isAssemblyPromoteEnabled({ CONTEXT_ASSEMBLY_PROMOTE: 'false' })).toBe(false);
  });
});
