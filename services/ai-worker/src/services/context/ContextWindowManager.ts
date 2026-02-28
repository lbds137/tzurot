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
 *
 * NEW ARCHITECTURE (2025-12): History is now serialized as XML inside the system prompt,
 * not as separate LangChain messages. This prevents identity bleeding.
 */

import type { BaseMessage } from '@langchain/core/messages';
import { countTextTokens, createLogger } from '@tzurot/common-types';
import type { PromptContext, MemoryDocument, TokenBudget } from './PromptContext.js';
import { formatSingleMemory } from '../prompt/MemoryFormatter.js';
import type { RawHistoryEntry } from '../../jobs/utils/conversationUtils.js';
import {
  formatConversationHistoryAsXml,
  getFormattedMessageCharLength,
  type CrossChannelGroup,
} from '../../jobs/utils/conversationUtils.js';
import { serializeCrossChannelHistory } from './CrossChannelSerializer.js';
import { MemoryBudgetManager, type MemorySelectionResult } from './MemoryBudgetManager.js';

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
  private memoryBudgetManager: MemoryBudgetManager;

  constructor(memoryBudgetManager?: MemoryBudgetManager) {
    this.memoryBudgetManager = memoryBudgetManager ?? new MemoryBudgetManager();
  }

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
   * Uses formatSingleMemory() to ensure token counting matches the exact
   * format that appears in prompts. Any changes to memory formatting will
   * automatically be reflected in token counts.
   */
  private countMemoryTokens(memories: MemoryDocument[]): number {
    if (memories.length === 0) {
      return 0;
    }

    let totalTokens = 0;

    for (const doc of memories) {
      const memoryText = formatSingleMemory(doc);
      totalTokens += countTextTokens(memoryText);
    }

    return totalTokens;
  }

  /**
   * Select and serialize conversation history as XML
   *
   * NEW ARCHITECTURE (2025-12): History is serialized inside the system prompt
   * rather than as separate LangChain messages. This prevents identity bleeding.
   *
   * @param rawHistory - Raw conversation history entries
   * @param personalityName - Name of the AI personality (for marking its messages)
   * @param historyBudget - Maximum tokens to use for history
   * @returns Serialized XML string and metadata about selection
   */
  selectAndSerializeHistory(
    rawHistory: RawHistoryEntry[] | undefined,
    personalityName: string,
    historyBudget: number,
    crossChannelGroups?: CrossChannelGroup[]
  ): {
    serializedHistory: string;
    historyTokensUsed: number;
    messagesIncluded: number;
    messagesDropped: number;
  } {
    if (rawHistory === undefined || rawHistory.length === 0 || historyBudget <= 0) {
      return {
        serializedHistory: '',
        historyTokensUsed: 0,
        messagesIncluded: 0,
        messagesDropped: rawHistory?.length ?? 0,
      };
    }

    // Work backwards from newest message, selecting messages that fit in budget
    const selectedEntries: RawHistoryEntry[] = [];
    let estimatedTokens = 0;

    // Account for <chat_log> wrapper overhead
    const wrapperOverhead = countTextTokens('<chat_log>\n</chat_log>');
    const budgetRemaining = historyBudget - wrapperOverhead;

    for (let i = rawHistory.length - 1; i >= 0 && budgetRemaining > 0; i--) {
      const entry = rawHistory[i];

      // Use cached token count if available, otherwise estimate from formatted length
      const entryTokens =
        entry.tokenCount ?? Math.ceil(getFormattedMessageCharLength(entry, personalityName) / 4);

      if (estimatedTokens + entryTokens > budgetRemaining) {
        logger.debug(
          `[CWM] Stopping history selection: would exceed budget (${estimatedTokens + entryTokens} > ${budgetRemaining})`
        );
        break;
      }

      selectedEntries.unshift(entry); // Add to front to maintain chronological order
      estimatedTokens += entryTokens;
    }

    // Serialize the selected entries as XML
    const currentChannelXml = formatConversationHistoryAsXml(selectedEntries, personalityName);
    let actualTokens = countTextTokens(currentChannelXml) + wrapperOverhead;

    logger.info(
      `[CWM] Selected ${selectedEntries.length}/${rawHistory.length} history messages (${actualTokens} tokens, budget: ${historyBudget})`
    );

    // Serialize cross-channel history if available and budget remains
    let crossChannelXml = '';
    if (
      crossChannelGroups !== undefined &&
      crossChannelGroups.length > 0 &&
      actualTokens < historyBudget
    ) {
      crossChannelXml = serializeCrossChannelHistory(
        crossChannelGroups,
        personalityName,
        historyBudget - actualTokens
      );

      if (crossChannelXml.length > 0) {
        const crossTokens = countTextTokens(crossChannelXml);
        actualTokens += crossTokens;
        logger.info(
          `[CWM] Added cross-channel history (${crossTokens} tokens, ${crossChannelGroups.length} channels)`
        );
      }
    }

    // Prepend cross-channel before current channel (older context first)
    const serializedHistory =
      crossChannelXml.length > 0 ? `${crossChannelXml}\n${currentChannelXml}` : currentChannelXml;

    return {
      serializedHistory,
      historyTokensUsed: actualTokens,
      messagesIncluded: selectedEntries.length,
      messagesDropped: rawHistory.length - selectedEntries.length,
    };
  }

  /**
   * Calculate history token budget
   *
   * Returns the number of tokens available for conversation history
   * after accounting for system prompt base, current message, and memories.
   *
   * @param contextWindowTokens - Total context window size
   * @param systemPromptBaseTokens - Tokens for system prompt WITHOUT history
   * @param currentMessageTokens - Tokens for current user message
   * @param memoryTokens - Tokens for relevant memories
   */
  calculateHistoryBudget(
    contextWindowTokens: number,
    systemPromptBaseTokens: number,
    currentMessageTokens: number,
    memoryTokens: number
  ): number {
    return Math.max(
      0,
      contextWindowTokens - systemPromptBaseTokens - currentMessageTokens - memoryTokens
    );
  }

  /**
   * Select memories that fit within a token budget
   *
   * Delegates to MemoryBudgetManager for the actual selection logic.
   * See MemoryBudgetManager.selectMemoriesWithinBudget for details.
   */
  selectMemoriesWithinBudget(
    memories: MemoryDocument[],
    tokenBudget: number,
    timezone?: string
  ): MemorySelectionResult {
    return this.memoryBudgetManager.selectMemoriesWithinBudget(memories, tokenBudget, timezone);
  }

  /**
   * Calculate the token budget for memories
   *
   * Delegates to MemoryBudgetManager for the actual calculation.
   * See MemoryBudgetManager.calculateMemoryBudget for details.
   */
  calculateMemoryBudget(
    contextWindowTokens: number,
    systemPromptBaseTokens?: number,
    currentMessageTokens?: number,
    historyTokens?: number
  ): number {
    return this.memoryBudgetManager.calculateMemoryBudget(
      contextWindowTokens,
      systemPromptBaseTokens,
      currentMessageTokens,
      historyTokens
    );
  }

  /**
   * Count total tokens in conversation history
   *
   * Delegates to MemoryBudgetManager for the actual counting.
   * See MemoryBudgetManager.countHistoryTokens for details.
   */
  countHistoryTokens(rawHistory: RawHistoryEntry[] | undefined, personalityName: string): number {
    return this.memoryBudgetManager.countHistoryTokens(rawHistory, personalityName);
  }
}
