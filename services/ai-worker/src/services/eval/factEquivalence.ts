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

/** Cosine similarity floor for "these two statements express the same fact". */
export const FACT_EQUIVALENCE_THRESHOLD = 0.8;

/**
 * The only embedding capability the matcher uses.
 *
 * Narrower than `IEmbeddingService` on purpose: the memoizing wrapper below
 * (and any test fake) satisfies this without implementing the worker-lifecycle
 * methods the matcher never calls. `LocalEmbeddingService` satisfies it
 * structurally, so callers keep passing one unchanged.
 */
export interface EmbeddingSource {
  getEmbedding(text: string): Promise<Float32Array | undefined>;
}

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
  embeddings: EmbeddingSource,
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

export interface ExtractionScore {
  /** expectFacts entries matched by at least one extraction (drives recall). */
  matchedExpected: string[];
  /**
   * Extractions matching NEITHER expectFacts NOR allowedExtras — each is a
   * fabrication (unsupported by the source) or a transient/policy
   * over-extraction. The distinction is a human read during tuning; the
   * statements are surfaced verbatim for that purpose.
   */
  violations: string[];
  /** matched expectFacts / expectFacts (1 when none expected). */
  recall: number;
  /** violations / extracted (0 when nothing extracted). */
  violationRate: number;
  /** 1 − violationRate — kept for baseline comparability. */
  precision: number;
}

/**
 * Source-grounded extraction scoring (eval methodology v2).
 *
 * The v1 eval scored precision against `expectFacts` alone, so a CORRECT
 * extraction the golden author didn't enumerate counted as a hallucination —
 * inflating the rate with measurement artifacts. v2 splits the golden into
 * `expectFacts` (must-recall) and `allowedExtras` (source-supported, durable,
 * optional): recall is measured against expectFacts alone; a violation is an
 * extraction matching NEITHER list. Transient states the source supports but
 * that must not be extracted are deliberately left out of BOTH lists, so
 * over-extraction keeps counting against the extractor. Deterministic
 * (embedding cosine, same matcher) — the golden author enumerates support
 * instead of an LLM judge deciding at eval time.
 */
export async function scoreExtraction(
  extracted: string[],
  expectFacts: string[],
  allowedExtras: string[],
  embeddings: EmbeddingSource,
  threshold = FACT_EQUIVALENCE_THRESHOLD
): Promise<ExtractionScore> {
  // Both passes embed every `extracted` statement, and `expectFacts` appears in
  // both the recall list and the concatenated support list — so one memo shared
  // across the two calls roughly halves the real model's embedding work.
  const memo = memoizeEmbeddings(embeddings);

  const recallMatch = await matchFacts(extracted, expectFacts, memo, threshold);
  const supportMatch = await matchFacts(
    extracted,
    [...expectFacts, ...allowedExtras],
    memo,
    threshold
  );

  const violationRate =
    extracted.length === 0 ? 0 : supportMatch.unmatchedExtracted.length / extracted.length;

  return {
    matchedExpected: recallMatch.matchedExpected,
    violations: supportMatch.unmatchedExtracted,
    recall: recallMatch.recall,
    violationRate,
    precision: 1 - violationRate,
  };
}

/**
 * Wraps an embedding source so each unique statement is embedded exactly once.
 *
 * The cache holds the PROMISE rather than the resolved vector: the matcher
 * embeds a whole list with `Promise.all`, so two in-flight requests for the
 * same statement must share one call instead of both missing an
 * only-populated-on-resolve cache.
 *
 * Scoped to a single scoring call by construction (no module-level cache) —
 * an eval run over a large golden corpus would otherwise retain every
 * statement it ever scored, and statements rarely repeat across goldens.
 */
function memoizeEmbeddings(source: EmbeddingSource): EmbeddingSource {
  const inFlight = new Map<string, Promise<Float32Array | undefined>>();

  return {
    getEmbedding: async (text: string): Promise<Float32Array | undefined> => {
      const cached = inFlight.get(text);
      if (cached !== undefined) {
        return cached;
      }
      const pending = source.getEmbedding(text);
      inFlight.set(text, pending);
      return pending;
    },
  };
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
