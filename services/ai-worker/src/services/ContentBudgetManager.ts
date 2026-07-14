/**
 * Content Budget Manager
 *
 * Delegate class responsible for token budget allocation and content selection
 * within the context window. Extracted from ConversationalRAGService to reduce
 * file size and separate concerns.
 */

import type { HumanMessage } from '@langchain/core/messages';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { contentToText } from '../utils/baseMessageContent.js';
import { buildHistoryMessageIdSet } from '../jobs/utils/conversationUtils.js';
import type { PromptBuilder } from './PromptBuilder.js';
import type { ContextWindowManager } from './context/ContextWindowManager.js';
import {
  formatSingleFact,
  getFactsWrapperOverheadText,
  type FactRenderNames,
} from './prompt/MemoryFormatter.js';
import type {
  BudgetAllocationOptions,
  BudgetAllocationResult,
  FactForPrompt,
  MemoryDocument,
} from './ConversationalRAGTypes.js';

const logger = createLogger('ContentBudgetManager');

/**
 * Reserved fact sub-budget (Phase 2 slice 4a). Facts are short/dense and would
 * otherwise crowd verbose episodes out of the shared memory budget (council).
 * They get a capped slice — at most `FACT_BUDGET_MAX_TOKENS`, and never more
 * than `FACT_BUDGET_MAX_FRACTION` of the memory budget — so episodes always
 * keep the majority; the rest of the memory budget goes to episodes.
 */
const FACT_BUDGET_MAX_TOKENS = 600;
const FACT_BUDGET_MAX_FRACTION = 0.3;

/**
 * The history pre-pass result (STM/LTM dedup-hole fix). History is selected
 * BEFORE memory retrieval — it needs nothing from memories once the memory
 * budget is a reserve — so the EXACT shipped-history boundary is known when
 * the LTM query runs, instead of assuming all fetched history ships and
 * losing the truncated range to neither path.
 */
export interface PreselectedHistory {
  currentMessage: HumanMessage;
  contentForStorage: string;
  systemPromptBaseTokens: number;
  currentMessageTokens: number;
  /** Memory budget (same formula as always) — reserved up front so the
   * history budget is computable pre-retrieval. */
  memoryReserve: number;
  historyBudget: number;
  serializedHistory: string;
  historyTokensUsed: number;
  messagesDropped: number;
  crossChannelMessagesIncluded: number;
  /** min createdAt over SELECTED current-channel entries; undefined when
   * nothing shipped. The exact time baseline for STM/LTM dedup. */
  oldestSelectedTs?: number;
  /** Discord snowflakes of every shipped current-channel entry (incl. chunk
   * ids) — the authoritative ID-dedup set. */
  shippedMessageIds: Set<string>;
}

export class ContentBudgetManager {
  constructor(
    private readonly promptBuilder: PromptBuilder,
    private readonly contextWindowManager: ContextWindowManager
  ) {}

