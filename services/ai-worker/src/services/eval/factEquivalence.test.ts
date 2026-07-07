import { describe, it, expect, vi } from 'vitest';
import type { LocalEmbeddingService } from '@tzurot/embeddings';
import { cosineSimilarity, matchFacts } from './factEquivalence.js';

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
