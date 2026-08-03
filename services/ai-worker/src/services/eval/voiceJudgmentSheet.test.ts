import { describe, it, expect } from 'vitest';

import type { ResolvedVerdict } from './voiceJudgePrompt.js';
import {
  buildBlinding,
  buildOwnerSheet,
  computeGate,
  DEFAULT_THRESHOLDS,
  mulberry32,
  parseOwnerSheet,
  selectOwnerReviewPairs,
  type OwnerMark,
  type VoicePair,
} from './voiceJudgmentSheet.js';

const verdict = (
  winner: ResolvedVerdict['winner'],
  violations: ResolvedVerdict['violations'] = []
): ResolvedVerdict => ({ winner, consistent: winner !== 'tie', violations });

let pairCounter = 0;
function pair(overrides: Partial<VoicePair>): VoicePair {
  pairCounter += 1;
  const probeId = overrides.probeId ?? `probe-${pairCounter}`;
  const kind = overrides.kind ?? 'AB';
  return {
    pairId: `${probeId}:${kind}`,
    probeId,
    personalitySlug: 'char-one',
    depth: 10,
    kind,
    leftText: 'left response',
    rightText: 'right response',
    verdict: verdict('tie'),
    ...overrides,
  };
}

describe('mulberry32', () => {
  it('is deterministic per seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('selectOwnerReviewPairs', () => {
  it('always includes tested-arm losses and violation pairs; controls only via the sample', () => {
    const pairs = [
      pair({ probeId: 'p1', verdict: verdict('left') }), // tested arm lost → flagged
      pair({ probeId: 'p2', verdict: verdict('right') }),
      pair({
        probeId: 'p3',
        verdict: verdict('tie', [{ side: 'right', kind: 'leak', quote: 'x' }]),
      }), // violation → flagged
      pair({ probeId: 'p4', kind: 'BB2', verdict: verdict('left') }), // control: left-win is NOT a flag
      pair({ probeId: 'p5', verdict: verdict('tie') }),
    ];
    const selected = selectOwnerReviewPairs(pairs, 1, 7);
    expect(selected).toContain('p1:AB');
    expect(selected).toContain('p3:AB');
    // Exactly flagged (2) + sample (1).
    expect(selected).toHaveLength(3);
  });

  it('is deterministic per seed', () => {
    const pairs = [pair({}), pair({}), pair({}), pair({})];
    expect(selectOwnerReviewPairs(pairs, 2, 5)).toEqual(selectOwnerReviewPairs(pairs, 2, 5));
  });
});

describe('owner sheet round-trip', () => {
  const pairs = [
    pair({ probeId: 'alpha', verdict: verdict('left'), leftText: 'L-ALPHA', rightText: 'R-ALPHA' }),
    pair({ probeId: 'beta', verdict: verdict('tie'), leftText: 'L-BETA', rightText: 'R-BETA' }),
  ];
  const reviewIds = pairs.map(entry => entry.pairId);
  const blinding = buildBlinding(reviewIds, 99);
  const context = new Map([
    ['alpha', { personalitySlug: 'char-one', triggerText: 'what now?' }],
    ['beta', { personalitySlug: 'char-one', triggerText: 'and then?' }],
  ]);

  /** Check one box INSIDE a specific pair's section (plain .replace would hit
   * whichever pair renders first). */
  function checkIn(sheet: string, pairId: string, line: string, replacement?: string): string {
    const start = sheet.indexOf(`## Pair \`${pairId}\``);
    expect(start).toBeGreaterThan(-1);
    const nextHeading = sheet.indexOf('## Pair', start + 1);
    const end = nextHeading === -1 ? sheet.length : nextHeading;
    const section = sheet
      .slice(start, end)
      .replace(`- [ ] ${line}`, `- [x] ${replacement ?? line}`);
    return sheet.slice(0, start) + section + sheet.slice(end);
  }

  it('renders blinded responses per the blinding map and withholds arm identities', () => {
    const sheet = buildOwnerSheet(pairs, reviewIds, blinding, context);
    expect(sheet).not.toMatch(/arm [ABC]\b/i);
    for (const entry of blinding) {
      const body = sheet.slice(sheet.indexOf(`## Pair \`${entry.pairId}\``));
      const probe = entry.pairId.split(':')[0].toUpperCase();
      const first = body.indexOf(entry.leftIsResponse1 ? `L-${probe}` : `R-${probe}`);
      const second = body.indexOf(entry.leftIsResponse1 ? `R-${probe}` : `L-${probe}`);
      expect(first).toBeGreaterThan(-1);
      expect(first).toBeLessThan(second);
    }
  });

  it('parses filled marks back to canonical sides through the blinding map', () => {
    const sheet = buildOwnerSheet(pairs, reviewIds, blinding, context);
    // Owner: pair alpha → "response 1 reads more in-voice"; pair beta → same.
    let filled = checkIn(sheet, 'alpha:AB', 'response 1 reads more in-voice');
    filled = checkIn(filled, 'beta:AB', 'same / within normal variation');
    const marks = parseOwnerSheet(filled, blinding);
    expect(marks).toHaveLength(2);
    const alphaMark = marks.find(mark => mark.pairId === 'alpha:AB');
    const alphaBlind = blinding.find(entry => entry.pairId === 'alpha:AB');
    expect(alphaMark?.verdict).toBe(alphaBlind?.leftIsResponse1 === true ? 'left' : 'right');
    expect(marks.find(mark => mark.pairId === 'beta:AB')?.verdict).toBe('same');
  });

  it('hard-errors on a HARD BREAK checked without a verdict box (never silently dropped)', () => {
    const sheet = buildOwnerSheet(pairs, reviewIds, blinding, context);
    const orphaned = checkIn(
      sheet,
      'alpha:AB',
      'HARD BREAK in response __: describe what you saw',
      'HARD BREAK in response 1: identity slip'
    );
    expect(() => parseOwnerSheet(orphaned, blinding)).toThrow(/no verdict box/);
  });

  it('hard-errors on multiple checked verdicts (ambiguity is loud, never guessed)', () => {
    const sheet = buildOwnerSheet(pairs, reviewIds, blinding, context);
    let doubled = checkIn(sheet, 'alpha:AB', 'response 1 reads more in-voice');
    doubled = checkIn(doubled, 'alpha:AB', 'response 2 reads more in-voice');
    expect(() => parseOwnerSheet(doubled, blinding)).toThrow(/multiple verdict boxes/);
  });

  it('parses a hard-break mark with its blinded response number mapped to a side', () => {
    const sheet = buildOwnerSheet(pairs, reviewIds, blinding, context);
    let filled = checkIn(sheet, 'alpha:AB', 'response 2 reads more in-voice');
    filled = checkIn(
      filled,
      'alpha:AB',
      'HARD BREAK in response __: describe what you saw',
      'HARD BREAK in response 2: leaked speaker tag'
    );
    const marks = parseOwnerSheet(filled, blinding);
    const marked = marks.find(mark => mark.hardBreak !== undefined);
    expect(marked).toBeDefined();
    const blind = blinding.find(entry => entry.pairId === marked?.pairId);
    expect(marked?.hardBreak?.side).toBe(blind?.leftIsResponse1 === true ? 'right' : 'left');
  });
});

describe('computeGate', () => {
  const abPairs = (lefts: number, rights: number, ties: number, slug = 'char-one'): VoicePair[] => [
    ...Array.from({ length: lefts }, () =>
      pair({ personalitySlug: slug, verdict: verdict('left') })
    ),
    ...Array.from({ length: rights }, () =>
      pair({ personalitySlug: slug, verdict: verdict('right') })
    ),
    ...Array.from({ length: ties }, () => pair({ personalitySlug: slug, verdict: verdict('tie') })),
  ];
  const cleanControls = (count: number): VoicePair[] =>
    Array.from({ length: count }, () => pair({ kind: 'BB2', verdict: verdict('tie') }));

  it('does not FAIL on a balanced outcome (owner still holds PASS authority)', () => {
    const result = computeGate({
      testPairs: abPairs(3, 2, 19),
      controlPairs: cleanControls(6),
      ownerMarks: [],
      reproducedHardBreaks: 0,
    });
    expect(result.verdict).toBe('NOT_FAILED_PENDING_OWNER');
    expect(result.net).toBeCloseTo(1 / 24);
  });

  it('FAILs when net tested-arm losses exceed max(control net + margin, floor)', () => {
    const result = computeGate({
      testPairs: abPairs(6, 1, 17), // net = 5/24 ≈ 0.21 > 0.15 floor
      controlPairs: cleanControls(6),
      ownerMarks: [],
      reproducedHardBreaks: 0,
    });
    expect(result.verdict).toBe('FAIL');
    expect(result.reasons.join(' ')).toContain('Net tested-arm losses');
  });

  it('a noisy control RAISES the net threshold (noise-anchored gating)', () => {
    const noisyControls = [
      ...Array.from({ length: 3 }, () => pair({ kind: 'BB2', verdict: verdict('left') })),
      ...cleanControls(3),
    ];
    // control net = 3/6 = 0.5 → threshold 0.6; net 0.21 no longer fails…
    const result = computeGate({
      testPairs: abPairs(6, 1, 17),
      controlPairs: noisyControls,
      ownerMarks: [],
      reproducedHardBreaks: 0,
    });
    expect(result.reasons.join(' ')).not.toContain('Net tested-arm losses');
    // …but that same control noise (consistent rate 0.5 > 0.35) reads as under-powered.
    expect(result.verdict).toBe('UNDERPOWERED');
  });

  it('FAILs on a per-persona collapse even when the aggregate net looks fine', () => {
    const result = computeGate({
      testPairs: [...abPairs(5, 0, 1, 'collapsing'), ...abPairs(0, 2, 16, 'healthy')],
      controlPairs: cleanControls(6),
      ownerMarks: [],
      reproducedHardBreaks: 0,
    });
    expect(result.verdict).toBe('FAIL');
    expect(result.reasons.join(' ')).toContain('collapsing');
  });

  it('FAILs on a reproduced hard break regardless of nets', () => {
    const result = computeGate({
      testPairs: abPairs(0, 0, 24),
      controlPairs: cleanControls(6),
      ownerMarks: [],
      reproducedHardBreaks: 1,
    });
    expect(result.verdict).toBe('FAIL');
  });

  it('owner marks OVERRIDE the judge on reviewed pairs', () => {
    const pairs = abPairs(6, 1, 17); // judge says FAIL-worthy
    const overrides: OwnerMark[] = pairs
      .filter(entry => entry.verdict.winner === 'left')
      .map(entry => ({ pairId: entry.pairId, verdict: 'same' as const }));
    const result = computeGate({
      testPairs: pairs,
      controlPairs: cleanControls(6),
      ownerMarks: overrides,
      reproducedHardBreaks: 0,
    });
    // Owner reviewed every judge-flagged loss and called them equivalent.
    expect(result.verdict).toBe('NOT_FAILED_PENDING_OWNER');
    expect(result.testedArmLosses).toBe(0);
  });

  it('counts only owner marks that touched THIS gate’s pairs (mixed-round sheets must not overcount)', () => {
    const pairs = abPairs(0, 0, 4);
    const result = computeGate({
      testPairs: pairs,
      controlPairs: cleanControls(2),
      ownerMarks: [
        { pairId: pairs[0].pairId, verdict: 'same' },
        { pairId: 'other-round:CA', verdict: 'left', hardBreak: { side: 'left', note: 'x' } },
      ],
      reproducedHardBreaks: 0,
    });
    expect(result.ownerOverrides).toBe(1);
    expect(result.ownerHardBreaks).toBe(0);
  });

  it('exposes the default thresholds for the report header (pre-registration)', () => {
    expect(DEFAULT_THRESHOLDS).toEqual({
      minNetFail: 0.15,
      controlMargin: 0.1,
      personaCollapse: 0.4,
      underpoweredControlRate: 0.35,
    });
  });
});
