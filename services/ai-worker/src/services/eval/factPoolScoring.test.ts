import { describe, it, expect } from 'vitest';
import {
  FACT_RECENCY_HALF_LIFE_DAYS,
  FACT_WEIGHT_GRID,
  compositePolicy,
  policyRanks,
  prodOrderingComparator,
  recencyDecay,
  repetitionOverlap,
  tierRankLift,
  tierWeight,
  withPolicyArm,
  type FactGoldenPool,
  type FactPooledCandidate,
} from './factPoolScoring.js';
import { reconcile } from './qrelsReconciliation.js';
import { scoreArm } from './poolScoring.js';

const NOW = 1_800_000_000_000;
const DAY_MS = 86_400_000;

function makeCandidate(overrides: Partial<FactPooledCandidate> = {}): FactPooledCandidate {
  return {
    corpusId: 'fact-aaaa',
    createdAtMs: NOW,
    contentPreview: 'a statement',
    ranks: {},
    verdict: 'eligible',
    similarity: 0.8,
    salience: 0.5,
    tier: 'observed',
    entityTags: [],
    ...overrides,
  };
}

function makePool(
  candidates: FactPooledCandidate[],
  overrides: Partial<FactGoldenPool> = {}
): FactGoldenPool {
  return {
    goldenId: 'golden-1111',
    message: 'what do you remember?',
    style: 'reactive',
    oldestHistoryMs: NOW - DAY_MS,
    arms: ['prod'],
    candidates,
    channelId: 'channel-1',
    searchQuery: 'what do you remember?',
    folded: false,
    ...overrides,
  };
}

describe('recencyDecay', () => {
  it('is 1 at age zero and 0.5 at exactly one half-life', () => {
    expect(recencyDecay(NOW, NOW)).toBe(1);
    expect(recencyDecay(NOW - FACT_RECENCY_HALF_LIFE_DAYS * DAY_MS, NOW)).toBeCloseTo(0.5, 10);
  });

  it('clamps future validFrom (negative age) to 1 instead of amplifying', () => {
    expect(recencyDecay(NOW + 5 * DAY_MS, NOW)).toBe(1);
  });

  it('keeps decaying monotonically past multiple half-lives', () => {
    const oneHalfLife = recencyDecay(NOW - FACT_RECENCY_HALF_LIFE_DAYS * DAY_MS, NOW);
    const twoHalfLives = recencyDecay(NOW - 2 * FACT_RECENCY_HALF_LIFE_DAYS * DAY_MS, NOW);
    expect(twoHalfLives).toBeCloseTo(oneHalfLife / 2, 10);
  });
});

describe('tierWeight', () => {
  it('orders corrected > inferred > observed, and defaults unknown tiers to observed weight', () => {
    expect(tierWeight('corrected')).toBe(1);
    expect(tierWeight('inferred')).toBe(0.6);
    expect(tierWeight('observed')).toBe(0.5);
    expect(tierWeight('mystery-future-tier')).toBe(0.5);
  });
});

describe('compositePolicy', () => {
  it('computes the weighted sum of the four components', () => {
    const policy = compositePolicy({ name: 't', wSim: 0.5, wSal: 0.2, wRec: 0.2, wTier: 0.1 }, NOW);
    const candidate = makeCandidate({
      similarity: 0.8,
      salience: 0.5,
      createdAtMs: NOW, // recency term = 1
      tier: 'corrected', // tier term = 1
    });
    expect(policy(candidate)).toBeCloseTo(0.5 * 0.8 + 0.2 * 0.5 + 0.2 * 1 + 0.1 * 1, 10);
  });

  it('every pre-registered grid vector sums to 1 (scores comparable across vectors)', () => {
    for (const weights of FACT_WEIGHT_GRID) {
      expect(weights.wSim + weights.wSal + weights.wRec + weights.wTier).toBeCloseTo(1, 10);
    }
  });
});

describe('prodOrderingComparator', () => {
  it('sorts by similarity desc, then validFrom desc, then salience desc, then id', () => {
    const bySim = [
      makeCandidate({ corpusId: 'a', similarity: 0.5 }),
      makeCandidate({ corpusId: 'b', similarity: 0.9 }),
    ].sort(prodOrderingComparator);
    expect(bySim.map(c => c.corpusId)).toEqual(['b', 'a']);

    const byRecency = [
      makeCandidate({ corpusId: 'older', createdAtMs: NOW - DAY_MS }),
      makeCandidate({ corpusId: 'newer', createdAtMs: NOW }),
    ].sort(prodOrderingComparator);
    expect(byRecency.map(c => c.corpusId)).toEqual(['newer', 'older']);

    const bySalience = [
      makeCandidate({ corpusId: 'low', salience: 0.2 }),
      makeCandidate({ corpusId: 'high', salience: 0.9 }),
    ].sort(prodOrderingComparator);
    expect(bySalience.map(c => c.corpusId)).toEqual(['high', 'low']);

    const byId = [makeCandidate({ corpusId: 'zz' }), makeCandidate({ corpusId: 'aa' })].sort(
      prodOrderingComparator
    );
    expect(byId.map(c => c.corpusId)).toEqual(['aa', 'zz']);
  });
});

