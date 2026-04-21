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
  formatLocationAsXml,
  type CrossChannelHistoryGroupEntry,
  type DiscordEnvironment,
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

/** Pre-compute <current_conversation> wrapper token overhead and location XML. */
function computeCurrentConversationOverhead(environment: DiscordEnvironment): {
  overhead: number;
  locationXml: string;
} {
  const locationXml = formatLocationAsXml(environment);
  const wrapperText = `<current_conversation>\n${locationXml}\n</current_conversation>`;
  return { overhead: countTextTokens(wrapperText), locationXml };
}

/** Wrap current channel XML in <current_conversation> with location, or return as-is. */
function wrapCurrentChannel(currentChannelXml: string, locationXml: string): string {
  if (currentChannelXml.length === 0 || locationXml.length === 0) {
    return currentChannelXml;
  }
  return `<current_conversation>\n${locationXml}\n${currentChannelXml}\n</current_conversation>`;
}

/** Combine cross-channel and current-channel sections (cross-channel first). */
function combineHistorySections(crossChannelXml: string, currentXml: string): string {
  if (crossChannelXml.length > 0 && currentXml.length > 0) {
    return `${crossChannelXml}\n${currentXml}`;
  }
  return crossChannelXml || currentXml;
}

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
    crossChannelGroups?: CrossChannelHistoryGroupEntry[],
    currentEnvironment?: DiscordEnvironment
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

    // Pre-compute <current_conversation> wrapper overhead and location XML.
    // Only applies when both environment and current-channel messages exist.
    const { overhead: currentConversationOverhead, locationXml } =
      currentEnvironment !== undefined && hasCurrentChannel
        ? computeCurrentConversationOverhead(currentEnvironment)
        : { overhead: 0, locationXml: '' };

    // Select current-channel messages within budget, reserving space for the wrapper.
    // Deducting overhead upfront avoids a bounded overrun where selected messages +
    // wrapper could silently exceed historyBudget.
    const adjustedBudget = historyBudget - currentConversationOverhead;
    const { selectedEntries, currentChannelXml, tokensUsed } = hasCurrentChannel
      ? this.selectCurrentChannelEntries(rawHistory, personalityName, adjustedBudget)
      : { selectedEntries: [] as RawHistoryEntry[], currentChannelXml: '', tokensUsed: 0 };

    // Include wrapper overhead in tokens used (only when content exists to wrap)
    const adjustedTokensUsed =
      selectedEntries.length > 0 && currentConversationOverhead > 0
        ? tokensUsed + currentConversationOverhead
        : tokensUsed;

    // Serialize cross-channel history if available and budget remains
    const { crossChannelXml, crossChannelMessagesIncluded, crossTokens } = hasCrossChannel
      ? this.serializeCrossChannel(
          crossChannelGroups,
          personalityName,
          historyBudget,
          adjustedTokensUsed
        )
      : { crossChannelXml: '', crossChannelMessagesIncluded: 0, crossTokens: 0 };

    const actualTokens = adjustedTokensUsed + crossTokens;

    // Wrap current channel in <current_conversation> when environment is available
    const wrappedCurrentXml = wrapCurrentChannel(currentChannelXml, locationXml);

    // Combine: cross-channel before current channel (older context first)
    const serializedHistory = combineHistorySections(crossChannelXml, wrappedCurrentXml);

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
    const budgetAfterOverhead = historyBudget - wrapperOverhead;

    if (budgetAfterOverhead <= 0) {
      return { selectedEntries: [], currentChannelXml: '', tokensUsed: 0 };
    }

    const selectedEntries: RawHistoryEntry[] = [];
    let estimatedTokens = 0;

    for (let i = rawHistory.length - 1; i >= 0; i--) {
      const entry = rawHistory[i];
      const entryTokens =
        entry.tokenCount ?? Math.ceil(getFormattedMessageCharLength(entry, personalityName) / 4);

      if (estimatedTokens + entryTokens > budgetAfterOverhead) {
        logger.debug(
          { wouldUse: estimatedTokens + entryTokens, budgetAfterOverhead },
          'Stopping history selection: would exceed budget'
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
      'Selected history messages'
    );

    return { selectedEntries, currentChannelXml, tokensUsed };
  }

  /** Serialize cross-channel groups within remaining budget, re-measuring actual tokens. */
  private serializeCrossChannel(
    groups: CrossChannelHistoryGroupEntry[],
    personalityName: string,
    historyBudget: number,
    currentChannelTokensUsed: number
  ): { crossChannelXml: string; crossChannelMessagesIncluded: number; crossTokens: number } {
    if (currentChannelTokensUsed >= historyBudget) {
      return { crossChannelXml: '', crossChannelMessagesIncluded: 0, crossTokens: 0 };
    }

    const crossResult = serializeCrossChannelHistory(
      groups,
      personalityName,
      historyBudget - currentChannelTokensUsed
    );

    if (crossResult.xml.length === 0) {
      return { crossChannelXml: '', crossChannelMessagesIncluded: 0, crossTokens: 0 };
    }

    // Re-measure actual tokens; may slightly exceed historyBudget due to char/4
    // approximation in serializeCrossChannelHistory (non-ASCII content like CJK or
    // emoji server names can widen the gap).
    //
    // Design decision: we accept the overrun rather than trimming because:
    // 1. The serializer's own budget check (chars/4) is conservative for ASCII/English,
    //    so overruns only occur with non-ASCII-heavy content and are typically small
    //    (typically <50 tokens for ASCII; CJK-heavy content may be higher).
    // 2. Trimming would require re-serializing all groups (the XML is already built).
    // 3. The model's context limit has a separate safety margin — historyBudget is the
    //    *history slice* of a larger window, not the hard model limit.
    // The >5% info log below provides production visibility for monitoring.
    const crossTokens = countTextTokens(crossResult.xml);
    const totalTokens = currentChannelTokensUsed + crossTokens;
    logger.info(
      {
        crossTokens,
        crossChannelMessagesIncluded: crossResult.messagesIncluded,
        channelCount: groups.length,
      },
      'Added cross-channel history'
    );

    if (totalTokens > historyBudget) {
      const overrun = totalTokens - historyBudget;
      const overrunPercent = historyBudget > 0 ? overrun / historyBudget : 0;
      const logData = { actualTokens: totalTokens, historyBudget, overrun };
      if (overrunPercent > 0.05) {
        logger.info(logData, 'Cross-channel budget overrun >5% (bounded)');
      } else {
        logger.debug(logData, 'Cross-channel budget overrun (bounded)');
      }
    }

    return {
      crossChannelXml: crossResult.xml,
      crossChannelMessagesIncluded: crossResult.messagesIncluded,
      crossTokens,
    };
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
