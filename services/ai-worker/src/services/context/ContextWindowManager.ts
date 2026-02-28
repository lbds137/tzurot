/**
 * Context Window Manager
 *
 * Manages token budgets and selects conversation history that fits within context window.
 * History is serialized as XML inside the system prompt to prevent identity bleeding.
 * Cross-channel history from other channels is included when budget permits.
 */

import {
  countTextTokens,
  createLogger,
  type CrossChannelHistoryGroupEntry,
} from '@tzurot/common-types';
import type { MemoryDocument } from './PromptContext.js';
import {
  type RawHistoryEntry,
  formatConversationHistoryAsXml,
  getFormattedMessageCharLength,
} from '../../jobs/utils/conversationUtils.js';
import { serializeCrossChannelHistory } from './CrossChannelSerializer.js';
import { MemoryBudgetManager, type MemorySelectionResult } from './MemoryBudgetManager.js';

const logger = createLogger('ContextWindowManager');

export class ContextWindowManager {
  private memoryBudgetManager: MemoryBudgetManager;

  constructor(memoryBudgetManager?: MemoryBudgetManager) {
    this.memoryBudgetManager = memoryBudgetManager ?? new MemoryBudgetManager();
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
    crossChannelMessagesIncluded: number;
  } {
    const hasCurrentChannel = rawHistory !== undefined && rawHistory.length > 0;
    const hasCrossChannel = crossChannelGroups !== undefined && crossChannelGroups.length > 0;

    if ((!hasCurrentChannel && !hasCrossChannel) || historyBudget <= 0) {
      return {
        serializedHistory: '',
        historyTokensUsed: 0,
        messagesIncluded: 0,
        messagesDropped: rawHistory?.length ?? 0,
        crossChannelMessagesIncluded: 0,
      };
    }

    // Select current-channel messages within budget
    const { selectedEntries, currentChannelXml, tokensUsed } = hasCurrentChannel
      ? this.selectCurrentChannelEntries(rawHistory, personalityName, historyBudget)
      : { selectedEntries: [] as RawHistoryEntry[], currentChannelXml: '', tokensUsed: 0 };

    let actualTokens = tokensUsed;

    // Serialize cross-channel history if available and budget remains
    let crossChannelXml = '';
    let crossChannelMessagesIncluded = 0;
    if (hasCrossChannel && actualTokens < historyBudget) {
      const crossResult = serializeCrossChannelHistory(
        crossChannelGroups,
        personalityName,
        historyBudget - actualTokens
      );
      crossChannelXml = crossResult.xml;
      crossChannelMessagesIncluded = crossResult.messagesIncluded;

      if (crossChannelXml.length > 0) {
        // Re-measure actual tokens; may slightly exceed historyBudget due to char/4
        // approximation in serializeCrossChannelHistory, but overrun is bounded (XML overhead only).
        const crossTokens = countTextTokens(crossChannelXml);
        actualTokens += crossTokens;
        logger.info(
          { crossTokens, crossChannelMessagesIncluded, channelCount: crossChannelGroups.length },
          '[CWM] Added cross-channel history'
        );
        if (actualTokens > historyBudget) {
          logger.debug(
            { actualTokens, historyBudget, overrun: actualTokens - historyBudget },
            '[CWM] Cross-channel re-measurement exceeded budget estimate (bounded overrun)'
          );
        }
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
      crossChannelMessagesIncluded,
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
