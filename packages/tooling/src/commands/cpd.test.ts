import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  assertThresholdInRange,
  computeUpdatedBaseline,
  parseBaseline,
  getCpdConfigFingerprint,
} from './cpd.js';
import type { BaselineMeta } from '../audits/baseline-meta.js';

const fixtureMeta: BaselineMeta = {
  toolVersion: 'cpd-check/1.0',
  configHash: 'abc123def456',
  nodeVersion: 'v25.3.0',
  generatedFromSha: 'deadbeef00000000000000000000000000000000',
  generatedAt: '2026-05-17T12:00:00.000Z',
};

const filterSummary = (
  overrides: Partial<{
    filteredLines: number;
    filteredCount: number;
    rawLines: number;
    rawCount: number;
  }> = {}
) => ({
  filteredLines: 100,
  filteredCount: 5,
  rawLines: 200,
  rawCount: 10,
  ...overrides,
});

/**
 * Both helpers call `process.exit(1)` on the failure path. We replace `exit`
 * with a function that throws, so the test can catch the synthetic abort and
 * assert on the surrounding `console.error` calls. The real exit-1 contract
 * is documented by the throwing-instead-of-exiting test.
 */
class ExitCalled extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

beforeEach(() => {
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new ExitCalled(code ?? 0);
  }) as never);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('assertThresholdInRange', () => {
  it.each([0, 0.5, 0.8, 1])('accepts in-range value %s', threshold => {
    expect(() => assertThresholdInRange(threshold)).not.toThrow();
  });

  it.each([-0.1, 1.1, 2, -1])('exits non-zero for out-of-range value %s', threshold => {
    expect(() => assertThresholdInRange(threshold)).toThrow(ExitCalled);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('must be between 0.0 and 1.0')
    );
  });

  it.each([NaN, Infinity, -Infinity])('exits non-zero for non-finite value', threshold => {
    expect(() => assertThresholdInRange(threshold)).toThrow(ExitCalled);
  });
});

describe('parseBaseline', () => {
  it('returns parsed values on well-formed input', () => {
    const json = JSON.stringify({ filteredLines: 1752, graceMargin: 10 });
    const result = parseBaseline(json, '/baseline.json');
    expect(result).toEqual({ filteredLines: 1752, graceMargin: 10 });
  });

  it('omits graceMargin when not present', () => {
    const json = JSON.stringify({ filteredLines: 100 });
    const result = parseBaseline(json, '/baseline.json');
    expect(result.filteredLines).toBe(100);
    expect(result.graceMargin).toBeUndefined();
  });

  it('exits non-zero on invalid JSON', () => {
    expect(() => parseBaseline('not-json', '/baseline.json')).toThrow(ExitCalled);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not valid JSON'));
  });

  it('exits non-zero when content is not a JSON object', () => {
    expect(() => parseBaseline('[]', '/baseline.json')).toThrow(ExitCalled);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('must be a JSON object'));
  });

  it('exits non-zero when content is JSON null', () => {
    expect(() => parseBaseline('null', '/baseline.json')).toThrow(ExitCalled);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('must be a JSON object'));
  });

  it('exits non-zero when filteredLines is missing', () => {
    const json = JSON.stringify({ graceMargin: 5 });
    expect(() => parseBaseline(json, '/baseline.json')).toThrow(ExitCalled);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('missing required numeric field: filteredLines')
    );
  });

  it('exits non-zero when filteredLines is not a number', () => {
    const json = JSON.stringify({ filteredLines: 'not-a-number' });
    expect(() => parseBaseline(json, '/baseline.json')).toThrow(ExitCalled);
  });

  it('exits non-zero when filteredLines is NaN-shaped (non-finite)', () => {
    // JSON has no literal NaN/Infinity; the parser would already reject those.
    // This guard catches programmatic construction shapes that bypass JSON.
    const obj = { filteredLines: Number.POSITIVE_INFINITY };
    const json = JSON.stringify(obj); // becomes `{"filteredLines":null}` after stringify
    // The non-numeric branch fires here because Infinity serializes to null,
    // which produces the same fail-loud failure.
    expect(() => parseBaseline(json, '/baseline.json')).toThrow(ExitCalled);
  });

  it('exits non-zero when graceMargin is not a number', () => {
    const json = JSON.stringify({ filteredLines: 100, graceMargin: 'tight' });
    expect(() => parseBaseline(json, '/baseline.json')).toThrow(ExitCalled);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('graceMargin must be a finite number')
    );
  });
});