  /**
   * Select history BEFORE memory retrieval. The memory budget uses the same
   * formula as always (contention floor preserved: recency yields to identity
   * at the margin) but as a RESERVE, so the history budget — and therefore the
   * exact set of shipped messages — no longer depends on what retrieval
   * returns. Known behavioral delta vs the old order: when memories underuse
   * their reserve AND history exceeds the reserve-based budget, a few oldest
   * messages truncate that previously squeaked in — but they become
   * LTM-reachable by construction (the safe direction).
   */
  preselectHistory(
    opts: Omit<BudgetAllocationOptions, 'retrievedMemories' | 'facts'>
  ): PreselectedHistory {
    const { personality, context, historyReductionPercent } = opts;
    const contextWindowTokens = opts.effectiveContextWindowTokens;

    // Cast is safe: buildBaseComponents reads only prompt/message inputs,
    // never the omitted retrieval fields (retrievedMemories/facts) — they
    // don't exist yet at pre-pass time, which is the whole point. If
    // buildBaseComponents ever grows a retrieval-field read, narrow its
    // parameter type instead of widening this call.
    const { currentMessage, contentForStorage, systemPromptBaseTokens } = this.buildBaseComponents(
      opts as BudgetAllocationOptions
    );
    const currentMessageTokens = this.promptBuilder.countTokens(
      contentToText(currentMessage.content)
    );

    const historyTokens = this.contextWindowManager.countHistoryTokens(
      context.rawConversationHistory,
      personality.name
    );
    const memoryReserve = this.contextWindowManager.calculateMemoryBudget(
      contextWindowTokens,
      systemPromptBaseTokens,
      currentMessageTokens,
      historyTokens
    );

    let historyBudget = Math.max(
      0,
      contextWindowTokens - systemPromptBaseTokens - currentMessageTokens - memoryReserve
    );
    // History reduction for duplicate-detection retries (changes the context
    // window to break API-level caching on free models) — history absorbs it;
    // the memory reserve is untouched, same as the old order.
    if (historyReductionPercent !== undefined && historyReductionPercent > 0) {
      const reducedBudget = Math.floor(historyBudget * (1 - historyReductionPercent));
      logger.info(
        {
          reductionPercent: Math.round(historyReductionPercent * 100),
          originalBudget: historyBudget,
          reducedBudget,
        },
        'Reducing history budget for duplicate retry'
      );
      historyBudget = reducedBudget;
    }

    const {
      serializedHistory,
      historyTokensUsed,
      messagesDropped,
      crossChannelMessagesIncluded,
      selectedEntries,
    } = this.contextWindowManager.selectAndSerializeHistory(
      context.rawConversationHistory,
      personality.name,
      historyBudget,
      context.crossChannelHistory,
      context.environment
    );

    const selectedTimestamps = selectedEntries
      .map(entry => (entry.createdAt !== undefined ? new Date(entry.createdAt).getTime() : NaN))
      .filter(ts => Number.isFinite(ts));
    const oldestSelectedTs =
      selectedTimestamps.length > 0
        ? selectedTimestamps.reduce((min, ts) => Math.min(min, ts), Infinity)
        : undefined;

    return {
      currentMessage,
      contentForStorage,
      systemPromptBaseTokens,
      currentMessageTokens,
      memoryReserve,
      historyBudget,
      serializedHistory,
      historyTokensUsed,
      messagesDropped,
      crossChannelMessagesIncluded,
      oldestSelectedTs,
      shippedMessageIds: buildHistoryMessageIdSet(selectedEntries),
    };
  }

  /**
   * STM/LTM dedup at selection time — the authoritative filter (the query
   * cutoff over-retrieves past the boundary to catch memory-persistence lag).
   * Keep a memory iff:
   *   - it predates the oldest SHIPPED current-channel message (exact time
   *     baseline, strict — no buffer band), OR
   *   - it is a current-channel memory whose source messages were all DROPPED
   *     (has messageIds, none shipped) — the rescue that closes the hole.
   * The rescue is CHANNEL-SCOPED: without that, memories of shipped
   * cross-channel content would re-enter as duplication (their ids are not in
   * the shipped-current set). Legacy id-less rows get only the time baseline —
   * today's semantics. No filter when nothing shipped.
   */
  private filterShippedMemories(
    memories: MemoryDocument[],
    preselected: PreselectedHistory,
    currentChannelId: string | undefined
  ): MemoryDocument[] {
    const { oldestSelectedTs, shippedMessageIds } = preselected;
    if (oldestSelectedTs === undefined) {
      return memories;
    }
    const kept = memories.filter(memory => {
      // createdAt is string | number by type; normalize once so a
      // string-stamped memory that predates the boundary cannot silently
      // fall through to the (stricter) rescue branch and be dropped — that
      // would be the exact coverage-loss class this filter exists to close.
      const createdAtRaw = memory.metadata?.createdAt;
      const createdAtMs = createdAtRaw !== undefined ? new Date(createdAtRaw).getTime() : NaN;
      if (Number.isFinite(createdAtMs) && createdAtMs < oldestSelectedTs) {
        return true;
      }
      const messageIds = memory.metadata?.messageIds;
      const channelId = memory.metadata?.channelId;
      return (
        currentChannelId !== undefined &&
        channelId === currentChannelId &&
        Array.isArray(messageIds) &&
        messageIds.length > 0 &&
        !messageIds.some(id => shippedMessageIds.has(id))
      );
    });
    if (kept.length < memories.length) {
      logger.info(
        {
          retrieved: memories.length,
          kept: kept.length,
          filtered: memories.length - kept.length,
          oldestSelectedTs,
        },
        'STM/LTM selection filter dropped shipped-range memories'
      );
    }
    return kept;
  }

