/**
 * Context Window Manager
 *
 * Manages token budgets and selects conversation history that fits within context window.
 * Extracted from ConversationalRAGService for better separation of concerns.
 *
 * Responsibilities:
 * - Calculate token budgets for all prompt components
 * - Select history messages within budget (recency-based strategy)
 * - Provide detailed token allocation metadata for debugging
 */

import type { BaseMessage } from '@langchain/core/messages';
import { countTextTokens, createLogger, formatMemoryTimestamp } from '@tzurot/common-types';
import type { PromptContext, MemoryDocument, TokenBudget } from './PromptContext.js';

const logger = createLogger('ContextWindowManager');

/**
 * Input data for context window calculation
 */
export interface ContextWindowInput {
  /** The full system prompt (already built) */
  systemPrompt: BaseMessage;
  /** The current user message (already built) */
  currentMessage: BaseMessage;
  /** Relevant memories from vector database */
  relevantMemories: MemoryDocument[];
  /** Full conversation history (LangChain BaseMessage format) */
  conversationHistory: BaseMessage[];
  /** Raw conversation history (for accessing cached tokenCount) */
  rawConversationHistory?: {
    role: string;
    content: string;
    tokenCount?: number;
  }[];
  /** Total context window size in tokens */
  contextWindowTokens: number;
}

export class ContextWindowManager {
  /**
   * Build a PromptContext with token budget applied
   *
   * This is the main entry point. It calculates token budgets and selects
   * history messages that fit within the context window.
   */
  buildContext(input: ContextWindowInput): PromptContext {
    // Calculate token budget for each component
    const tokenBudget = this.calculateTokenBudget(input);

    // Select history within budget
    const { selectedHistory, historyTokensUsed, messagesIncluded, messagesDropped } =
      this.selectHistoryWithinBudget(
        input.conversationHistory,
        input.rawConversationHistory,
        tokenBudget.historyBudget
      );

    // Update token budget with actual history usage
    tokenBudget.historyTokensUsed = historyTokensUsed;

    // Log token allocation
    logger.info(
      `[CWM] Token budget: total=${tokenBudget.contextWindowTokens}, system=${tokenBudget.systemPromptTokens}, current=${tokenBudget.currentMessageTokens}, memories=${tokenBudget.memoryTokens}, historyBudget=${tokenBudget.historyBudget}, historyUsed=${historyTokensUsed}`
    );

    if (messagesIncluded > 0) {
      logger.info(
        `[CWM] Including ${messagesIncluded} history messages (${historyTokensUsed} tokens, budget: ${tokenBudget.historyBudget})`
      );
    }

    if (messagesDropped > 0) {
      logger.debug(`[CWM] Dropped ${messagesDropped} messages due to token budget`);
    }

    if (tokenBudget.historyBudget <= 0) {
      logger.warn(
        {},
        '[CWM] No history budget available! System prompt and current message consumed entire context window.'
      );
    }

    return {
      systemPrompt: input.systemPrompt,
      currentMessage: input.currentMessage,
      selectedHistory,
      relevantMemories: input.relevantMemories,
      tokenBudget,
      metadata: {
        messagesIncluded,
        messagesDropped,
        strategy: 'recency',
      },
    };
  }

  /**
   * Calculate token budget for all prompt components
   */
  private calculateTokenBudget(input: ContextWindowInput): TokenBudget {
    // Count system prompt tokens
    const systemPromptTokens = this.countMessageTokens(input.systemPrompt);

    // Count current message tokens
    const currentMessageTokens = this.countMessageTokens(input.currentMessage);

    // Count memory tokens (formatted with timestamps)
    const memoryTokens = this.countMemoryTokens(input.relevantMemories);

    // Calculate remaining budget for history
    const historyBudget = Math.max(
      0,
      input.contextWindowTokens - systemPromptTokens - currentMessageTokens - memoryTokens
    );

    return {
      contextWindowTokens: input.contextWindowTokens,
      systemPromptTokens,
      currentMessageTokens,
      memoryTokens,
      historyBudget,
      historyTokensUsed: 0, // Will be updated after selection
    };
  }

  /**
   * Select history messages that fit within token budget
   *
   * Uses recency-based strategy: work backwards from newest message,
   * adding messages until budget is exhausted.
   */
  private selectHistoryWithinBudget(
    conversationHistory: BaseMessage[],
    rawHistory: { role: string; content: string; tokenCount?: number }[] | undefined,
    historyBudget: number
  ): {
    selectedHistory: BaseMessage[];
    historyTokensUsed: number;
    messagesIncluded: number;
    messagesDropped: number;
  } {
    if (conversationHistory.length === 0 || historyBudget <= 0) {
      return {
        selectedHistory: [],
        historyTokensUsed: 0,
        messagesIncluded: 0,
        messagesDropped: conversationHistory.length,
      };
    }

    const selectedHistory: BaseMessage[] = [];
    let historyTokensUsed = 0;
    const rawHistoryArray = rawHistory ?? [];

    // Work backwards from newest message, counting tokens until budget exhausted
    for (let i = conversationHistory.length - 1; i >= 0; i--) {
      const msg = conversationHistory[i];
      const rawMsg = rawHistoryArray[i];

      // Use cached token count if available (optimization from Web Claude feedback)
      // Otherwise compute it from the BaseMessage content
      const msgTokens = rawMsg?.tokenCount ?? this.countMessageTokens(msg);

      // Stop if adding this message would exceed budget
      if (historyTokensUsed + msgTokens > historyBudget) {
        logger.debug(
          `[CWM] Stopping history inclusion: would exceed budget (${historyTokensUsed + msgTokens} > ${historyBudget})`
        );
        break;
      }

      selectedHistory.unshift(msg); // Add to front to maintain chronological order
      historyTokensUsed += msgTokens;
    }

    return {
      selectedHistory,
      historyTokensUsed,
      messagesIncluded: selectedHistory.length,
      messagesDropped: conversationHistory.length - selectedHistory.length,
    };
  }

  /**
   * Count tokens in a BaseMessage
   */
  private countMessageTokens(message: BaseMessage): number {
    const content = message.content;
    if (typeof content === 'string') {
      return countTextTokens(content);
    }
    // Handle complex content (arrays, objects)
    return countTextTokens(JSON.stringify(content));
  }

  /**
   * Count tokens for memories (formatted with timestamps)
   *
   * Note: This duplicates the formatting logic from MemoryFormatter to ensure
   * accurate token counts. The formatted string must match what appears in the prompt.
   */
  private countMemoryTokens(memories: MemoryDocument[]): number {
    if (memories.length === 0) {
      return 0;
    }

    let totalTokens = 0;

    for (const doc of memories) {
      const timestamp =
        doc.metadata?.createdAt !== undefined && doc.metadata.createdAt !== null
          ? formatMemoryTimestamp(doc.metadata.createdAt)
          : null;

      // Format exactly as it appears in the prompt
      const memoryText = `- ${timestamp !== null && timestamp.length > 0 ? `[${timestamp}] ` : ''}${doc.pageContent}`;
      totalTokens += countTextTokens(memoryText);
    }

    return totalTokens;
  }
}
