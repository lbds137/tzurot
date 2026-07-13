import { describe, it, expect } from 'vitest';
import {
  scoreArm,
  scoreArms,
  pairedFlips,
  combinedMissRate,
  eligibleRelevantIds,
  rankedIds,
  rrfRanks,
  withRrfArm,
  RRF_K,
  type ScoredQuery,
  type ScoredCandidate,
  type Qrels,
} from './poolScoring.js';

/** Build a candidate with all-eligible verdict unless overridden. */
function cand(
  corpusId: string,
  ranks: Record<string, number | null>,
  verdict: ScoredCandidate['verdict'] = 'eligible'
): ScoredCandidate {
  return { corpusId, verdict, ranks };
}

function q(queryId: string, candidates: ScoredCandidate[]): ScoredQuery {
  return { queryId, candidates };
}

describe('eligibleRelevantIds (the guard mask)', () => {
  it('keeps judged-relevant candidates whose verdict is eligible', () => {
    const query = q('q1', [cand('a', { d: 1 }), cand('b', { d: 2 })]);
    const qrels: Qrels = { q1: { a: 1, b: 1 } };
    expect([...eligibleRelevantIds(query, qrels)].sort()).toEqual(['a', 'b']);
  });

  it('EXCLUDES a judged-relevant candidate the guard flagged in-window', () => {
    // 'a' is relevant per qrels but sits inside the fold window → cannot earn credit.
    const query = q('q1', [cand('a', { d: 1 }, 'in-window'), cand('b', { d: 2 })]);
    const qrels: Qrels = { q1: { a: 1, b: 1 } };
    expect([...eligibleRelevantIds(query, qrels)]).toEqual(['b']);
  });

  it('EXCLUDES a judged-relevant candidate the guard flagged echo', () => {
    const query = q('q1', [cand('a', { d: 1 }, 'echo'), cand('b', { d: 2 })]);
    const qrels: Qrels = { q1: { a: 1, b: 1 } };
    expect([...eligibleRelevantIds(query, qrels)]).toEqual(['b']);
  });

  it('ignores grade-0 (not-relevant) entries', () => {
    const query = q('q1', [cand('a', { d: 1 }), cand('b', { d: 2 })]);
    const qrels: Qrels = { q1: { a: 1, b: 0 } };
    expect([...eligibleRelevantIds(query, qrels)]).toEqual(['a']);
  });
});

describe('rankedIds', () => {
  it('orders by ascending rank, ties broken by corpus id', () => {
    const cands = [
      cand('c', { d: 2 }),
      cand('a', { d: 1 }),
      cand('b', { d: 1 }),
      cand('z', { d: null }),
    ];
    // rank1 tie a,b → id order; then c; z has no rank → dropped.
    expect(rankedIds(cands, 'd')).toEqual(['a', 'b', 'c']);
  });

  it('drops candidates the arm did not surface (undefined or null rank)', () => {
    const cands = [cand('a', { d: 1 }), cand('b', {}), cand('c', { d: null })];
    expect(rankedIds(cands, 'd')).toEqual(['a']);
  });
});

