/**
 * Generation-time fact retrieval (memory-architecture Phase 2, slice 4a).
 *
 * Mirrors `MemoryRetriever` but for extracted atomic FACTS: given the search
 * query, returns the top-K active facts scoped to the current
 * persona×personality (the private pool — community/canon pool blending is
 * Phase 3), for injection into the prompt's `<facts>` block — with up to
 * `RESERVED_FACT_SLOTS` of those slots held for reserved-class facts that
 * render regardless of similarity (see `retrieveFacts`).
 *
 * Reuses `FactStore.findSimilarActiveFacts` (active-only: superseded/forgotten
 * facts are filtered in SQL) with its recency/salience tiebreak, so a
 * stale-but-similar fact can't outrank a recent correction.
 *
 * **Config-free by design**: the runtime `factsInPromptEnabled` gate lives at
 * the caller (`ConversationalRAGService`), so this stays a pure retrieval unit.
 *
 * **Fail-soft, independently for each query**: the reserved query is started
 * immediately, before the embedding call, and is never gated on the
 * embedding/similarity path succeeding — an embedding or similarity failure
 * still lets locked/corrected-tier/commitment:address facts render, falling
 * back to the reserved facts alone. A RESERVED-query failure degrades only
 * that query, to zero reserved facts — it must never zero out the
 * similarity list, since the similarity path is the primary retrieval and
 * the reserved path is a secondary, optional enhancement of it. Only a
 * failure of BOTH paths returns `[]`. See `FactRetriever.test.ts`'s
 * "reserved-fact merge" describe: "an embedding failure still yields the
 * reserved facts (independent degrade)", "a rejecting similarity query
 * still yields the reserved facts (independent degrade)", "a rejecting
 * reserved query yields the similarity list intact (independent degrade)",
 * and the two "returns [] when both ... fail" cases.
 */

import { createLogger } from '@tzurot/common-types/utils/logger';
import type { FactStore, SimilarFact, LinkedFact } from './extraction/FactStore.js';

const logger = createLogger('FactRetriever');

/** Top-K active facts to fetch before the fact token sub-budget truncates.
 *  (`factBudget.ts`'s "reserved" is that TOKEN budget — not the SLOTS below.) */
export const FACT_RETRIEVAL_LIMIT = 10;

/**
 * Of the `FACT_RETRIEVAL_LIMIT` slots, up to this many are reserved for facts
 * that must render regardless of similarity to the current message (locked /
 * corrected-tier / commitment:address) — see `FactStore.findReservedActiveFacts`.
 */
export const RESERVED_FACT_SLOTS = 3;

export class FactRetriever {
  constructor(private readonly factStore: FactStore) {}

  /**
   * Top active facts most similar to `query`, scoped to persona×personality,
   * merged with up to `RESERVED_FACT_SLOTS` reserved-class facts that must
   * render regardless of similarity. Reserved facts are placed FIRST in the
   * merged list — `factBudget.ts`'s `selectFacts` is greedy in list order, so
   * reserved-first is what makes them survive the token budget. Deduplicated
   * by fact id (first occurrence — i.e. the reserved slot — wins), then
   * truncated to `limit`. `personaId` null = world/canon facts (no persona).
   * `personalityId` null = all of the persona's personalities (the
   * shareLtmAcrossPersonalities widening).
   *
   * The embedding/similarity path and the reserved path degrade
   * INDEPENDENTLY: the reserved query starts immediately and is never gated
   * on the embedding/similarity path, so an embedding or similarity failure
   * still yields the reserved facts (marked `reserved: true`, truncated to
   * `limit`) instead of `[]`; a reserved-query failure degrades to zero
   * reserved facts while the similarity list still renders — the reserved
   * query is a secondary enhancement of the primary similarity path, so its
   * failure must never zero out that primary result. Only a failure of BOTH
   * paths returns `[]`. Pinned by "an embedding failure still yields the
   * reserved facts (independent degrade)", "a rejecting similarity query
   * still yields the reserved facts (independent degrade)", "a rejecting
   * reserved query yields the similarity list intact (independent degrade)",
   * and the two "returns [] when both ... fail" cases in
   * FactRetriever.test.ts.
   */
  async retrieveFacts(
    query: string,
    personalityId: string | null,
    personaId: string | null,
    limit: number = FACT_RETRIEVAL_LIMIT
  ): Promise<SimilarFact[]> {
    // Started immediately so it overlaps with both the embedding call below
    // and the similarity query after it — the reserved query must never wait
    // on the embedding/similarity path succeeding. Its rejection is handled
    // right here (not left to propagate) so an embedding-failure early
    // return can safely `await` it without risking an unhandled rejection.
    const reservedFactsPromise = this.factStore
      .findReservedActiveFacts(personalityId, personaId, Math.min(RESERVED_FACT_SLOTS, limit))
      .catch((error: unknown): SimilarFact[] => {
        logger.warn(
          { err: error, personalityId },
          'Reserved-fact query failed — rendering without reserved facts'
        );
        return [];
      });

    let embedding: number[];
    try {
      embedding = await this.factStore.embedStatement(query);
    } catch (error) {
      logger.warn(
        { err: error, personalityId },
        'Embedding failed — similarity facts unavailable; rendering reserved facts only'
      );
      return mergeReservedFirst(await reservedFactsPromise, [], limit);
    }

    let similarFacts: SimilarFact[];
    try {
      similarFacts = await this.factStore.findSimilarActiveFacts(
        embedding,
        personalityId,
        personaId,
        limit
      );
    } catch (error) {
      logger.warn(
        { err: error, personalityId },
        'Similarity query failed — rendering reserved facts only'
      );
      return mergeReservedFirst(await reservedFactsPromise, [], limit);
    }

    return mergeReservedFirst(await reservedFactsPromise, similarFacts, limit);
  }

  /**
   * Active facts linked to any of `memoryIds` (memory-archive split render,
   * A3) — ONE query regardless of how many memories are being rendered.
   * Fail-soft like {@link retrieveFacts}: a query failure degrades to no
   * facts, never to falling back out of split mode (D2's spirit — the switch
   * being on means assistant prose does not come back because a query failed).
   */
  async retrieveLinkedFacts(memoryIds: string[], personalityId: string): Promise<LinkedFact[]> {
    if (memoryIds.length === 0) {
      return [];
    }
    try {
      return await this.factStore.findActiveFactsBySourceMemoryIds(memoryIds, personalityId);
    } catch (error) {
      logger.warn(
        { err: error, personalityId },
        'Linked-facts retrieval failed — split render proceeds with no facts'
      );
      return [];
    }
  }
}

/**
 * Merge reserved-class facts (rendered regardless of similarity) ahead of the
 * similarity-ranked facts, de-duplicated by id (first occurrence — the
 * reserved slot — wins), truncated to `limit`. When `reservedFacts` is empty
 * this returns `similarFacts` unchanged (same array reference, same order,
 * same length) — the caller's default arm.
 */
function mergeReservedFirst(
  reservedFacts: SimilarFact[],
  similarFacts: SimilarFact[],
  limit: number
): SimilarFact[] {
  if (reservedFacts.length === 0) {
    return similarFacts;
  }
  const merged: SimilarFact[] = [];
  const seenIds = new Set<string>();
  for (const fact of reservedFacts) {
    if (seenIds.has(fact.id)) {
      continue;
    }
    seenIds.add(fact.id);
    merged.push({ ...fact, reserved: true });
  }
  for (const fact of similarFacts) {
    if (seenIds.has(fact.id)) {
      continue;
    }
    seenIds.add(fact.id);
    merged.push(fact);
  }
  return merged.slice(0, limit);
}
