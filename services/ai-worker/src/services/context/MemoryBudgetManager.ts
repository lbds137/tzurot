/**
 * Memory Budget Manager
 *
 * Handles memory token budgeting and selection for the RAG pipeline.
 * Ensures memories don't consume the entire context window by applying
 * a dynamic budget based on available space.
 *
 * Key features:
 * - Dynamic budget: more room for memories when history is short
 * - Knapsack selection: keeps highest-relevance memories within budget
 * - Preserves memory integrity: never truncates individual memories
 */

import { countTextTokens, createLogger, AI_DEFAULTS } from '@tzurot/common-types';
import { formatSingleMemory, getMemoryWrapperOverheadText } from '../prompt/MemoryFormatter.js';
import type { MemoryDocument } from '../ConversationalRAGTypes.js';
import type { RawHistoryEntry } from '../../jobs/utils/conversationUtils.js';
import { formatSingleHistoryEntryAsXml } from '../../jobs/utils/conversationUtils.js';

const logger = createLogger('MemoryBudgetManager');

/**
 * Result of memory selection within budget
 */
export interface MemorySelectionResult {
  /** Memories that fit within the budget (sorted by relevance) */
  selectedMemories: MemoryDocument[];
  /** Total tokens used by selected memories (including wrapper overhead) */
  tokensUsed: number;
  /** Number of memories dropped due to budget constraints */
  memoriesDropped: number;
  /** Count of memories skipped because they alone exceeded remaining budget */
  droppedDueToSize: number;
}

export class MemoryBudgetManager {
  /**
   * Select memories that fit within a token budget
   *
   * Uses a "knapsack" approach: memories come pre-sorted by relevance (highest first)
   * from pgvector, and we greedily add memories until the budget is exhausted.
   *
   * This prevents huge memories (e.g., pasted conversation logs) from consuming
   * the entire context window. When budget is limited, only the most relevant
   * memories are kept.
   *
   * @param memories - Memories sorted by relevance (highest first from pgvector)
   * @param tokenBudget - Maximum tokens to use for memories
   * @param timezone - Optional timezone for timestamp formatting
   * @returns Selected memories and metadata
   */
  selectMemoriesWithinBudget(
    memories: MemoryDocument[],
    tokenBudget: number,
    timezone?: string
  ): MemorySelectionResult {
    if (memories.length === 0 || tokenBudget <= 0) {
      return {
        selectedMemories: [],
        tokensUsed: 0,
        memoriesDropped: memories.length,
        droppedDueToSize: 0,
      };
    }

    const selectedMemories: MemoryDocument[] = [];
    let tokensUsed = 0;
    let droppedDueToSize = 0;

    // Account for memory archive wrapper overhead (single source of truth in MemoryFormatter)
    const wrapperOverhead = countTextTokens(getMemoryWrapperOverheadText());
    const budgetRemaining = tokenBudget - wrapperOverhead;

    if (budgetRemaining <= 0) {
      logger.warn(
        { tokenBudget, wrapperOverhead },
        '[MemoryBudget] Budget too small even for wrapper overhead'
      );
      return {
        selectedMemories: [],
        tokensUsed: 0,
        memoriesDropped: memories.length,
        droppedDueToSize: 0,
      };
    }

    // Iterate through memories (already sorted by relevance from pgvector)
    for (const memory of memories) {
      // Count tokens for this specific memory entry
      const memoryText = formatSingleMemory(memory, timezone);
      const memoryTokens = countTextTokens(memoryText);

      // Check if adding this memory would exceed budget
      if (tokensUsed + memoryTokens <= budgetRemaining) {
        selectedMemories.push(memory);
        tokensUsed += memoryTokens;
      } else {
        // Memory doesn't fit - track if it's due to size vs budget exhausted
        if (memoryTokens > budgetRemaining) {
          droppedDueToSize++;
          logger.debug(
            { memoryTokens, budgetRemaining, relevanceScore: memory.metadata?.score },
            '[MemoryBudget] Skipping oversized memory'
          );
        }
        // Continue checking - smaller memories might still fit
      }
    }

    const memoriesDropped = memories.length - selectedMemories.length;

    if (memoriesDropped > 0) {
      logger.info(
        {
          selected: selectedMemories.length,
          dropped: memoriesDropped,
          droppedDueToSize,
          tokensUsed,
          tokenBudget,
        },
        '[MemoryBudget] Selection complete - some memories dropped due to token budget'
      );
    }

    return {
      selectedMemories,
      tokensUsed: tokensUsed + wrapperOverhead,
      memoriesDropped,
      droppedDueToSize,
    };
  }

