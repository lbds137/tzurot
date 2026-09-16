/**
 * Generation-time fact-retrieval gate (Phase 2 slice 4a).
 *
 * Extracted from `ConversationalRAGService` so the flag/scope gate is a pure,
 * directly-testable function (and to keep the orchestrator under its line cap).
 */

import { contentPreview } from '@tzurot/common-types/utils/logContentPreview';
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
import type { ArchiveSummaryTrigger } from './archiveSummary/ArchiveSummaryTrigger.js';

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
 * The returned facts carry their authoring personality, so a shared-scope
 * fact renders under its author's name rather than the responder's.
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
    const reservedFactCount = facts.filter(f => f.reserved === true).length;
    logger.info(
      {
        personalityId,
        factCount: facts.length,
        sharedScope: shareLtmAcrossPersonalities,
        reservedFactCount,
      },
      'Facts retrieved for prompt injection'
    );
  }
  // @spec MEM-ARCH-032 — narrow to FactForPrompt explicitly: the store's
  // retrieval-layer fields (entityTags/similarity/isLocked/tier/reserved) have
  // no consumer on the prompt path, and the declared return type said so long
  // before the code did.
  return facts.map(f => ({
    id: f.id,
    statement: f.statement,
    personalityId: f.personalityId,
    personalityName: f.personalityName,
  }));
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
  archiveSummaryTrigger?: ArchiveSummaryTrigger;
}

/** True when this doc carries a stored summary to render (D2's arm S). */
function docHasSummary(doc: MemoryRetrievalResult['memories'][number]): boolean {
  const summary = doc.metadata?.assistantSummary;
  return typeof summary === 'string' && summary.length > 0;
}

/**
 * D2's lazy fill: every retrieved non-chunk row whose summary is missing, failed, or
 * stale — including a `dead` row from an older prompt version — is (re)enqueued for
 * summarization. Fire-and-forget — this
 * rides the reply path and must never delay or fail it. Split mode only: a
 * verbatim-mode character's rows are never rendered as summaries, so summarizing
 * them would be spend with no reader (slice C's sweep covers pre-warm). The
 * trigger's own `archiveSummaryEnqueueEnabled` switch gates job creation.
 */
// @spec MEM-ARCH-022 — retrieval-time enqueue, never awaited
function enqueueSummaryRefreshes(
  memories: MemoryRetrievalResult['memories'],
  personalityId: string,
  trigger: ArchiveSummaryTrigger | undefined
): void {
  if (trigger === undefined) {
    return;
  }
  const memoryIds: string[] = [];
  for (const doc of memories) {
    const memoryId = doc.metadata?.id;
    if (doc.metadata?.summaryRefreshEligible !== true || typeof memoryId !== 'string') {
      continue;
    }
    memoryIds.push(memoryId);
    void trigger.enqueue({ memoryId, personalityId, reason: 'retrieval' }).catch(error => {
      logger.debug({ err: error, memoryId }, 'Archive-summary retrieval enqueue failed');
    });
  }
  if (memoryIds.length > 0) {
    // IDs and COUNTS only — never memory or summary text (00-critical.md § Logging).
    logger.info(
      { personalityId, refreshEnqueued: memoryIds.length, memoryIds },
      'Archive summary retrieval re-enqueue'
    );
  }
}

/**
 * Assign each linked fact to at most one memory doc — the most relevant one
 * (first in retrieval-relevance order) whose `sourceMemoryIds` contains it. A
 * summarized doc is skipped entirely (@spec MEM-ARCH-026): leaving its facts
 * unassigned lets the next relevant UNsummarized memory that links them claim
 * them, and otherwise they stay in the separate `<facts>` block. D10's dedup
 * keys on rendered ids only, so nothing is dropped twice.
 */
