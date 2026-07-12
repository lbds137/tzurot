import { describe, it, expect } from 'vitest';
import { scoreArm, scoreAllArms, RRF_K, type ScoredQuery, type Qrels } from './poolScoring.js';

function q(queryId: string, candidates: ScoredQuery['candidates']): ScoredQuery {
  return { queryId, candidates };
}

describe('scoreArm', () => {
  it('recall@K counts relevant in the top-K of the arm ranking', () => {
    const queries = [
      q('q1', [
        { corpusId: 'a', denseRank: 1, ftsRank: null },
        { corpusId: 'b', denseRank: 2, ftsRank: null },
        { corpusId: 'c', denseRank: 3, ftsRank: null },
      ]),
    ];
    const qrels: Qrels = { q1: { a: 1, c: 1 } }; // 2 relevant
    // k=2 → top-2 is [a,b], one hit of two relevant → 0.5
    expect(scoreArm(queries, qrels, 'dense', 2).recallAtK).toBe(0.5);
    // k=3 → both a and c in → 1.0
    expect(scoreArm(queries, qrels, 'dense', 3).recallAtK).toBe(1);
  });

  it('MRR is the reciprocal rank of the FIRST relevant candidate', () => {
    const queries = [
      q('q1', [
        { corpusId: 'a', denseRank: 1, ftsRank: null }, // not relevant
        { corpusId: 'b', denseRank: 2, ftsRank: null }, // first relevant → 1/2
        { corpusId: 'c', denseRank: 3, ftsRank: null },
      ]),
    ];
    expect(scoreArm(queries, { q1: { b: 1 } }, 'dense', 10).mrr).toBe(0.5);
  });

  it('excludes queries with no relevant candidate from both means', () => {
    const queries = [
      q('q1', [{ corpusId: 'a', denseRank: 1, ftsRank: null }]),
      q('q2', [{ corpusId: 'b', denseRank: 1, ftsRank: null }]),
    ];
    const qrels: Qrels = { q1: { a: 1 } }; // q2 has nothing relevant
    const metrics = scoreArm(queries, qrels, 'dense', 10);
    expect(metrics.scoredQueries).toBe(1);
    expect(metrics.recallAtK).toBe(1); // only q1 counts, perfect
  });

  it('an arm that never surfaced the relevant doc scores zero, not NaN', () => {
    const queries = [
      q('q1', [
        { corpusId: 'a', denseRank: 1, ftsRank: null },
        { corpusId: 'rel', denseRank: null, ftsRank: 1 }, // only FTS found it
      ]),
    ];
    const qrels: Qrels = { q1: { rel: 1 } };
    const dense = scoreArm(queries, qrels, 'dense', 10);
    expect(dense.recallAtK).toBe(0);
    expect(dense.mrr).toBe(0);
    const fts = scoreArm(queries, qrels, 'fts', 10);
    expect(fts.recallAtK).toBe(1);
  });
});

describe('RRF fusion', () => {
  it('fuses ranks so a doc found by BOTH arms outranks a doc found by one', () => {
    const queries = [
      q('q1', [
        { corpusId: 'both', denseRank: 3, ftsRank: 3 }, // in both, mid rank
        { corpusId: 'denseTop', denseRank: 1, ftsRank: null }, // dense #1 only
      ]),
    ];
    // RRF('both') = 1/(60+3)+1/(60+3) ≈ 0.0317; RRF('denseTop') = 1/(60+1) ≈ 0.0164.
    // So 'both' ranks first under fusion — the whole point of hybrid.
    const qrels: Qrels = { q1: { both: 1 } };
    expect(scoreArm(queries, qrels, 'rrf', 1).recallAtK).toBe(1); // 'both' is rank-1 in RRF
    // Under dense alone, 'both' is rank 3 → not in top-1.
    expect(scoreArm(queries, qrels, 'dense', 1).recallAtK).toBe(0);
  });

  it('RRF surfaces a doc that only ONE arm found (union recall)', () => {
    const queries = [
      q('q1', [
        { corpusId: 'ftsOnly', denseRank: null, ftsRank: 1 },
        { corpusId: 'denseOnly', denseRank: 1, ftsRank: null },
      ]),
    ];
    const qrels: Qrels = { q1: { ftsOnly: 1 } };
    // dense alone can't see ftsOnly; RRF can.
    expect(scoreArm(queries, qrels, 'dense', 5).recallAtK).toBe(0);
    expect(scoreArm(queries, qrels, 'rrf', 5).recallAtK).toBe(1);
  });

  it('uses the standard RRF_K constant', () => {
    expect(RRF_K).toBe(60);
  });
});

describe('scoreAllArms', () => {
  it('returns all three arms scored against one qrels set', () => {
    const queries = [q('q1', [{ corpusId: 'a', denseRank: 1, ftsRank: 2 }])];
    const result = scoreAllArms(queries, { q1: { a: 1 } }, 10);
    expect(result.dense.recallAtK).toBe(1);
    expect(result.fts.recallAtK).toBe(1);
    expect(result.rrf.recallAtK).toBe(1);
  });
});
