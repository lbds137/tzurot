/**
 * FactExtractionService — the extraction worker's core flow (memory Phase 2 §3.2)
 *
 * One BullMQ job = one batch of episode ids for a (channel, personality)
 * window. The batch may span multiple personas (multi-user channels), so
 * episodes are grouped by personaId and each group gets its own scope-correct
 * extraction call.
 *
 * Failure posture is fail-to-skip at every stage: a budget denial, a
 * malformed model response, or an embedding error writes NOTHING for that
 * group and never throws upward in a way that would spuriously retry a
 * half-written batch — fact writes are per-fact transactional and
 * content-hash idempotent, so a BullMQ retry of a partially-completed job is
 * safe (already-written facts no-op on conflict).
 */

import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { HumanMessage } from '@langchain/core/messages';
import { getConfig } from '@tzurot/common-types/config/config';
import { AIProvider, ZAI_MODEL_PREFIX } from '@tzurot/common-types/constants/ai';
import { ApiErrorCategory } from '@tzurot/common-types/constants/error';
import { parseApiError } from '../../utils/apiErrorParser.js';
import type { FactExtractionJobData } from '@tzurot/common-types/types/jobs';
import {
  generateFactExtractionJobUuid,
  generateUsageLogUuid,
} from '@tzurot/common-types/utils/deterministicUuid';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { createChatModel } from '../ModelFactory.js';
import type { ExtractionBudget } from './ExtractionBudget.js';
import {
  isProtectedFromAutoSupersession,
  type FactStore,
  type FactForContext,
  type NewFact,
} from './FactStore.js';
import {
  buildExtractionPrompt,
  extractionResponseSchema,
  extractJsonPayload,
  type ExtractedFact,
} from './extractionPrompt.js';

const logger = createLogger('FactExtractionService');

/** Token budget for the injected supersession context (council: budget, not fixed K). */
const SUPERSESSION_CONTEXT_TOKEN_BUDGET = 1500;

/**
 * Cosine-similarity floor for the always-on supersession fallback. 384-dim
 * cosine is noisy, so the floor is high and paired with an entity-tag overlap
 * guard; eval-tuning may move it (goldens are the instrument).
 */
const SIMILARITY_SUPERSESSION_THRESHOLD = 0.88;

/** Model-call timeout — extraction is background work, generous is fine. */
const EXTRACTION_TIMEOUT_MS = 60_000;

interface EpisodeGroup {
  personaId: string;
  isFiction: boolean;
  /** Episode ids for THIS group only — fact provenance must not leak episodes
   * from other personas sharing the batch window. */
  ids: string[];
  texts: string[];
}

/** One extraction model call's outcome — content plus token usage for cost rows. */
export interface ExtractionModelResult {
  content: string;
  tokensIn: number;
  tokensOut: number;
  /** The provider the call ACTUALLY billed — carried into the usage row so an
   * injected invoker (eval harness, tests) can never mislabel provenance. */
  provider: AIProvider;
}

/**
 * The extraction provider is BUSY (rate limit, server error, timeout — any
 * transient shape). Extraction's response is DELAY, never downgrade: facts are
 * not time-sensitive, so unlike completions (which fall back to OpenRouter to
 * keep a waiting user responsive), the batch requeues until the provider
 * window recovers — extraction never bills a fallback provider. The worker
 * catches this and pauses the queue (owner directive: z.ai peak hours delay
 * extraction rather than costing OpenRouter money).
 */
export class ExtractionProviderBusyError extends Error {
  constructor(
    readonly category: string,
    cause: unknown,
    /**
     * Episode ids for the groups NOT yet completed when the provider went
     * busy (the busy group + all unprocessed groups). The worker shrinks the
     * requeued job's sourceMemoryIds to exactly these, so groups that already
     * succeeded are never re-run — re-running them would re-bill the model
     * call, re-consume budget, and write duplicate usage rows on every retry
     * of a sustained busy window.
     */
    readonly remainingMemoryIds: string[] = []
  ) {
    super(`Extraction provider busy (${category})`);
    this.name = 'ExtractionProviderBusyError';
    this.cause = cause;
  }
}

