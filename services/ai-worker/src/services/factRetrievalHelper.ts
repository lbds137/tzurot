/**
 * Generation-time fact-retrieval gate (Phase 2 slice 4a).
 *
 * Extracted from `ConversationalRAGService` so the flag/scope gate is a pure,
 * directly-testable function (and to keep the orchestrator under its line cap).
 */

import { createLogger } from '@tzurot/common-types/utils/logger';
import { getSystemSetting } from '@tzurot/common-types/services/SystemSettingsService';
import { TEXT_LIMITS } from '@tzurot/common-types/constants/discord';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { FactRetriever } from './FactRetriever.js';
import { FactStore } from './extraction/FactStore.js';
import type { PgvectorMemoryAdapter } from './PgvectorMemoryAdapter.js';
import type { FactForPrompt } from './ConversationalRAGTypes.js';
import type { MemoryRetriever, MemoryRetrievalResult } from './MemoryRetriever.js';
import type { DiagnosticCollector } from './DiagnosticCollector.js';

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
 * a retriever is wired, the runtime `factsInPromptEnabled` setting is on, and
 * a `personaId` resolved (undefined = LTM was skipped this turn → facts skipped
 * too). When `shareLtmAcrossPersonalities` is on, the personality filter drops
 * — facts follow the same widening as episode retrieval (owner call: the two
 * channels must not diverge under one flag). The retriever itself fails soft.
 */
export async function retrieveFactsForPrompt(
  factRetriever: FactRetriever | undefined,
  personalityId: string,
  personaId: string | undefined,
  searchQuery: string,
  shareLtmAcrossPersonalities: boolean
): Promise<FactForPrompt[]> {
  if (
    factRetriever === undefined ||
    personaId === undefined ||
    !getSystemSetting('factsInPromptEnabled')
  ) {
    return [];
  }
  const facts = await factRetriever.retrieveFacts(
    searchQuery,
    shareLtmAcrossPersonalities ? null : personalityId,
    personaId
  );
  if (facts.length > 0) {
    logger.info(
      { personalityId, factCount: facts.length, sharedScope: shareLtmAcrossPersonalities },
      'Facts retrieved for prompt injection'
    );
  }
  return facts;
}

/** Options for {@link retrieveMemoriesAndFacts} — the orchestrator's Step 3. */
export interface MemoriesAndFactsOptions {
  memoryRetriever: MemoryRetriever;
  factRetriever: FactRetriever | undefined;
  personality: Parameters<MemoryRetriever['retrieveRelevantMemories']>[0];
  searchQuery: string;
  context: Parameters<MemoryRetriever['retrieveRelevantMemories']>[2];
  configOverrides: Parameters<MemoryRetriever['retrieveRelevantMemories']>[3];
  diagnosticCollector?: DiagnosticCollector;
}

/**
 * Retrieve episodic memories and distilled facts for one generation turn —
 * facts inherit the episode retriever's scope decisions via `personaId`
 * (see {@link retrieveFactsForPrompt} for the gate semantics).
 */
export async function retrieveMemoriesAndFacts(
  opts: MemoriesAndFactsOptions
): Promise<MemoryRetrievalResult & { facts: FactForPrompt[] }> {
  const { searchQuery } = opts;
  const qPreview = searchQuery.substring(0, TEXT_LIMITS.LOG_PREVIEW);
  const qTruncated = searchQuery.length > TEXT_LIMITS.LOG_PREVIEW;
  logger.info({ queryPreview: qPreview, truncated: qTruncated }, 'Memory search query');

  opts.diagnosticCollector?.markMemoryRetrievalStart();
  const retrieval = await opts.memoryRetriever.retrieveRelevantMemories(
    opts.personality,
    searchQuery,
    opts.context,
    opts.configOverrides
  );

  const facts = await retrieveFactsForPrompt(
    opts.factRetriever,
    opts.personality.id,
    retrieval.personaId,
    searchQuery,
    opts.configOverrides?.shareLtmAcrossPersonalities ?? false
  );

  return { ...retrieval, facts };
}