describe('scoreArm', () => {
  it('recall@K counts eligible relevant in the arm top-K', () => {
    const queries = [q('q1', [cand('a', { d: 1 }), cand('b', { d: 2 }), cand('c', { d: 3 })])];
    const qrels: Qrels = { q1: { a: 1, c: 1 } }; // 2 relevant
    expect(scoreArm(queries, qrels, 'd', 2).recallAtK).toBe(0.5); // top-2 [a,b] → 1 of 2
    expect(scoreArm(queries, qrels, 'd', 3).recallAtK).toBe(1); // top-3 → both
  });

  it('MRR is the reciprocal rank of the first eligible relevant', () => {
    const queries = [q('q1', [cand('a', { d: 1 }), cand('b', { d: 2 }), cand('c', { d: 3 })])];
    expect(scoreArm(queries, { q1: { b: 1 } }, 'd', 10).mrr).toBe(0.5);
  });

  it('missRate flags turns where the arm surfaced no eligible relevant in top-K', () => {
    const queries = [
      q('q1', [cand('a', { d: 1 }), cand('rel', { d: 2 })]), // rel at position 2
      q('q2', [cand('rel2', { d: 1 }), cand('x', { d: 2 })]), // rel2 at position 1
    ];
    const qrels: Qrels = { q1: { rel: 1 }, q2: { rel2: 1 } };
    const m = scoreArm(queries, qrels, 'd', 1); // top-1: q1 misses rel, q2 hits rel2
    expect(m.missRate).toBe(0.5);
    expect(m.scoredQueries).toBe(2);
  });

  it('the guard mask denies credit for an in-window relevant even at rank 1', () => {
    // 'a' is judged relevant AND ranked #1, but it's in-window → not eligible → miss.
    const queries = [q('q1', [cand('a', { d: 1 }, 'in-window')])];
    const m = scoreArm(queries, { q1: { a: 1 } }, 'd', 10);
    // no eligible relevant at all → query is not scored (can't distinguish arms).
    expect(m.scoredQueries).toBe(0);
    expect(m.recallAtK).toBe(0);
  });

  it('excludes queries with no eligible relevant from the denominator', () => {
    const queries = [
      q('q1', [cand('a', { d: 1 })]),
      q('q2', [cand('b', { d: 1 }, 'in-window')]), // only relevant is guard-masked
    ];
    const qrels: Qrels = { q1: { a: 1 }, q2: { b: 1 } };
    const m = scoreArm(queries, qrels, 'd', 10);
    expect(m.scoredQueries).toBe(1);
    expect(m.recallAtK).toBe(1);
  });

  it('an arm that never surfaced the relevant doc scores zero, not NaN', () => {
    const queries = [q('q1', [cand('a', { dense: 1 }), cand('rel', { fts: 1 })])];
    const qrels: Qrels = { q1: { rel: 1 } };
    expect(scoreArm(queries, qrels, 'dense', 10).recallAtK).toBe(0);
    expect(scoreArm(queries, qrels, 'dense', 10).mrr).toBe(0);
    expect(scoreArm(queries, qrels, 'fts', 10).recallAtK).toBe(1);
  });
});

describe('scoreArms', () => {
  it('scores each named arm against one qrels set', () => {
    const queries = [q('q1', [cand('a', { 'bare-dense': 1, 'fold3-dense': 2 })])];
    const result = scoreArms(queries, { q1: { a: 1 } }, ['bare-dense', 'fold3-dense'], 10);
    expect(result['bare-dense'].recallAtK).toBe(1);
    expect(result['fold3-dense'].recallAtK).toBe(1);
  });
});

describe('pairedFlips (McNemar discordant pairs)', () => {
  it('classifies each turn into both-hit / both-miss / fix / break', () => {
    // k=1 throughout: a "hit" means the relevant doc is at POSITION 1 in the arm.
    const queries = [
      // q1: rel is position 1 in both arms → bothHit
      q('q1', [cand('rel', { bare: 1, fold: 1 })]),
      // q2: bare puts filler first (miss), fold puts rel first (hit) → treatmentFixes
      q('q2', [cand('rel', { bare: 2, fold: 1 }), cand('x', { bare: 1, fold: 2 })]),
      // q3: bare puts rel first (hit), fold puts filler first (miss) → treatmentBreaks
      q('q3', [cand('rel', { bare: 1, fold: 2 }), cand('y', { bare: 2, fold: 1 })]),
      // q4: filler is position 1 in both arms, rel is position 2 → bothMiss
      q('q4', [cand('rel', { bare: 2, fold: 2 }), cand('z', { bare: 1, fold: 1 })]),
    ];
    const qrels: Qrels = { q1: { rel: 1 }, q2: { rel: 1 }, q3: { rel: 1 }, q4: { rel: 1 } };
    const flips = pairedFlips(queries, qrels, 'bare', 'fold', 1);
    expect(flips.bothHit).toBe(1);
    expect(flips.treatmentFixes).toBe(1);
    expect(flips.treatmentBreaks).toBe(1);
    expect(flips.bothMiss).toBe(1);
    expect(flips.net).toBe(0); // 1 fix − 1 break
    expect(flips.scoredQueries).toBe(4);
  });

  it('net is positive when the treatment fixes more than it breaks', () => {
    const queries = [
      q('q1', [cand('rel', { bare: 2, fold: 1 }), cand('o', { bare: 1, fold: 2 })]), // fix
      q('q2', [cand('rel', { bare: 2, fold: 1 }), cand('o', { bare: 1, fold: 2 })]), // fix
      q('q3', [cand('rel', { bare: 1, fold: 2 }), cand('o', { bare: 2, fold: 1 })]), // break
    ];
    const qrels: Qrels = { q1: { rel: 1 }, q2: { rel: 1 }, q3: { rel: 1 } };
    expect(pairedFlips(queries, qrels, 'bare', 'fold', 1).net).toBe(1);
  });

  it('excludes a query whose only relevant is guard-masked', () => {
    const queries = [
      q('q1', [cand('rel', { bare: 1, fold: 1 })]),
      q('q2', [cand('masked', { bare: 1, fold: 1 }, 'in-window')]), // only relevant is guard-masked → skipped
    ];
    const qrels: Qrels = { q1: { rel: 1 }, q2: { masked: 1 } };
    const f = pairedFlips(queries, qrels, 'bare', 'fold', 1);
    expect(f.scoredQueries).toBe(1);
    expect(f.bothHit).toBe(1);
  });
});

