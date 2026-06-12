import { describe, it, expect } from 'vitest';
import {
  computeContextCap,
  clampContextWindow,
  SMALL_CONTEXT_THRESHOLD,
} from './contextWindowCap.js';

describe('computeContextCap', () => {
  it('caps small models at 75% of context length', () => {
    expect(computeContextCap(32768)).toBe(24576);
    expect(computeContextCap(8192)).toBe(6144);
  });

  it('caps large models at 50% of context length', () => {
    expect(computeContextCap(131072)).toBe(65536);
    expect(computeContextCap(200000)).toBe(100000);
  });

  it('treats the threshold itself as small (75%)', () => {
    expect(computeContextCap(SMALL_CONTEXT_THRESHOLD)).toBe(49152);
  });

  it('treats one token above the threshold as large (50%)', () => {
    expect(computeContextCap(SMALL_CONTEXT_THRESHOLD + 1)).toBe(
      Math.floor((SMALL_CONTEXT_THRESHOLD + 1) / 2)
    );
  });

  it('floors fractional results', () => {
    // 1001 * 0.75 = 750.75 → 750
    expect(computeContextCap(1001)).toBe(750);
  });

  it('never returns the full context length', () => {
    for (const len of [1000, 32768, 65536, 65537, 131072, 1048576]) {
      expect(computeContextCap(len)).toBeLessThan(len);
    }
  });
});

describe('clampContextWindow', () => {
  it('clamps a configured value above the cap', () => {
    // The prod incident shape: 32768 configured on a 32k model
    expect(clampContextWindow(32768, 32768)).toBe(24576);
  });

  it('passes through a configured value below the cap', () => {
    expect(clampContextWindow(20000, 32768)).toBe(20000);
    expect(clampContextWindow(65536, 200000)).toBe(65536);
  });

  it('uses the configured value as-is when the model context length is unknown', () => {
    expect(clampContextWindow(131072, null)).toBe(131072);
    expect(clampContextWindow(32768, null)).toBe(32768);
  });

  it('clamps the 128k default against a small model', () => {
    // A preset created without contextWindowTokens gets the DB default 131072;
    // the clamp must protect a small model from it.
    expect(clampContextWindow(131072, 32768)).toBe(24576);
  });
});