  /**
   * Allocate token budgets and select memories/history within constraints
   *
   * This method orchestrates the complex process of fitting content into
   * the context window:
   * 1. Build base system prompt to calculate fixed overhead
   * 2. Calculate and allocate memory budget
   * 3. Select memories within budget
   * 4. Calculate and allocate history budget
   * 5. Select and serialize history
   * 6. Build final system prompt with all content
   */
  allocate(opts: BudgetAllocationOptions, preselected: PreselectedHistory): BudgetAllocationResult {
    const { processedPersonality, participantPersonas, context } = opts;
    const contextWindowTokens = opts.effectiveContextWindowTokens;

    // History was selected BEFORE retrieval (preselectHistory) so the exact
    // shipped boundary informed the LTM query; here memories are dedup-filtered
    // against what actually shipped, then selected into the reserve.
    const {
      contentForStorage,
      systemPromptBaseTokens,
      currentMessageTokens,
      serializedHistory,
      historyTokensUsed,
      historyBudget,
      messagesDropped,
      crossChannelMessagesIncluded,
    } = preselected;

    const dedupedMemories = this.filterShippedMemories(
      opts.retrievedMemories,
      preselected,
      context.channelId
    );

    // Select memories + facts within the reserve (facts get a reserved sub-budget)
    const {
      relevantMemories,
      memoryTokensUsed,
      memoriesDroppedCount,
      selectedFacts,
      factTokensUsed,
    } = this.selectMemories(opts, dedupedMemories, preselected.memoryReserve);

    // Build final system prompt
    // Note: Image descriptions are now inline in serializedHistory (via injectImageDescriptions)
    const systemPrompt = this.promptBuilder.buildFullSystemPrompt({
      personality: processedPersonality,
      participantPersonas,
      relevantMemories,
      facts: selectedFacts,
      context,
      referencedMessagesFormatted: opts.referencedMessagesDescriptions,
      serializedHistory,
    });

    this.logAllocation({
      contextWindowTokens,
      systemPromptBaseTokens,
      currentMessageTokens,
      memoryTokensUsed,
      retrievedMemories: opts.retrievedMemories,
      historyBudget,
      historyTokensUsed,
      messagesDropped,
      crossChannelMessagesIncluded:
        opts.context.crossChannelHistory !== undefined ? crossChannelMessagesIncluded : undefined,
    });

    return {
      relevantMemories,
      selectedFacts,
      serializedHistory,
      systemPrompt,
      memoryTokensUsed,
      factTokensUsed,
      historyTokensUsed,
      memoriesDroppedCount,
      messagesDropped,
      contentForStorage,
      // Attach whenever cross-channel was enabled this turn (groups defined,
      // even if empty). The empty case must be surfaced — "enabled but found
      // 0 msgs" is the silent-skip that hides bugs in the time-filter / fetch
      // path. Disabled turns omit the field entirely (groups === undefined).
      ...(opts.context.crossChannelHistory !== undefined ? { crossChannelMessagesIncluded } : {}),
    };
  }

  private buildBaseComponents(opts: BudgetAllocationOptions): {
    currentMessage: HumanMessage;
    contentForStorage: string;
    systemPromptBaseTokens: number;
  } {
    const {
      processedPersonality,
      participantPersonas,
      context,
      userMessage,
      processedAttachments,
      referencedMessagesDescriptions,
    } = opts;

    const { message: currentMessage, contentForStorage } = this.promptBuilder.buildHumanMessage(
      userMessage,
      processedAttachments,
      {
        activePersonaName: context.activePersonaName,
        referencedMessagesDescriptions,
        activePersonaId: context.activePersonaId,
        discordUsername: context.discordUsername,
        personalityName: processedPersonality.name,
      }
    );

    const systemPromptBaseOnly = this.promptBuilder.buildFullSystemPrompt({
      personality: processedPersonality,
      participantPersonas,
      relevantMemories: [],
      context,
      referencedMessagesFormatted: referencedMessagesDescriptions,
    });

    const systemPromptBaseTokens = this.promptBuilder.countTokens(
      contentToText(systemPromptBaseOnly.content)
    );

    return { currentMessage, contentForStorage, systemPromptBaseTokens };
  }