  /**
   * Calculate the token budget for memories
   *
   * Uses MEMORY_TOKEN_BUDGET_RATIO as a hard cap, but dynamically allocates
   * more to memories if history is short (unused history budget → memories).
   *
   * This prevents wasting context window when:
   * - Starting a new conversation (empty/short history)
   * - History is very brief
   *
   * @param contextWindowTokens - Total context window size
   * @param systemPromptBaseTokens - Tokens for system prompt base (without memories/history)
   * @param currentMessageTokens - Tokens for current user message
   * @param historyTokens - Estimated tokens for conversation history
   * @returns Token budget for memories
   */
  calculateMemoryBudget(
    contextWindowTokens: number,
    systemPromptBaseTokens?: number,
    currentMessageTokens?: number,
    historyTokens?: number
  ): number {
    // Hard cap: never exceed this ratio of context window
    const hardCap = Math.floor(contextWindowTokens * AI_DEFAULTS.MEMORY_TOKEN_BUDGET_RATIO);

    // If we don't have component sizes, use the hard cap
    if (
      systemPromptBaseTokens === undefined ||
      currentMessageTokens === undefined ||
      historyTokens === undefined
    ) {
      return hardCap;
    }

    // Calculate available space after fixed components
    // Reserve safety margin for response tokens
    const safetyMargin = Math.floor(contextWindowTokens * AI_DEFAULTS.RESPONSE_SAFETY_MARGIN_RATIO);
    const availableSpace =
      contextWindowTokens -
      systemPromptBaseTokens -
      currentMessageTokens -
      historyTokens -
      safetyMargin;

    // Dynamic allocation: use available space, but never exceed hard cap
    const dynamicBudget = Math.max(0, availableSpace);

    // Return the smaller of hard cap and available space
    // This ensures we don't over-allocate while allowing more memories when history is short
    const budget = Math.min(hardCap, dynamicBudget);

    logger.debug(
      {
        contextWindowTokens,
        systemPromptBaseTokens,
        currentMessageTokens,
        historyTokens,
        safetyMargin,
        availableSpace,
        hardCap,
        dynamicBudget: budget,
      },
      '[MemoryBudget] Calculated dynamic memory budget'
    );

    return budget;
  }

  /**
   * Count total tokens in conversation history
   *
   * Uses tiktoken (via countTextTokens) on the actual formatted XML for each message.
   * This ensures accurate token counting that matches the exact prompt format.
   *
   * The database tokenCount only counts raw message content, not the XML format,
   * so we always format and count for accuracy.
   *
   * @param rawHistory - Raw conversation history with optional tokenCount
   * @param personalityName - Personality name for formatting (determines speaker name)
   * @returns Total tokens for all history messages (using tiktoken)
   */
  countHistoryTokens(rawHistory: RawHistoryEntry[] | undefined, personalityName: string): number {
    if (!rawHistory || rawHistory.length === 0) {
      return 0;
    }

    let totalTokens = 0;
    for (const entry of rawHistory) {
      // Format the entry as XML (same format used in the actual prompt)
      // Then count tokens with tiktoken for accuracy
      const formattedXml = formatSingleHistoryEntryAsXml(entry, personalityName);
      if (formattedXml.length > 0) {
        totalTokens += countTextTokens(formattedXml);
      }
    }

    return totalTokens;
  }
}
