/**
 * Generation-time fact-retrieval gate (Phase 2 slice 4a).
 *
 * Extracted from `ConversationalRAGService` so the flag/scope gate is a pure,
 * directly-testable function (and to keep the orchestrator under its line cap).
 */

import { createLogger } from '@tzurot/common-types/utils/logger';
import { getConfig } from '@tzurot/common-types/config/config';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { FactRetriever } from './FactRetriever.js';
import { FactStore } from './extraction/FactStore.js';
import type { PgvectorMemoryAdapter } from './PgvectorMemoryAdapter.js';
import type { FactForPrompt } from './ConversationalRAGTypes.js';

const logger = createLogger('FactRetrieval');

/**
 * Build the generation-side fact retriever, reusing the adapter's shared
 * embedder. Undefined when there's no memory manager (facts need embeddings).
 */
export function createFactRetriever(
  prisma: PrismaClient,
  memoryManager: PgvectorMemoryAdapter | undefined
): FactRetriever | undefined {
  if (memoryManager === undefined) {
    return undefined;
  }
  return new FactRetriever(new FactStore(prisma, memoryManager.getEmbeddingService()));
}

/**
 * Retrieve distilled facts for the prompt's `<facts>` block, scoped to
 * persona×personality (the private pool — Phase 2). Returns `[]` unless ALL of:
 * a retriever is wired, `FACTS_IN_PROMPT_ENABLED` is on (dev-on/prod-off), and
 * a `personaId` resolved (undefined = LTM was skipped this turn → facts skipped
 * too). The retriever itself fails soft on top of this.
 */
export async function retrieveFactsForPrompt(
  factRetriever: FactRetriever | undefined,
  personalityId: string,
  personaId: string | undefined,
  searchQuery: string
): Promise<FactForPrompt[]> {
  if (
    factRetriever === undefined ||
    personaId === undefined ||
    getConfig().FACTS_IN_PROMPT_ENABLED !== 'true'
  ) {
    return [];
  }
  const facts = await factRetriever.retrieveFacts(searchQuery, personalityId, personaId);
  if (facts.length > 0) {
    logger.info({ personalityId, factCount: facts.length }, 'Facts retrieved for prompt injection');
  }
  return facts;
}
