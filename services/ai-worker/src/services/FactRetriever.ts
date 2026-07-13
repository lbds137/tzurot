/**
 * Generation-time fact retrieval (memory-architecture Phase 2, slice 4a).
 *
 * Mirrors `MemoryRetriever` but for extracted atomic FACTS: given the search
 * query, returns the top-K active facts scoped to the current
 * persona×personality (the private pool — community/canon pool blending is
 * Phase 3), for injection into the prompt's `<facts>` block.
 *
 * Reuses `FactStore.findSimilarActiveFacts` (active-only: superseded/forgotten
 * facts are filtered in SQL) with its recency/salience tiebreak, so a
 * stale-but-similar fact can't outrank a recent correction.
 *
 * **Config-free by design**: the runtime `factsInPromptEnabled` gate lives at
 * the caller (`ConversationalRAGService`), so this stays a pure retrieval unit.
 *
 * **Fail-soft**: facts are additive context, never load-bearing — any error
 * (embedding not ready, query failure) returns `[]` rather than breaking
 * generation, matching the rest of the memory pipeline's degrade-don't-crash
 * posture.
 */

import { createLogger } from '@tzurot/common-types/utils/logger';
import type { FactStore, SimilarFact } from './extraction/FactStore.js';

const logger = createLogger('FactRetriever');

/** Top-K active facts to fetch before the reserved fact sub-budget truncates. */
export const FACT_RETRIEVAL_LIMIT = 10;

export class FactRetriever {
  constructor(private readonly factStore: FactStore) {}

  /**
   * Top active facts most similar to `query`, scoped to persona×personality.
   * Returns `[]` on any failure (fail-soft). `personaId` null = world/canon
   * facts (no persona). `personalityId` null = all of the persona's
   * personalities (the shareLtmAcrossPersonalities widening).
   */
  async retrieveFacts(
    query: string,
    personalityId: string | null,
    personaId: string | null,
    limit: number = FACT_RETRIEVAL_LIMIT
  ): Promise<SimilarFact[]> {
    try {
      const embedding = await this.factStore.embedStatement(query);
      return await this.factStore.findSimilarActiveFacts(
        embedding,
        personalityId,
        personaId,
        limit
      );
    } catch (error) {
      logger.warn(
        { err: error, personalityId },
        'Fact retrieval failed — returning no facts (generation degrades gracefully)'
      );
      return [];
    }
  }
}
