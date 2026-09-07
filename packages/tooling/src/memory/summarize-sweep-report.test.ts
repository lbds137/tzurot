import { describe, it, expect } from 'vitest';
import {
  SUMMARIZER_PROMPT_OVERHEAD_TOKENS,
  CONTENT_TOKEN_INFLATION,
  FLIP_GATE_TARGET,
  estimateInputTokens,
  summarizedShare,
  factCoverageShare,
  formatGateLine,
  formatFactCoverageLine,
  type WindowCounts,
} from './summarize-sweep-report.js';

describe('estimateInputTokens', () => {
  it('sums the fixed overhead plus the inflated content-token estimate per row', () => {
    // 40 chars -> 10 tokens raw -> *1.3 = 13 -> ceil(13) = 13
    // 100 chars -> 25 tokens raw -> *1.3 = 32.5 -> ceil(32.5) = 33
    const rows = [
      { id: 'a', content_chars: 40 },
      { id: 'b', content_chars: 100 },
    ];

    const expected =
      SUMMARIZER_PROMPT_OVERHEAD_TOKENS + 13 + (SUMMARIZER_PROMPT_OVERHEAD_TOKENS + 33);
    expect(estimateInputTokens(rows)).toBe(expected);
  });

  it('confirms the inflation factor is actually applied (not just the overhead)', () => {
    const withoutInflation = SUMMARIZER_PROMPT_OVERHEAD_TOKENS + Math.ceil(40 / 4);
    const result = estimateInputTokens([{ id: 'a', content_chars: 40 }]);
    expect(result).not.toBe(withoutInflation);
    expect(CONTENT_TOKEN_INFLATION).toBeGreaterThan(1);
  });

  it('returns just zero for an empty row set', () => {
    expect(estimateInputTokens([])).toBe(0);
  });
});

function counts(overrides: Partial<WindowCounts> = {}): WindowCounts {
  return {
    total_non_chunk: 0,
    retrieved_in_window: 0,
    done_current: 0,
    done_older: 0,
    done_newer: 0,
    pending: 0,
    failed: 0,
    dead: 0,
    never_attempted: 0,
    ...overrides,
  };
}

describe('summarizedShare', () => {
  it('returns null on a zero denominator', () => {
    expect(summarizedShare(counts({ retrieved_in_window: 0, done_current: 0 }))).toBeNull();
  });

  it('divides done_current by retrieved_in_window', () => {
    expect(summarizedShare(counts({ retrieved_in_window: 200, done_current: 100 }))).toBe(0.5);
  });
});

describe('factCoverageShare', () => {
  it('returns null on a zero denominator', () => {
    expect(factCoverageShare(0, 0)).toBeNull();
  });

  it('divides covered by retrievedInWindow', () => {
    expect(factCoverageShare(25, 100)).toBe(0.25);
  });
});

describe('formatGateLine', () => {
  it('reports n/a and NOT READY when nothing was retrieved', () => {
    expect(formatGateLine(null)).toBe('GATE n/a (0 rows retrieved in the window) — NOT READY');
  });

  it('MEM-ARCH-030: is READY at exactly the 95.0% target (950/1000)', () => {
    const share = 950 / 1000;
    expect(share).toBe(FLIP_GATE_TARGET);
    expect(formatGateLine(share)).toBe('GATE 95.0% of 95% — READY');
  });

  it('MEM-ARCH-030: is NOT READY just under the target, even though it also displays as 94.9% (949/1000)', () => {
    const share = 949 / 1000;
    expect(formatGateLine(share)).toBe('GATE 94.9% of 95% — NOT READY');
  });

  it('MEM-ARCH-030: a share that rounds up to a displayed 95.0% but sits under the target reads NOT READY', () => {
    const share = summarizedShare(counts({ retrieved_in_window: 10000, done_current: 9496 }));
    const line = formatGateLine(share);
    expect(line).toContain('95.0%');
    expect(line).toContain('NOT READY');
  });
});

describe('formatFactCoverageLine', () => {
  it('reports n/a when nothing was retrieved', () => {
    expect(formatFactCoverageLine(null)).toBe('Fact coverage n/a (0 rows retrieved in the window)');
  });

  it('MEM-ARCH-030: formats a percentage of rows retrieved in the window', () => {
    expect(formatFactCoverageLine(0.5)).toBe('Fact coverage 50.0% of rows retrieved in the window');
  });
});