/**
 * Error categories that mean "provider busy — delay and retry", not "give up".
 *
 * QUOTA_EXCEEDED and CREDIT_EXHAUSTION are DELIBERATE divergences from
 * `PERMANENT_ERROR_CATEGORIES` (common-types error.ts), where both fail fast —
 * correct for completions, where a user is waiting and a drained key can't
 * serve them. Extraction is a background queue with the opposite trade-off:
 * fail-to-skip LOSES the batch's facts forever, while delaying costs nothing
 * and resumes automatically once the human remedy lands (credits topped up,
 * quota window reset). A sustained loop on these categories is escalated to
 * an error log by the worker (SUSTAINED_BUSY_ERROR_THRESHOLD) so a stuck
 * system key can't sit unnoticed at info level for days.
 */
const BUSY_CATEGORIES = new Set<string>([
  ApiErrorCategory.RATE_LIMIT,
  ApiErrorCategory.SERVER_ERROR,
  ApiErrorCategory.TIMEOUT,
  ApiErrorCategory.QUOTA_EXCEEDED,
  ApiErrorCategory.CREDIT_EXHAUSTION,
]);

/**
 * Resolve the provider extraction bills to. 'zai-coding' requires the system
 * coding-plan key — without it we fall back to OpenRouter (the boot-time check
 * in factExtractionSetup logs the misconfiguration loudly once).
 */
export function resolveExtractionProvider(): { provider: AIProvider; apiKey?: string } {
  const cfg = getConfig();
  if (cfg.EXTRACTION_PROVIDER === 'zai-coding' && cfg.ZAI_CODING_API_KEY !== undefined) {
    return { provider: AIProvider.ZaiCoding, apiKey: cfg.ZAI_CODING_API_KEY };
  }
  return { provider: AIProvider.OpenRouter };
}

/** Model invocation seam — injectable for tests/eval (defaults to the real call). */
export type ExtractionModelInvoker = (prompt: string) => Promise<ExtractionModelResult>;

/** The real model call — exported for the eval harness (same code path as prod). */
export async function invokeExtractionModel(prompt: string): Promise<ExtractionModelResult> {
  const cfg = getConfig();
  const route = resolveExtractionProvider();
  // z.ai-direct takes the bare model id ('z-ai/glm-5.2' → 'glm-5.2'), same
  // mapping ProviderRouter applies to promoted completions.
  const modelName =
    route.provider === AIProvider.ZaiCoding && cfg.EXTRACTION_MODEL.startsWith(ZAI_MODEL_PREFIX)
      ? cfg.EXTRACTION_MODEL.slice(ZAI_MODEL_PREFIX.length)
      : cfg.EXTRACTION_MODEL;
  const { model } = createChatModel({
    modelName,
    temperature: 0,
    responseFormat: { type: 'json_object' },
    // OpenRouter-only attribution header; inert on z.ai-direct (no analog —
    // usage_logs requestType is the insight surface there).
    appTitleSuffix: 'Extraction',
    provider: route.provider,
    ...(route.apiKey !== undefined ? { apiKey: route.apiKey } : {}),
  });
  const response = await model.invoke([new HumanMessage(prompt)], {
    timeout: EXTRACTION_TIMEOUT_MS,
  });
  return {
    content:
      typeof response.content === 'string' ? response.content : JSON.stringify(response.content),
    tokensIn: response.usage_metadata?.input_tokens ?? 0,
    tokensOut: response.usage_metadata?.output_tokens ?? 0,
    provider: route.provider,
  };
}