function assignLinkedFactsByMemory(
  memories: MemoryRetrievalResult['memories'],
  linkedFacts: { id: string; statement: string; salience: number; sourceMemoryIds: string[] }[]
): Map<string, { id: string; statement: string; salience: number }[]> {
  const assignedFactIds = new Set<string>();
  const factsByMemoryId = new Map<string, { id: string; statement: string; salience: number }[]>();
  for (const doc of memories) {
    const docId = doc.metadata?.id;
    if (typeof docId !== 'string' || docHasSummary(doc)) {
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
  return factsByMemoryId;
}

/**
 * True when `doc`'s stamped personality id differs from the responder's —
 * shared-LTM retrieval crossing a personality boundary. Id compare only,
 * never by name (`personalityName` is a display label, never a gate). A doc
 * with no stamped id renders as OWN: absence is not evidence the row was
 * authored elsewhere.
 */
// @spec MEM-ARCH-031 — foreign-doc detection: id compare, absent id reads as own
function isForeignDoc(
  doc: MemoryRetrievalResult['memories'][number],
  personalityId: string
): boolean {
  const docPersonalityId = doc.metadata?.personalityId;
  return typeof docPersonalityId === 'string' && docPersonalityId !== personalityId;
}

/**
 * Stamp one doc's `archiveRender` in place: split mode, linked facts already
 * assigned to OWN docs only (a foreign or summarized doc always renders
 * `linkedFacts: []`), and `foreign: true` on a cross-personality note — never
 * written as `false`.
 */
function stampOneDoc(
  doc: MemoryRetrievalResult['memories'][number],
  foreign: boolean,
  factsByMemoryId: Map<string, { id: string; statement: string; salience: number }[]>
): void {
  const docId = doc.metadata?.id;
  const summary = doc.metadata?.assistantSummary;
  const hasSummary = docHasSummary(doc);
  const docFacts =
    foreign || hasSummary || typeof docId !== 'string' ? [] : (factsByMemoryId.get(docId) ?? []);
  doc.metadata = {
    ...doc.metadata,
    archiveRender: {
      mode: 'split',
      linkedFacts: docFacts,
      ...(foreign ? { foreign: true as const } : {}),
      ...(hasSummary ? { assistantSummary: summary } : {}),
    },
  };
}

/**
 * Stamp every retrieved memory doc's `metadata.archiveRender` for the
 * memory-archive split render (A3/A4) — mutates `memories` in place, matching
 * how the rest of this pipeline threads metadata through the shared doc
 * objects.
 *
 * When the personality's slug is listed in `archiveSplitRenderPersonalities`,
 * every retrieved doc is stamped. When it is NOT listed, only docs authored
 * by a DIFFERENT personality (shared-LTM cross-personality retrieval) are
 * stamped — in split mode with `foreign: true` — independent of the
 * allowlist: a foreign note must never render as the responder's own
 * verbatim memory (MEM-ARCH-031). Absence of the field is still what the
 * split renderer reads as verbatim mode, so an own doc under an unlisted
 * slug is never touched.
 *
 * Facts are linked, and summary refreshes enqueued, for OWN docs only — a
 * foreign doc's facts and summary lifecycle belong to its authoring
 * personality, never to this one.
 */
// @spec MEM-ARCH-010 — kill-switch read: per turn, by personality slug
async function stampArchiveRenderMode(
  memories: MemoryRetrievalResult['memories'],
  personalitySlug: string,
  personalityId: string,
  factRetriever: FactRetriever | undefined,
  archiveSummaryTrigger: ArchiveSummaryTrigger | undefined
): Promise<void> {
  const listed = getSystemSetting('archiveSplitRenderPersonalities').includes(personalitySlug);
  // @spec MEM-ARCH-031 — an unlisted personality still stamps foreign notes
  const stampSet = listed ? memories : memories.filter(doc => isForeignDoc(doc, personalityId));
  if (stampSet.length === 0) {
    return;
  }

  const ownDocs = stampSet.filter(doc => !isForeignDoc(doc, personalityId));
  const ownMemoryIds = ownDocs
    .map(doc => doc.metadata?.id)
    .filter((id): id is string => typeof id === 'string');
  // @spec MEM-ARCH-031 — never link facts to, or query linked facts for, a foreign doc
  const linkedFacts =
    factRetriever === undefined
      ? []
      : await factRetriever.retrieveLinkedFacts(ownMemoryIds, personalityId);

  const factsByMemoryId = assignLinkedFactsByMemory(ownDocs, linkedFacts);

  for (const doc of stampSet) {
    stampOneDoc(doc, isForeignDoc(doc, personalityId), factsByMemoryId);
  }

  // @spec MEM-ARCH-031 — never enqueue a summary refresh for a foreign doc
  enqueueSummaryRefreshes(ownDocs, personalityId, archiveSummaryTrigger);
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
  logger.info(
    {
      queryPreview: contentPreview(searchQuery, TEXT_LIMITS.LOG_PREVIEW),
      queryLength: searchQuery.length,
      truncated: searchQuery.length > TEXT_LIMITS.LOG_PREVIEW,
    },
    'Memory search query'
  );

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
    opts.factRetriever,
    opts.archiveSummaryTrigger
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
