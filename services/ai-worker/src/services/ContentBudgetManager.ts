/**
 * Content Budget Manager
 *
 * Delegate class responsible for token budget allocation and content selection
 * within the context window. Extracted from ConversationalRAGService to reduce
 * file size and separate concerns.
 */

import { createLogger, AI_DEFAULTS } from '@tzurot/common-types';
import type { PromptBuilder } from './PromptBuilder.js';
import type { ContextWindowManager } from './context/ContextWindowManager.js';
import type {
  BudgetAllocationOptions,
  BudgetAllocationResult,
  MemoryDocument,
} from './ConversationalRAGTypes.js';

const logger = createLogger('ContentBudgetManager');

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
    const { personality, processedPersonality, participantPersonas, context } = opts;
    const contextWindowTokens =
      personality.contextWindowTokens || AI_DEFAULTS.CONTEXT_WINDOW_TOKENS;

    // Build current message and base system prompt
    const { currentMessage, contentForStorage, systemPromptBaseTokens } =
      this.buildBaseComponents(opts);
    const currentMessageTokens = this.promptBuilder.countTokens(currentMessage.content as string);

    // Select memories within budget
    const { relevantMemories, memoryTokensUsed, memoriesDroppedCount } = this.selectMemories(
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
      context,
      referencedMessagesFormatted: opts.referencedMessagesDescriptions,
      serializedHistory,
    });

    this.logAllocation({
      contextWindowTokens,
      memoryTokensUsed,
      retrievedMemories: opts.retrievedMemories,
      historyBudget,
      historyTokensUsed,
      messagesDropped,
      crossChannelMessagesIncluded,
    });

    return {
      relevantMemories,
      serializedHistory,
      systemPrompt,
      memoryTokensUsed,
      historyTokensUsed,
      memoriesDroppedCount,
      messagesDropped,
      contentForStorage,
    };
  }

  private buildBaseComponents(opts: BudgetAllocationOptions): {
    currentMessage: { content: unknown };
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
      systemPromptBaseOnly.content as string
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

    const {
      selectedMemories: relevantMemories,
      tokensUsed: memoryTokensUsed,
      memoriesDropped: memoriesDroppedCount,
      droppedDueToSize,
    } = this.contextWindowManager.selectMemoriesWithinBudget(
      retrievedMemories,
      memoryBudget,
      context.userTimezone
    );

    if (memoriesDroppedCount > 0) {
      logger.info(
        `[Budget] Memory budget applied: kept ${relevantMemories.length}/${retrievedMemories.length} memories (${memoryTokensUsed} tokens, budget: ${memoryBudget}, dropped: ${memoriesDroppedCount}, oversized: ${droppedDueToSize})`
      );
    }

    return { relevantMemories, memoryTokensUsed, memoriesDroppedCount };
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
      systemPromptWithMemories.content as string
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
        `[Budget] Reducing history budget by ${Math.round(historyReductionPercent * 100)}% for duplicate retry: ${historyBudget} → ${reducedBudget} tokens`
      );
      historyBudget = reducedBudget;
    }

    const crossChannelGroups = context.crossChannelHistory;

    const { serializedHistory, historyTokensUsed, messagesDropped, crossChannelMessagesIncluded } =
      this.contextWindowManager.selectAndSerializeHistory(
        context.rawConversationHistory,
        personality.name,
        historyBudget,
        crossChannelGroups
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
    memoryTokensUsed: number;
    retrievedMemories: MemoryDocument[];
    historyBudget: number;
    historyTokensUsed: number;
    messagesDropped: number;
    crossChannelMessagesIncluded: number;
  }): void {
    const {
      contextWindowTokens,
      memoryTokensUsed,
      retrievedMemories,
      historyBudget,
      historyTokensUsed,
      messagesDropped,
      crossChannelMessagesIncluded,
    } = opts;
    const crossChannelSuffix =
      crossChannelMessagesIncluded > 0 ? `, crossChannel=${crossChannelMessagesIncluded}` : '';
    logger.info(
      `[Budget] Token allocation: total=${contextWindowTokens}, memories=${memoryTokensUsed}/${this.countMemoryTokensSafe(retrievedMemories)}, historyBudget=${historyBudget}, historyUsed=${historyTokensUsed}${crossChannelSuffix}`
    );
    if (messagesDropped > 0) {
      logger.debug(`[Budget] Dropped ${messagesDropped} history messages due to token budget`);
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
