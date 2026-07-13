import { describe, it, expect } from 'vitest';
import { reconcile, type GoldenPool, type PrefixQrels } from './qrelsReconciliation.js';

function pool(goldenId: string, candidateIds: string[]): GoldenPool {
  return {
    goldenId,
    message: 'msg',
    style: 'short-reactive',
    oldestHistoryMs: 0,
    arms: ['bare-dense'],
    candidates: candidateIds.map(id => ({
      corpusId: id,
      createdAtMs: 0,
      contentPreview: 'preview',
      ranks: { 'bare-dense': 1 },
      verdict: 'eligible' as const,
    })),
  };
}

const G1 = 'aaaa1111-1111-1111-1111-111111111111';
const G2 = 'bbbb2222-2222-2222-2222-222222222222';
const C1 = 'cccc1111-0000-0000-0000-000000000000';
const C2 = 'dddd2222-0000-0000-0000-000000000000';

describe('reconcile', () => {
  it('resolves prefix-keyed qrels to full ids and preserves grades', () => {
    const pools = [pool(G1, [C1, C2])];
    const prefixQrels: PrefixQrels = { aaaa1111: { cccc1111: 1, dddd2222: 0.5 } };
    const { queries, qrels } = reconcile(pools, prefixQrels);
    expect(queries).toHaveLength(1);
    expect(queries[0].queryId).toBe(G1);
    expect(qrels[G1]).toEqual({ [C1]: 1, [C2]: 0.5 });
  });

  it('maps every pool candidate into ScoredQuery with its verdict + ranks', () => {
    const { queries } = reconcile([pool(G1, [C1])], { aaaa1111: { cccc1111: 1 } });
    expect(queries[0].candidates[0]).toEqual({
      corpusId: C1,
      verdict: 'eligible',
      ranks: { 'bare-dense': 1 },
    });
  });

  it('skips `_`-prefixed annotation keys (free-text) at both golden and candidate level', () => {
    const pools = [pool(G1, [C1])];
    const prefixQrels: PrefixQrels = {
      _rubric: 'the whole scoring rubric goes here',
      aaaa1111: { _theme: 'a note about this golden', cccc1111: 1 },
    };
    const { qrels } = reconcile(pools, prefixQrels);
    expect(qrels[G1]).toEqual({ [C1]: 1 }); // _theme skipped, no error thrown
  });

  it('HARD-ERRORS on a non-numeric grade for a real (non-annotation) candidate key', () => {
    const pools = [pool(G1, [C1])];
    expect(() => reconcile(pools, { aaaa1111: { cccc1111: 'typo' } })).toThrow(
      /candidate prefix "cccc1111".*non-numeric grade/
    );
  });

  it('HARD-ERRORS when two prefixes resolve to the SAME candidate (silent-overwrite hole)', () => {
    const pools = [pool(G1, [C1])];
    // Both "cccc" and "cccc1111" uniquely resolve to C1 — the second would overwrite.
    expect(() => reconcile(pools, { aaaa1111: { cccc: 1, cccc1111: 0.5 } })).toThrow(
      /already graded by another prefix/
    );
  });

  it('HARD-ERRORS on a candidate prefix that matches zero ids', () => {
    const pools = [pool(G1, [C1])];
    expect(() => reconcile(pools, { aaaa1111: { deadbeef: 1 } })).toThrow(
      /candidate prefix "deadbeef".*matched 0 ids/
    );
  });

  it('HARD-ERRORS on a golden prefix that matches zero ids', () => {
    const pools = [pool(G1, [C1])];
    expect(() => reconcile(pools, { ffffffff: { cccc1111: 1 } })).toThrow(
      /golden prefix "ffffffff".*matched 0 ids/
    );
  });

  it('HARD-ERRORS on an ambiguous prefix that matches multiple ids', () => {
    // Two candidates share the 4-char prefix "cccc" → ambiguous.
    const pools = [pool(G1, ['cccc1111-a', 'cccc2222-b'])];
    expect(() => reconcile(pools, { aaaa1111: { cccc: 1 } })).toThrow(
      /candidate prefix "cccc".*matched 2 ids/
    );
  });

  it('collects ALL bad prefixes and throws once (not one-per-run)', () => {
    const pools = [pool(G1, [C1]), pool(G2, [C2])];
    const prefixQrels: PrefixQrels = {
      aaaa1111: { deadbeef: 1 }, // bad candidate
      ffffffff: { cccc1111: 1 }, // bad golden
    };
    let message = '';
    try {
      reconcile(pools, prefixQrels);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('failed for 2 prefix(es)');
    expect(message).toContain('deadbeef');
    expect(message).toContain('ffffffff');
  });

  it('produces an empty grade map for a golden judged with only annotation keys', () => {
    // A golden with no real relevant marks (e.g. an excluded turn) is still a valid
    // query with empty qrels — poolScoring then drops it from the denominator.
    const { qrels } = reconcile([pool(G1, [C1])], {
      aaaa1111: { _theme: 'excluded — no relevant' as unknown as number },
    });
    expect(qrels[G1]).toEqual({});
  });
});
