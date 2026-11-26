import { describe, expect, it } from 'vitest';

import { effectiveMemoryBytes, liveMachineFacts } from './machineFacts.js';

const GIB = 1024 ** 3;

describe('effectiveMemoryBytes', () => {
  it('takes the container limit when it is below the host total', () => {
    expect(effectiveMemoryBytes(32 * GIB, 8 * GIB)).toBe(8 * GIB);
  });

  it('keeps the host total when the limit equals it', () => {
    expect(effectiveMemoryBytes(32 * GIB, 32 * GIB)).toBe(32 * GIB);
  });

  it.each([
    ['0 (no limit)', 0],
    ['undefined', undefined],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a negative value', -1],
    ['larger than the host total (cgroup max sentinel)', 2 ** 62],
  ])('treats %s as no limit', (_label, limit) => {
    expect(effectiveMemoryBytes(32 * GIB, limit)).toBe(32 * GIB);
  });
});

describe('liveMachineFacts', () => {
  it('returns positive CPU and memory facts for the live machine', () => {
    const facts = liveMachineFacts();
    expect(facts.cpus).toBeGreaterThan(0);
    expect(facts.memTotalBytes).toBeGreaterThan(0);
  });
});
