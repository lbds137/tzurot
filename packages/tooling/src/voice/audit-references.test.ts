import { describe, it, expect } from 'vitest';
import { classifyDuration, MISTRAL_REF_CAP_S, NEAR_CAP_MARGIN_S } from './audit-references.js';

describe('classifyDuration', () => {
  it('classifies null as errored (probe failure)', () => {
    expect(classifyDuration(null)).toBe('errored');
  });

  it('classifies durations comfortably under cap as ok', () => {
    expect(classifyDuration(0)).toBe('ok');
    expect(classifyDuration(15)).toBe('ok');
    expect(classifyDuration(MISTRAL_REF_CAP_S - NEAR_CAP_MARGIN_S - 0.01)).toBe('ok');
  });

  it('classifies durations within the safety margin as near_cap', () => {
    // Just inside the margin → near_cap
    expect(classifyDuration(MISTRAL_REF_CAP_S - NEAR_CAP_MARGIN_S + 0.01)).toBe('near_cap');
    // Exactly at cap → near_cap (still safe, but no headroom)
    expect(classifyDuration(MISTRAL_REF_CAP_S)).toBe('near_cap');
    // Just under by epsilon → near_cap (the lilith-tzel-shani 29.99s case)
    expect(classifyDuration(29.99)).toBe('near_cap');
  });

  it('classifies durations over the cap as over', () => {
    // Just over → over (the ha-shem-keev-ima 31.78s case from prod)
    expect(classifyDuration(MISTRAL_REF_CAP_S + 0.01)).toBe('over');
    expect(classifyDuration(31.78)).toBe('over');
    // Way over → over (the rich-fairbank-meshavesh-astrategi 235s outlier from prod)
    expect(classifyDuration(235)).toBe('over');
  });

  it('boundary is exclusive at the cap (strictly-greater triggers over)', () => {
    // 30.0 is at the cap, not over it — Mistral itself uses "exceeds 30.0",
    // so the boundary is exclusive.
    expect(classifyDuration(MISTRAL_REF_CAP_S)).not.toBe('over');
  });
});