describe('policyRanks / withPolicyArm', () => {
  it('assigns 1-based ranks by descending score with deterministic id tiebreak', () => {
    const candidates = [
      makeCandidate({ corpusId: 'low', similarity: 0.1 }),
      makeCandidate({ corpusId: 'high', similarity: 0.9 }),
      makeCandidate({ corpusId: 'also-high', similarity: 0.9 }),
    ];
    const ranks = policyRanks(candidates, c => c.similarity);
    expect(ranks.get('also-high')).toBe(1); // tie broken by id
    expect(ranks.get('high')).toBe(2);
    expect(ranks.get('low')).toBe(3);
  });

  it('adds the derived arm immutably and without duplicating arm names', () => {
    const pool = makePool([
      makeCandidate({ corpusId: 'a', similarity: 0.9 }),
      makeCandidate({ corpusId: 'b', similarity: 0.1 }),
    ]);
    const withArm = withPolicyArm(pool, 'balanced', c => c.similarity);
    expect(withArm.arms).toEqual(['prod', 'balanced']);
    expect(withArm.candidates[0].ranks.balanced).toBe(1);
    expect(withArm.candidates[1].ranks.balanced).toBe(2);
    // Original pool untouched
    expect(pool.candidates[0].ranks.balanced).toBeUndefined();
    // Re-adding the same arm does not duplicate the name
    expect(withPolicyArm(withArm, 'balanced', c => c.salience).arms).toEqual(['prod', 'balanced']);
  });
});

describe('repetitionOverlap', () => {
  it('measures Jaccard overlap of top-K sets across same-channel pairs only', () => {
    const shared = [
      makeCandidate({ corpusId: 'x', ranks: { prod: 1 } }),
      makeCandidate({ corpusId: 'y', ranks: { prod: 2 } }),
    ];
    const poolA = makePool(shared, { goldenId: 'g-a', channelId: 'chan-1' });
    const poolB = makePool(
      [
        makeCandidate({ corpusId: 'x', ranks: { prod: 1 } }),
        makeCandidate({ corpusId: 'z', ranks: { prod: 2 } }),
      ],
      { goldenId: 'g-b', channelId: 'chan-1' }
    );
    const otherChannel = makePool(shared, { goldenId: 'g-c', channelId: 'chan-2' });

    const overlap = repetitionOverlap([poolA, poolB, otherChannel], 'prod', 10);
    // Only the chan-1 pair counts: {x,y} vs {x,z} → 1/3
    expect(overlap.pairs).toBe(1);
    expect(overlap.meanJaccard).toBeCloseTo(1 / 3, 10);
  });

  it('respects K when building the top sets', () => {
    const poolA = makePool(
      [
        makeCandidate({ corpusId: 'x', ranks: { prod: 1 } }),
        makeCandidate({ corpusId: 'y', ranks: { prod: 11 } }), // outside K=10
      ],
      { goldenId: 'g-a' }
    );
    const poolB = makePool([makeCandidate({ corpusId: 'y', ranks: { prod: 1 } })], {
      goldenId: 'g-b',
    });
    const overlap = repetitionOverlap([poolA, poolB], 'prod', 10);
    // A's top-10 = {x}, B's = {y} → 0 overlap
    expect(overlap.pairs).toBe(1);
    expect(overlap.meanJaccard).toBe(0);
  });
});

describe('tierRankLift', () => {
  it('averages ranks of corrected-tier candidates only', () => {
    const pool = makePool([
      makeCandidate({ corpusId: 'c1', tier: 'corrected', ranks: { prod: 2 } }),
      makeCandidate({ corpusId: 'c2', tier: 'corrected', ranks: { prod: 6 } }),
      makeCandidate({ corpusId: 'o1', tier: 'observed', ranks: { prod: 1 } }),
      makeCandidate({ corpusId: 'c3', tier: 'corrected', ranks: {} }), // no rank in arm
    ]);
    const lift = tierRankLift([pool], 'prod');
    expect(lift.correctedCandidates).toBe(2);
    expect(lift.meanCorrectedRank).toBe(4);
  });
});

describe('compatibility with the shared pool instruments', () => {
  it('fact pools flow through reconcile() and scoreArm() unchanged', () => {
    const pool = withPolicyArm(
      makePool([
        makeCandidate({ corpusId: 'fact-relevant', similarity: 0.9 }),
        makeCandidate({ corpusId: 'fact-noise', similarity: 0.4 }),
        makeCandidate({ corpusId: 'fact-echoed', similarity: 0.95, verdict: 'echo' }),
      ]),
      'balanced',
      compositePolicy(FACT_WEIGHT_GRID[1], NOW)
    );

    const { queries, qrels } = reconcile([pool], {
      'golden-1': { 'fact-rel': 1, 'fact-ech': 1 },
    });
    const metrics = scoreArm(queries, qrels, 'balanced', 10);

    // The echoed candidate is judged relevant but guard-ineligible — only
    // fact-relevant counts, and the balanced arm surfaces it in top-10.
    expect(metrics.scoredQueries).toBe(1);
    expect(metrics.recallAtK).toBe(1);
    expect(metrics.missRate).toBe(0);
  });
});
