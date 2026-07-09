import { describe, it, expect, vi } from 'vitest';
import type { LocalEmbeddingService } from '@tzurot/embeddings';
import { cosineSimilarity, matchFacts, scoreExtraction } from './factEquivalence.js';

/** Deterministic fake embedder: known strings map to fixed orthogonal-ish vectors. */
function makeEmbeddings(vectors: Record<string, number[]>): LocalEmbeddingService {
  return {
    getEmbedding: vi.fn(async (text: string) => {
      const v = vectors[text];
      return v === undefined ? undefined : Float32Array.from(v);
    }),
  } as unknown as LocalEmbeddingService;
}

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors, 0 for orthogonal, 0 for zero vectors', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
  });
});

describe('matchFacts', () => {
  const vectors = {
    'Alice has a cat named Miso': [1, 0, 0],
    "Alice's cat is called Miso": [0.95, 0.05, 0], // paraphrase — high similarity
    'Bob works as a baker': [0, 1, 0],
    'The moon is made of cheese': [0, 0, 1], // hallucination — matches nothing
  };

  it('matches paraphrases above the threshold (precision + recall 1)', async () => {
    const result = await matchFacts(
      ["Alice's cat is called Miso"],
      ['Alice has a cat named Miso'],
      makeEmbeddings(vectors),
      0.8
    );
    expect(result.precision).toBe(1);
    expect(result.recall).toBe(1);
  });

  it('counts unmatched extractions as hallucinations (precision < 1)', async () => {
    const result = await matchFacts(
      ["Alice's cat is called Miso", 'The moon is made of cheese'],
      ['Alice has a cat named Miso'],
      makeEmbeddings(vectors),
      0.8
    );
    expect(result.precision).toBeCloseTo(0.5);
    expect(result.unmatchedExtracted).toEqual(['The moon is made of cheese']);
  });

  it('counts missed expectations as recall loss', async () => {
    const result = await matchFacts(
      ["Alice's cat is called Miso"],
      ['Alice has a cat named Miso', 'Bob works as a baker'],
      makeEmbeddings(vectors),
      0.8
    );
    expect(result.recall).toBeCloseTo(0.5);
  });

  it('scores the nothing-durable golden perfectly when nothing is extracted', async () => {
    const result = await matchFacts([], [], makeEmbeddings(vectors));
    expect(result.precision).toBe(1);
    expect(result.recall).toBe(1);
  });

  it('extracting nothing when facts were expected is recall 0, precision 1', async () => {
    const result = await matchFacts([], ['Bob works as a baker'], makeEmbeddings(vectors));
    expect(result.precision).toBe(1);
    expect(result.recall).toBe(0);
  });
});

describe('scoreExtraction (source-grounded, methodology v2)', () => {
  const vectors = {
    'Alice has a cat named Miso': [1, 0, 0, 0],
    "Alice's cat is called Miso": [0.95, 0.05, 0, 0], // paraphrase of expectFact
    'Alice works long shifts': [0, 1, 0, 0], // in allowedExtras
    'The user works long, exhausting shifts': [0, 0.97, 0.03, 0], // paraphrase of allowedExtra
    'The moon is made of cheese': [0, 0, 1, 0], // fabrication — supported by nothing
    'Alice slept badly last night': [0, 0, 0, 1], // transient — deliberately in NO list
  };

  const EXPECT = ['Alice has a cat named Miso'];
  const ALLOWED = ['Alice works long shifts'];

  it('a correct-but-unlisted extraction matching allowedExtras is NOT a violation (the v1 artifact, fixed)', async () => {
    const score = await scoreExtraction(
      ["Alice's cat is called Miso", 'The user works long, exhausting shifts'],
      EXPECT,
      ALLOWED,
      makeEmbeddings(vectors),
      0.8
    );
    expect(score.violations).toEqual([]);
    expect(score.violationRate).toBe(0);
    expect(score.recall).toBe(1);
  });

  it('recall is measured against expectFacts ALONE — allowedExtras do not satisfy it', async () => {
    // Only the allowed extra extracted; the must-recall fact missed.
    const score = await scoreExtraction(
      ['The user works long, exhausting shifts'],
      EXPECT,
      ALLOWED,
      makeEmbeddings(vectors),
      0.8
    );
    expect(score.recall).toBe(0);
    expect(score.violationRate).toBe(0); // supported, so not a violation
  });

  it('a transient over-extraction (in neither list) IS a violation', async () => {
    const score = await scoreExtraction(
      ["Alice's cat is called Miso", 'Alice slept badly last night'],
      EXPECT,
      ALLOWED,
      makeEmbeddings(vectors),
      0.8
    );
    expect(score.violations).toEqual(['Alice slept badly last night']);
    expect(score.violationRate).toBeCloseTo(0.5);
    expect(score.precision).toBeCloseTo(0.5);
  });

  it('a fabrication IS a violation', async () => {
    const score = await scoreExtraction(
      ['The moon is made of cheese'],
      EXPECT,
      ALLOWED,
      makeEmbeddings(vectors),
      0.8
    );
    expect(score.violations).toEqual(['The moon is made of cheese']);
    expect(score.recall).toBe(0);
  });

  it('nothing extracted → zero violationRate, recall per expectations', async () => {
    const score = await scoreExtraction([], EXPECT, ALLOWED, makeEmbeddings(vectors), 0.8);
    expect(score.violationRate).toBe(0);
    expect(score.precision).toBe(1);
    expect(score.recall).toBe(0);
  });
});
