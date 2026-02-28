/**
 * Context Window Manager
 *
 * Manages token budgets and selects conversation history that fits within context window.
 * History is serialized as XML inside the system prompt to prevent identity bleeding.
 * Cross-channel history from other channels is included when budget permits.
 */

import type { BaseMessage } from '@langchain/core/messages';
import { countTextTokens, createLogger } from '@tzurot/common-types';
import type { PromptContext, MemoryDocument, TokenBudget } from './PromptContext.js';
import { formatSingleMemory } from '../prompt/MemoryFormatter.js';
import type { CrossChannelHistoryGroupEntry } from '@tzurot/common-types';
import type { RawHistoryEntry } from '../../jobs/utils/conversationUtils.js';
import {
  formatConversationHistoryAsXml,
  getFormattedMessageCharLength,
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

  /** Select history messages within budget (recency-based: newest first). */
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
   * Select and serialize conversation history as XML within token budget.
   * History is serialized inside the system prompt to prevent identity bleeding.
   * Cross-channel history is included when available and budget permits.
   */
  selectAndSerializeHistory(
    rawHistory: RawHistoryEntry[] | undefined,
    personalityName: string,
    historyBudget: number,
    crossChannelGroups?: CrossChannelHistoryGroupEntry[]
  ): {
    serializedHistory: string;
    historyTokensUsed: number;
    messagesIncluded: number;
    messagesDropped: number;
  } {
    const hasCurrentChannel = rawHistory !== undefined && rawHistory.length > 0;
    const hasCrossChannel = crossChannelGroups !== undefined && crossChannelGroups.length > 0;

    if ((!hasCurrentChannel && !hasCrossChannel) || historyBudget <= 0) {
      return {
        serializedHistory: '',
        historyTokensUsed: 0,
        messagesIncluded: 0,
        messagesDropped: rawHistory?.length ?? 0,
      };
    }

    // Select current-channel messages within budget
    const { selectedEntries, currentChannelXml, tokensUsed } = hasCurrentChannel
      ? this.selectCurrentChannelEntries(rawHistory, personalityName, historyBudget)
      : { selectedEntries: [] as RawHistoryEntry[], currentChannelXml: '', tokensUsed: 0 };

    let actualTokens = tokensUsed;

    // Serialize cross-channel history if available and budget remains
    let crossChannelXml = '';
    if (hasCrossChannel && actualTokens < historyBudget) {
      crossChannelXml = serializeCrossChannelHistory(
        crossChannelGroups,
        personalityName,
        historyBudget - actualTokens
      );

      if (crossChannelXml.length > 0) {
        // Re-measure actual tokens; may slightly exceed historyBudget due to char/4
        // approximation in serializeCrossChannelHistory, but overrun is bounded (XML overhead only).
        const crossTokens = countTextTokens(crossChannelXml);
        actualTokens += crossTokens;
        logger.info(
          { crossTokens, channelCount: crossChannelGroups.length },
          '[CWM] Added cross-channel history'
        );
      }
    }

    // Combine: cross-channel before current channel (older context first)
    let serializedHistory: string;
    if (crossChannelXml.length > 0 && currentChannelXml.length > 0) {
      serializedHistory = `${crossChannelXml}\n${currentChannelXml}`;
    } else {
      serializedHistory = crossChannelXml || currentChannelXml;
    }

    return {
      serializedHistory,
      historyTokensUsed: actualTokens,
      messagesIncluded: selectedEntries.length,
      messagesDropped: (rawHistory?.length ?? 0) - selectedEntries.length,
    };
  }

  /** Select current-channel entries within budget using recency-based strategy. */
  private selectCurrentChannelEntries(
    rawHistory: RawHistoryEntry[],
    personalityName: string,
    historyBudget: number
  ): { selectedEntries: RawHistoryEntry[]; currentChannelXml: string; tokensUsed: number } {
    const wrapperOverhead = countTextTokens('<chat_log>\n</chat_log>');
    const budgetRemaining = historyBudget - wrapperOverhead;
    const selectedEntries: RawHistoryEntry[] = [];
    let estimatedTokens = 0;

    for (let i = rawHistory.length - 1; i >= 0 && budgetRemaining > 0; i--) {
      const entry = rawHistory[i];
      const entryTokens =
        entry.tokenCount ?? Math.ceil(getFormattedMessageCharLength(entry, personalityName) / 4);

      if (estimatedTokens + entryTokens > budgetRemaining) {
        logger.debug(
          { wouldUse: estimatedTokens + entryTokens, budgetRemaining },
          '[CWM] Stopping history selection: would exceed budget'
        );
        break;
      }

      selectedEntries.unshift(entry);
      estimatedTokens += entryTokens;
    }

    const currentChannelXml = formatConversationHistoryAsXml(selectedEntries, personalityName);
    // Only count wrapper overhead when we actually have content to wrap
    const tokensUsed =
      selectedEntries.length > 0 ? countTextTokens(currentChannelXml) + wrapperOverhead : 0;

    logger.info(
      {
        selected: selectedEntries.length,
        total: rawHistory.length,
        tokensUsed,
        budget: historyBudget,
      },
      '[CWM] Selected history messages'
    );

    return { selectedEntries, currentChannelXml, tokensUsed };
  }

  /**
   * Calculate history token budget: remaining tokens after system prompt, current message,
   * and memories are subtracted from the context window.
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
