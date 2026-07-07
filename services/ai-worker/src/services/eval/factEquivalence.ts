/**
 * Fact-equivalence comparator for the extraction eval (memory Phase 2 §3.9).
 *
 * Extracted facts are paraphrases, not verbatim copies — substring containment
 * (the retrieval eval's shortcut) breaks immediately. Equivalence here is
 * embedding cosine similarity over the REAL local model (the same 384-dim
 * space production uses), thresholded. The threshold is a measurement
 * parameter, not a production constant: it only shapes how strictly the eval
 * scores a match.
 */

import type { LocalEmbeddingService } from '@tzurot/embeddings';

/** Cosine similarity floor for "these two statements express the same fact". */
export const FACT_EQUIVALENCE_THRESHOLD = 0.8;

export function cosineSimilarity(a: Float32Array | number[], b: Float32Array | number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface MatchResult {
  /** expected statements that were matched by at least one extracted fact */
  matchedExpected: string[];
  /** extracted statements that matched no expected fact (the hallucination set) */
  unmatchedExtracted: string[];
  precision: number;
  recall: number;
}

/**
 * Greedy embedding match between extracted and expected fact statements.
 * precision = matched extracted / extracted; recall = matched expected / expected.
 * Empty-extracted with empty-expected is a perfect score (the "no durable
 * facts" golden); empty-extracted with non-empty expected is recall 0.
 */
export async function matchFacts(
  extracted: string[],
  expected: string[],
  embeddings: LocalEmbeddingService,
  threshold = FACT_EQUIVALENCE_THRESHOLD
): Promise<MatchResult> {
  if (extracted.length === 0 && expected.length === 0) {
    return { matchedExpected: [], unmatchedExtracted: [], precision: 1, recall: 1 };
  }

  const embed = async (texts: string[]): Promise<(Float32Array | undefined)[]> =>
    Promise.all(texts.map(async t => embeddings.getEmbedding(t)));

  const extractedVecs = await embed(extracted);
  const expectedVecs = await embed(expected);

  const matchedExpected = new Set<string>();
  const unmatchedExtracted: string[] = [];

  for (let i = 0; i < extracted.length; i++) {
    const hits = matchesForVector(extractedVecs[i], expectedVecs, threshold);
    if (hits.length === 0) {
      unmatchedExtracted.push(extracted[i]);
    }
    for (const j of hits) {
      matchedExpected.add(expected[j]);
    }
  }

  const precision =
    extracted.length === 0 ? 1 : (extracted.length - unmatchedExtracted.length) / extracted.length;
  const recall = expected.length === 0 ? 1 : matchedExpected.size / expected.length;

  return { matchedExpected: [...matchedExpected], unmatchedExtracted, precision, recall };
}

/** Indexes of expected vectors the given vector matches at/above threshold. */
function matchesForVector(
  vec: Float32Array | undefined,
  expectedVecs: (Float32Array | undefined)[],
  threshold: number
): number[] {
  if (vec === undefined) {
    return [];
  }
  const hits: number[] = [];
  for (let j = 0; j < expectedVecs.length; j++) {
    const expVec = expectedVecs[j];
    if (expVec !== undefined && cosineSimilarity(vec, expVec) >= threshold) {
      hits.push(j);
    }
  }
  return hits;
}
