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
 * Stamp every retrieved memory doc's `metadata.archiveRender` for the
 * memory-archive split render (A3/A4) — mutates `memories` in place, matching
 * how the rest of this pipeline threads metadata through the shared doc
 * objects. A no-op (never writes the field) unless the personality's slug is
 * listed in `archiveSplitRenderPersonalities` — absence of the field is what
 * the split renderer reads as verbatim mode, so this must never write a
 * default when the switch is off.
 */
// @spec MEM-ARCH-010 — kill-switch read: per turn, by personality slug
async function stampArchiveRenderMode(
  memories: MemoryRetrievalResult['memories'],
  personalitySlug: string,
  personalityId: string,
  factRetriever: FactRetriever | undefined
): Promise<void> {
  if (!getSystemSetting('archiveSplitRenderPersonalities').includes(personalitySlug)) {
    return;
  }
  const memoryIds = memories
    .map(doc => doc.metadata?.id)
    .filter((id): id is string => typeof id === 'string');
  const linkedFacts =
    factRetriever === undefined
      ? []
      : await factRetriever.retrieveLinkedFacts(memoryIds, personalityId);

  // A fact linked to several retrieved memories is attributed to the most
  // relevant one only — duplicating it across notes would spend budget twice
  // on the same statement. `memories` is already in retrieval-relevance
  // order, so the first memory (in that order) whose sourceMemoryIds contains
  // the fact wins it.
  const assignedFactIds = new Set<string>();
  const factsByMemoryId = new Map<string, { id: string; statement: string; salience: number }[]>();
  for (const doc of memories) {
    const docId = doc.metadata?.id;
    if (typeof docId !== 'string') {
      continue;
    }
    const docFacts: { id: string; statement: string; salience: number }[] = [];
    for (const fact of linkedFacts) {
      if (assignedFactIds.has(fact.id) || !fact.sourceMemoryIds.includes(docId)) {
        continue;
      }
      assignedFactIds.add(fact.id);
      docFacts.push({ id: fact.id, statement: fact.statement, salience: fact.salience });
    }
    factsByMemoryId.set(docId, docFacts);
  }

  for (const doc of memories) {
    const docId = doc.metadata?.id;
    const docFacts = typeof docId === 'string' ? (factsByMemoryId.get(docId) ?? []) : [];
    doc.metadata = { ...doc.metadata, archiveRender: { mode: 'split', linkedFacts: docFacts } };
  }
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

  await stampArchiveRenderMode(
    retrieval.memories,
    opts.personality.slug,
    opts.personality.id,
    opts.factRetriever
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
