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

export class ContentBudgetManager {
  constructor(
    private readonly promptBuilder: PromptBuilder,
    private readonly contextWindowManager: ContextWindowManager
  ) {}

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
  allocate(opts: BudgetAllocationOptions): BudgetAllocationResult {
    const { processedPersonality, participantPersonas, context } = opts;
    const contextWindowTokens = opts.effectiveContextWindowTokens;

    // Build current message and base system prompt
    const { currentMessage, contentForStorage, systemPromptBaseTokens } =
      this.buildBaseComponents(opts);
    const currentMessageTokens = this.promptBuilder.countTokens(
      contentToText(currentMessage.content)
    );

    // Select memories + facts within budget (facts get a reserved sub-budget)
    const {
      relevantMemories,
      memoryTokensUsed,
      memoriesDroppedCount,
      selectedFacts,
      factTokensUsed,
    } = this.selectMemories(
      opts,
      contextWindowTokens,
      systemPromptBaseTokens,
      currentMessageTokens
    );

    // Select history within budget
    const {
      serializedHistory,
      historyTokensUsed,
      historyBudget,
      messagesDropped,
      crossChannelMessagesIncluded,
    } = this.selectHistory(opts, relevantMemories, contextWindowTokens, currentMessageTokens);

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
    contextWindowTokens: number,
    systemPromptBaseTokens: number,
    currentMessageTokens: number
  ): {
    relevantMemories: MemoryDocument[];
    memoryTokensUsed: number;
    memoriesDroppedCount: number;
    selectedFacts: FactForPrompt[];
    factTokensUsed: number;
  } {
    const { personality, retrievedMemories, context } = opts;
    const historyTokens = this.contextWindowManager.countHistoryTokens(
      context.rawConversationHistory,
      personality.name
    );

    const memoryBudget = this.contextWindowManager.calculateMemoryBudget(
      contextWindowTokens,
      systemPromptBaseTokens,
      currentMessageTokens,
      historyTokens
    );

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
      retrievedMemories,
      episodeBudget,
      context.userTimezone
    );

    if (memoriesDroppedCount > 0 || selectedFacts.length > 0) {
      logger.info(
        {
          kept: relevantMemories.length,
          total: retrievedMemories.length,
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

  private selectHistory(
    opts: BudgetAllocationOptions,
    relevantMemories: MemoryDocument[],
    contextWindowTokens: number,
    currentMessageTokens: number
  ): {
    serializedHistory: string;
    historyTokensUsed: number;
    historyBudget: number;
    messagesDropped: number;
    crossChannelMessagesIncluded: number;
  } {
    const {
      personality,
      processedPersonality,
      participantPersonas,
      context,
      referencedMessagesDescriptions,
      historyReductionPercent,
    } = opts;

    const systemPromptWithMemories = this.promptBuilder.buildFullSystemPrompt({
      personality: processedPersonality,
      participantPersonas,
      relevantMemories,
      context,
      referencedMessagesFormatted: referencedMessagesDescriptions,
    });

    const systemPromptWithMemoriesTokens = this.promptBuilder.countTokens(
      contentToText(systemPromptWithMemories.content)
    );

    let historyBudget = this.contextWindowManager.calculateHistoryBudget(
      contextWindowTokens,
      systemPromptWithMemoriesTokens,
      currentMessageTokens,
      0
    );

    // Apply history reduction for duplicate detection retries
    // This changes the context window to help break API-level caching on free models
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

    const crossChannelGroups = context.crossChannelHistory;

    const { serializedHistory, historyTokensUsed, messagesDropped, crossChannelMessagesIncluded } =
      this.contextWindowManager.selectAndSerializeHistory(
        context.rawConversationHistory,
        personality.name,
        historyBudget,
        crossChannelGroups,
        context.environment
      );

    return {
      serializedHistory,
      historyTokensUsed,
      historyBudget,
      messagesDropped,
      crossChannelMessagesIncluded,
    };
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