export class FactExtractionService {
  private readonly invokeModel: ExtractionModelInvoker;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly factStore: FactStore,
    private readonly budget: ExtractionBudget,
    invokeModel: ExtractionModelInvoker = invokeExtractionModel
  ) {
    this.invokeModel = invokeModel;
  }

  /** Process one extraction batch. Returns the number of facts written. */
  async processBatch(job: FactExtractionJobData): Promise<number> {
    const episodes = await this.prisma.memory.findMany({
      where: {
        id: { in: job.sourceMemoryIds },
        personalityId: job.personalityId,
        visibility: 'normal',
      },
      select: { id: true, content: true, personaId: true, isFiction: true },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    if (episodes.length === 0) {
      logger.info({ jobId: job.windowStart }, 'No live episodes in batch — nothing to extract');
      return 0;
    }

    // Group by persona: fact scope is (personality, persona), and a channel
    // batch can interleave multiple users. isFiction is pinned from the
    // group's FIRST episode — safe while episode writes never set is_fiction
    // (all rows false today); when R7 fiction-tagging wires that column, a
    // mixed batch needs per-episode handling (tracked in follow-ups).
    const groups = new Map<string, EpisodeGroup>();
    for (const ep of episodes) {
      if (ep.personaId === null) {
        continue; // legacy rows without persona linkage — no fact scope to write into
      }
      const group = groups.get(ep.personaId) ?? {
        personaId: ep.personaId,
        isFiction: ep.isFiction,
        ids: [],
        texts: [],
      };
      group.ids.push(ep.id);
      group.texts.push(ep.content);
      groups.set(ep.personaId, group);
    }

    let written = 0;
    const pending = [...groups.values()];
    for (let i = 0; i < pending.length; i++) {
      try {
        written += await this.processGroup(job, pending[i]);
      } catch (error) {
        if (error instanceof ExtractionProviderBusyError) {
          // Provider busy: stop immediately (it's busy for the remaining
          // groups too) and hand the worker exactly the unfinished work —
          // the busy group plus everything after it. Completed groups stay
          // out of the requeue so they can't be re-billed.
          const remaining = pending.slice(i).flatMap(g => g.ids);
          throw new ExtractionProviderBusyError(error.category, error.cause, remaining);
        }
        throw error;
      }
    }
    return written;
  }

  /** Extract one persona-scoped group. Fail-to-skip: errors write nothing. */
  private async processGroup(job: FactExtractionJobData, group: EpisodeGroup): Promise<number> {
    const scope = { personalityId: job.personalityId, personaId: group.personaId };

    // Cost tripwire FIRST — shadow mode already spends money.
    const allowed = await this.budget.tryConsume(job.personalityId);
    if (!allowed) {
      return 0;
    }

    const knownFacts = await this.factStore.getRecentActiveFacts(
      job.personalityId,
      group.personaId,
      SUPERSESSION_CONTEXT_TOKEN_BUDGET
    );

    const prompt = buildExtractionPrompt(group.texts, knownFacts, group.isFiction);

    let modelResult: ExtractionModelResult;
    try {
      modelResult = await this.invokeModel(prompt);
    } catch (error) {
      // Transient provider failures (rate limit / 5xx / timeout / quota) mean
      // BUSY, not broken: propagate so the worker delays the whole batch —
      // facts aren't time-sensitive, and extraction never downgrades to a
      // fallback provider (owner directive). Permanent shapes keep
      // fail-to-skip.
      const category = parseApiError(error).category;
      if (BUSY_CATEGORIES.has(category)) {
        // Busy spent zero tokens — refund the unit so a sustained busy window
        // (30-min requeue cycles for hours) can't burn the daily cap and make
        // the tripwire skip real batches once the provider recovers.
        await this.budget.refund(job.personalityId);
        throw new ExtractionProviderBusyError(category, error);
      }
      logger.warn({ err: error, ...scope }, 'Extraction model call failed — skipping group');
      return 0;
    }

    const parsed = this.parseResponse(modelResult.content, scope);
    // Usage is logged only once the call is known non-busy (the busy path
    // throws above, before any row) so a delayed-and-requeued batch can't
    // double-count. Parse failures DO log usage — the tokens were spent.
    await this.logExtractionUsage(group.personaId, modelResult, scope);
    if (parsed === null || parsed.length === 0) {
      return 0;
    }

    let written = 0;
    for (const fact of parsed) {
      try {
        await this.writeExtractedFact(job, group, knownFacts, fact);
        written += 1;
      } catch (error) {
        logger.warn(
          { err: error, ...scope, statementLength: fact.statement.length },
          'Fact write failed — skipping fact'
        );
      }
    }
    logger.info(
      { ...scope, extracted: parsed.length, written, knownFactCount: knownFacts.length },
      'Extraction group complete'
    );
    return written;
  }

  /**
   * Record one usage_logs row per extraction model call, attributed to the
   * persona's owning user (their conversation generated the batch) — the same
   * ledger chat completions write to, so extraction spend is queryable
   * in-system instead of only on the provider dashboard. Fail-soft: a usage
   * bookkeeping failure must never cost an extraction batch.
   */
  private async logExtractionUsage(
    personaId: string,
    modelResult: ExtractionModelResult,
    scope: { personalityId: string; personaId: string }
  ): Promise<void> {
    try {
      const persona = await this.prisma.persona.findUnique({
        where: { id: personaId },
        select: { ownerId: true },
      });
      if (persona === null) {
        logger.warn({ ...scope }, 'Extraction usage row skipped — persona row not found');
        return;
      }
      const model = getConfig().EXTRACTION_MODEL;
      const provider = modelResult.provider;
      const createdAt = new Date();
      await this.prisma.usageLog.create({
        data: {
          id: generateUsageLogUuid(persona.ownerId, model, createdAt),
          userId: persona.ownerId,
          provider,
          model,
          tokensIn: modelResult.tokensIn,
          tokensOut: modelResult.tokensOut,
          requestType: 'fact_extraction',
          createdAt,
        },
      });
    } catch (error) {
      logger.warn({ err: error, ...scope }, 'Extraction usage row failed — continuing');
    }
  }

  /** JSON.parse + zod safeParse; null on ANY malformation (fail-to-skip). */
  private parseResponse(
    raw: string,
    scope: { personalityId: string; personaId: string }
  ): ExtractedFact[] | null {
    let json: unknown;
    try {
      json = JSON.parse(extractJsonPayload(raw));
    } catch {
      // Response content is derived conversation content — log only its shape
      // (00-critical: never log message content).
      logger.warn(
        { ...scope, responseLength: raw.length },
        'Extraction response not JSON — skipped'
      );
      return null;
    }
    const result = extractionResponseSchema.safeParse(json);
    if (!result.success) {
      logger.warn(
        { ...scope, issues: result.error.issues.slice(0, 3) },
        'Extraction response failed schema — skipped'
      );
      return null;
    }
    return result.data.facts;
  }

  /**
   * Resolve supersession targets (LLM index + always-on similarity fallback)
   * and write the fact transactionally.
   */
  private async writeExtractedFact(
    job: FactExtractionJobData,
    group: EpisodeGroup,
    knownFacts: FactForContext[],
    fact: ExtractedFact
  ): Promise<void> {
    const supersededIds = new Set<string>();

    // LLM-named target: index into the injected list, bounds-checked (an
    // out-of-range index is model noise, not a crash). Locked facts and
    // user-authored corrections are never auto-superseded — user state
    // outranks the model.
    if (fact.supersedesIndex !== null && fact.supersedesIndex < knownFacts.length) {
      const target = knownFacts[fact.supersedesIndex];
      if (!isProtectedFromAutoSupersession(target)) {
        supersededIds.add(target.id);
      }
    }

    // Always-on similarity fallback: catches targets outside the injected
    // window. High floor + entity-tag overlap guard against 384-dim noise.
    const newFact: NewFact = {
      personalityId: job.personalityId,
      personaId: group.personaId,
      statement: fact.statement,
      entityTags: fact.entityTags,
      salience: fact.salience,
      isFiction: group.isFiction,
      sourceMemoryIds: group.ids,
      extractionJobId: generateFactExtractionJobUuid(
        job.channelId,
        job.personalityId,
        job.windowStart
      ),
    };

    const embedding = await this.factStore.embedStatement(fact.statement);
    const candidates = await this.factStore.findSimilarActiveFacts(
      embedding,
      job.personalityId,
      group.personaId
    );
    for (const candidate of candidates) {
      if (supersededIds.has(candidate.id) || isProtectedFromAutoSupersession(candidate)) {
        continue;
      }
      if (candidate.similarity < SIMILARITY_SUPERSESSION_THRESHOLD) {
        continue; // candidates are similarity-ordered, but check each (defensive)
      }
      if (!hasEntityOverlap(fact.entityTags, candidate.entityTags)) {
        continue; // "Bob likes tea" must not supersede "Alice likes tea"
      }
      supersededIds.add(candidate.id);
    }

    await this.factStore.writeFactWithSupersessions(newFact, [...supersededIds], embedding);
  }
}

/** Entity-tag overlap guard for similarity-based supersession. */
export function hasEntityOverlap(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) {
    return false;
  }
  const bSet = new Set(b.map(t => t.toLowerCase()));
  return a.some(t => bSet.has(t.toLowerCase()));
}