  private selectMemories(
    opts: BudgetAllocationOptions,
    dedupedMemories: MemoryDocument[],
    memoryBudget: number
  ): {
    relevantMemories: MemoryDocument[];
    memoryTokensUsed: number;
    memoriesDroppedCount: number;
    selectedFacts: FactForPrompt[];
    factTokensUsed: number;
  } {
    const { personality, context } = opts;

    // Facts take their reserved slice FIRST; episodes get the remainder — so a
    // dense cluster of short facts can't starve verbose episodes, and vice versa.
    const { selectedFacts, factTokensUsed } = this.selectFacts(opts.facts ?? [], memoryBudget, {
      subjectName: context.activePersonaName,
      personalityName: personality.name,
      discordUsername: context.discordUsername,
    });
    const episodeBudget = Math.max(0, memoryBudget - factTokensUsed);

    const {
      selectedMemories: relevantMemories,
      tokensUsed: memoryTokensUsed,
      memoriesDropped: memoriesDroppedCount,
      droppedDueToSize,
    } = this.contextWindowManager.selectMemoriesWithinBudget(
      dedupedMemories,
      episodeBudget,
      context.userTimezone
    );

    if (memoriesDroppedCount > 0 || selectedFacts.length > 0) {
      logger.info(
        {
          kept: relevantMemories.length,
          total: dedupedMemories.length,
          tokensUsed: memoryTokensUsed,
          budget: memoryBudget,
          episodeBudget,
          dropped: memoriesDroppedCount,
          oversized: droppedDueToSize,
          factsKept: selectedFacts.length,
          factsRetrieved: opts.facts?.length ?? 0,
          factTokensUsed,
        },
        'Memory budget applied'
      );
    }

    return {
      relevantMemories,
      memoryTokensUsed,
      memoriesDroppedCount,
      selectedFacts,
      factTokensUsed,
    };
  }

  /**
   * Select facts within the reserved fact sub-budget (capped fraction of the
   * memory budget). Greedy by retrieval order (already sorted by
   * distance→recency→salience), counting the `<facts>` wrapper overhead so the
   * block never overflows its slice. Zero facts selected → zero tokens (the
   * empty block renders nothing).
   */
  private selectFacts(
    facts: FactForPrompt[],
    memoryBudget: number,
    names?: FactRenderNames
  ): { selectedFacts: FactForPrompt[]; factTokensUsed: number } {
    if (facts.length === 0) {
      return { selectedFacts: [], factTokensUsed: 0 };
    }
    const factBudget = Math.min(
      FACT_BUDGET_MAX_TOKENS,
      Math.floor(memoryBudget * FACT_BUDGET_MAX_FRACTION)
    );
    // Same names the render path uses — the overhead count and the per-fact
    // counts must be of the same text the render emits (placeholder-resolved).
    const wrapperOverhead = this.promptBuilder.countTokens(
      getFactsWrapperOverheadText(names?.subjectName)
    );
    const selected: FactForPrompt[] = [];
    let used = wrapperOverhead;
    for (const fact of facts) {
      const factTokens = this.promptBuilder.countTokens(formatSingleFact(fact, names));
      if (used + factTokens > factBudget) {
        break;
      }
      selected.push(fact);
      used += factTokens;
    }
    return selected.length > 0
      ? { selectedFacts: selected, factTokensUsed: used }
      : { selectedFacts: [], factTokensUsed: 0 };
  }

  private logAllocation(opts: {
    contextWindowTokens: number;
    systemPromptBaseTokens: number;
    currentMessageTokens: number;
    memoryTokensUsed: number;
    retrievedMemories: MemoryDocument[];
    historyBudget: number;
    historyTokensUsed: number;
    messagesDropped: number;
    /** Undefined when cross-channel was disabled this turn; 0 when enabled but
     *  no eligible messages (still logged so a "why are my logs showing 0?"
     *  debugging session sees the silent-skip case explicitly). */
    crossChannelMessagesIncluded: number | undefined;
  }): void {
    const {
      contextWindowTokens,
      systemPromptBaseTokens,
      currentMessageTokens,
      memoryTokensUsed,
      retrievedMemories,
      historyBudget,
      historyTokensUsed,
      messagesDropped,
      crossChannelMessagesIncluded,
    } = opts;
    logger.info(
      {
        contextWindowTokens,
        systemPromptBaseTokens,
        currentMessageTokens,
        memoryTokensUsed,
        memoryTokensTotal: this.countMemoryTokensSafe(retrievedMemories),
        historyBudget,
        historyTokensUsed,
        crossChannelMessagesIncluded,
      },
      'Token allocation'
    );
    if (messagesDropped > 0) {
      logger.debug({ messagesDropped }, 'Dropped history messages due to token budget');
    }
  }

  /**
   * Safely count memory tokens, returning 0 if no memories
   */
  private countMemoryTokensSafe(memories: MemoryDocument[]): number {
    if (memories.length === 0) {
      return 0;
    }
    return this.promptBuilder.countMemoryTokens(memories);
  }
}