describe('combinedMissRate (both-arms-miss reproduction)', () => {
  it('counts turns where EVERY listed arm missed', () => {
    // k=1: a combined miss is a turn where the relevant doc is position-1 in NO listed arm.
    const queries = [
      // q1: dense puts rel first → dense hits → not a combined miss
      q('q1', [cand('rel', { dense: 1, fts: 2 }), cand('x', { dense: 2, fts: 1 })]),
      // q2: filler is position-1 in both arms → both miss → combined miss
      q('q2', [cand('rel', { dense: 2, fts: 2 }), cand('x', { dense: 1, fts: 1 })]),
    ];
    const qrels: Qrels = { q1: { rel: 1 }, q2: { rel: 1 } };
    const m = combinedMissRate(queries, qrels, ['dense', 'fts'], 1);
    expect(m.missedTurns).toBe(1);
    expect(m.scoredQueries).toBe(2);
    expect(m.rate).toBe(0.5);
  });

  it('excludes a query whose only relevant is guard-masked', () => {
    const queries = [
      q('q1', [cand('rel', { dense: 2, fts: 2 }), cand('x', { dense: 1, fts: 1 })]), // both miss
      q('q2', [cand('masked', { dense: 1, fts: 1 }, 'in-window')]), // guard-masked → skipped
    ];
    const qrels: Qrels = { q1: { rel: 1 }, q2: { masked: 1 } };
    const m = combinedMissRate(queries, qrels, ['dense', 'fts'], 1);
    expect(m.scoredQueries).toBe(1);
    expect(m.missedTurns).toBe(1);
  });

  it('throws on an empty arms list (every() is vacuously true → would count all as miss)', () => {
    const queries = [q('q1', [cand('rel', { dense: 1 })])];
    expect(() => combinedMissRate(queries, { q1: { rel: 1 } }, [], 1)).toThrow(
      /requires at least one arm/
    );
  });
});

describe('rrfRanks / withRrfArm', () => {
  it('fuses ranks so a doc found by BOTH arms outranks a doc found by one', () => {
    const cands = [
      cand('both', { dense: 3, fts: 3 }), // 1/(60+3)+1/(60+3) ≈ 0.0317
      cand('denseTop', { dense: 1 }), // 1/(60+1) ≈ 0.0164
    ];
    const fused = rrfRanks(cands, ['dense', 'fts']);
    expect(fused.get('both')).toBe(1);
    expect(fused.get('denseTop')).toBe(2);
  });

  it('withRrfArm makes the fused arm scoreable alongside the raw arms', () => {
    const query = q('q1', [cand('both', { dense: 3, fts: 3 }), cand('denseTop', { dense: 1 })]);
    const withRrf = withRrfArm(query, 'rrf', ['dense', 'fts']);
    // 'both' is rank-1 under RRF though it's rank-3 under dense alone.
    expect(scoreArm([withRrf], { q1: { both: 1 } }, 'rrf', 1).recallAtK).toBe(1);
    expect(scoreArm([withRrf], { q1: { both: 1 } }, 'dense', 1).recallAtK).toBe(0);
  });

  it('uses the standard RRF_K constant', () => {
    expect(RRF_K).toBe(60);
  });
});