describe('computeUpdatedBaseline', () => {
  // Fixed clock so lastUpdated assertions are deterministic
  const fixedDate = new Date('2026-05-17T12:00:00.000Z');

  it('writes correct fields when no previous baseline exists', () => {
    const result = computeUpdatedBaseline(
      filterSummary({ filteredLines: 1500, filteredCount: 80, rawLines: 1800, rawCount: 100 }),
      {},
      0.8,
      fixtureMeta,
      fixedDate
    );

    expect(result.updated).toEqual({
      version: 1,
      lastUpdated: '2026-05-17T12:00:00.000Z',
      filteredLines: 1500,
      filteredCount: 80,
      rawDedupedLines: 1800,
      rawCount: 100,
      threshold: 0.8,
      graceMargin: 10,
      meta: fixtureMeta,
    });
    expect(result.delta).toBe(1500);
    expect(result.prevLines).toBe(0);
    expect(result.prevCount).toBe(0);
  });

  it('preserves arbitrary previous fields (notes, custom keys)', () => {
    const previous = {
      version: 2,
      filteredLines: 1500,
      filteredCount: 80,
      graceMargin: 25,
      notes: 'Custom note from prior maintainer',
      customField: 'preserved',
    };
    const result = computeUpdatedBaseline(
      filterSummary({ filteredLines: 1480 }),
      previous,
      0.8,
      fixtureMeta,
      fixedDate
    );

    expect(result.updated.version).toBe(2); // preserved
    expect(result.updated.graceMargin).toBe(25); // preserved
    expect(result.updated.notes).toBe('Custom note from prior maintainer');
    expect(result.updated.customField).toBe('preserved');
    expect(result.updated.filteredLines).toBe(1480); // overwritten
    expect(result.delta).toBe(-20); // 1480 - 1500
  });

  it('computes positive delta when baseline raised', () => {
    const previous = { filteredLines: 1500, filteredCount: 80 };
    const result = computeUpdatedBaseline(
      filterSummary({ filteredLines: 1520 }),
      previous,
      0.8,
      fixtureMeta,
      fixedDate
    );
    expect(result.delta).toBe(20);
  });

  it('computes negative delta when baseline lowered', () => {
    const previous = { filteredLines: 1500 };
    const result = computeUpdatedBaseline(
      filterSummary({ filteredLines: 1400 }),
      previous,
      0.8,
      fixtureMeta,
      fixedDate
    );
    expect(result.delta).toBe(-100);
  });

  it('defaults graceMargin to 10 when previous baseline has no graceMargin', () => {
    const previous = { filteredLines: 1500 };
    const result = computeUpdatedBaseline(filterSummary(), previous, 0.8, fixtureMeta, fixedDate);
    expect(result.updated.graceMargin).toBe(10);
  });

  it('defaults version to 1 when previous version is missing or non-numeric', () => {
    const result1 = computeUpdatedBaseline(filterSummary(), {}, 0.8, fixtureMeta, fixedDate);
    expect(result1.updated.version).toBe(1);

    const result2 = computeUpdatedBaseline(
      filterSummary(),
      { filteredLines: 100, version: 'broken' },
      0.8,
      fixtureMeta,
      fixedDate
    );
    expect(result2.updated.version).toBe(1);
  });

  it('records the threshold the filter was run at', () => {
    const result = computeUpdatedBaseline(filterSummary(), {}, 0.5, fixtureMeta, fixedDate);
    expect(result.updated.threshold).toBe(0.5);
  });

  it('writes the supplied meta block onto the updated baseline', () => {
    const result = computeUpdatedBaseline(filterSummary(), {}, 0.8, fixtureMeta, fixedDate);
    expect(result.updated.meta).toEqual(fixtureMeta);
  });
});

describe('getCpdConfigFingerprint', () => {
  it('returns the threshold and filterImplVersion', () => {
    const fp = getCpdConfigFingerprint(0.8);
    expect(fp.threshold).toBe(0.8);
    expect(typeof fp.filterImplVersion).toBe('number');
  });

  it('different thresholds produce different fingerprints', () => {
    const a = getCpdConfigFingerprint(0.8);
    const b = getCpdConfigFingerprint(0.7);
    expect(a.threshold).not.toBe(b.threshold);
  });
});
