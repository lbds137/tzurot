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
    const {
      personality,
      processedPersonality,
      participantPersonas,
      retrievedMemories,
      context,
      userMessage,
      processedAttachments,
      referencedMessagesDescriptions,
    } = opts;
    const contextWindowTokens =
      personality.contextWindowTokens || AI_DEFAULTS.CONTEXT_WINDOW_TOKENS;

    // Build current message
    const { message: currentMessage, contentForStorage } = this.promptBuilder.buildHumanMessage(
      userMessage,
      processedAttachments,
      context.activePersonaName,
      referencedMessagesDescriptions
    );

    // Build base system prompt (no memories or history) to get base token count
    const systemPromptBaseOnly = this.promptBuilder.buildFullSystemPrompt({
      personality: processedPersonality,
      participantPersonas,
      relevantMemories: [],
      context,
      referencedMessagesFormatted: referencedMessagesDescriptions,
    });

    // Count tokens for budget calculation
    const systemPromptBaseTokens = this.promptBuilder.countTokens(
      systemPromptBaseOnly.content as string
    );
    const currentMessageTokens = this.promptBuilder.countTokens(currentMessage.content as string);
    const historyTokens = this.contextWindowManager.countHistoryTokens(
      context.rawConversationHistory,
      personality.name
    );

    // Calculate memory budget
    const memoryBudget = this.contextWindowManager.calculateMemoryBudget(
      contextWindowTokens,
      systemPromptBaseTokens,
      currentMessageTokens,
      historyTokens
    );

    // Select memories within budget
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

    // Build system prompt with memories
    const systemPromptWithMemories = this.promptBuilder.buildFullSystemPrompt({
      personality: processedPersonality,
      participantPersonas,
      relevantMemories,
      context,
      referencedMessagesFormatted: referencedMessagesDescriptions,
    });

    // Calculate history budget
    const systemPromptWithMemoriesTokens = this.promptBuilder.countTokens(
      systemPromptWithMemories.content as string
    );
    const historyBudget = this.contextWindowManager.calculateHistoryBudget(
      contextWindowTokens,
      systemPromptWithMemoriesTokens,
      currentMessageTokens,
      0
    );

    // Select and serialize history
    const {
      serializedHistory,
      historyTokensUsed,
      messagesIncluded: _messagesIncluded,
      messagesDropped,
    } = this.contextWindowManager.selectAndSerializeHistory(
      context.rawConversationHistory,
      personality.name,
      historyBudget
    );

    // Build final system prompt with memories AND history
    const systemPrompt = this.promptBuilder.buildFullSystemPrompt({
      personality: processedPersonality,
      participantPersonas,
      relevantMemories,
      context,
      referencedMessagesFormatted: referencedMessagesDescriptions,
      serializedHistory,
    });

    // Log token allocation
    logger.info(
      `[Budget] Token allocation: total=${contextWindowTokens}, base=${systemPromptBaseTokens}, current=${currentMessageTokens}, memories=${memoryTokensUsed}/${this.countMemoryTokensSafe(retrievedMemories)}, historyBudget=${historyBudget}, historyUsed=${historyTokensUsed}`
    );
    if (messagesDropped > 0) {
      logger.debug(`[Budget] Dropped ${messagesDropped} history messages due to token budget`);
    }

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
