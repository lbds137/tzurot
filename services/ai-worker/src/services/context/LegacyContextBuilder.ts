/**
 * Legacy Context Builder
 *
 * BaseMessage-based context building flow extracted from ContextWindowManager.
 * This code path is no longer used in production (ContentBudgetManager replaced it)
 * but is preserved for its test coverage of token budget fundamentals.
 *
 * TODO: Remove this file and its tests once ContentBudgetManager tests fully cover
 * the token budget logic tested here.
 */

import type { BaseMessage } from '@langchain/core/messages';
import { countTextTokens, createLogger } from '@tzurot/common-types';
import type { PromptContext, MemoryDocument, TokenBudget } from './PromptContext.js';
import { formatSingleMemory } from '../prompt/MemoryFormatter.js';

const logger = createLogger('LegacyContextBuilder');

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

/**
 * Build a PromptContext with token budget applied.
 * Calculates token budgets and selects history messages that fit within the context window.
 */
export function buildContext(input: ContextWindowInput): PromptContext {
  const tokenBudget = calculateTokenBudget(input);

  const { selectedHistory, historyTokensUsed, messagesIncluded, messagesDropped } =
    selectHistoryWithinBudget(
      input.conversationHistory,
      input.rawConversationHistory,
      tokenBudget.historyBudget
    );

  tokenBudget.historyTokensUsed = historyTokensUsed;

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

function calculateTokenBudget(input: ContextWindowInput): TokenBudget {
  const systemPromptTokens = countMessageTokens(input.systemPrompt);
  const currentMessageTokens = countMessageTokens(input.currentMessage);
  const memoryTokens = countMemoryTokens(input.relevantMemories);
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
    historyTokensUsed: 0,
  };
}

function selectHistoryWithinBudget(
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

  for (let i = conversationHistory.length - 1; i >= 0; i--) {
    const msg = conversationHistory[i];
    const rawMsg = rawHistoryArray[i];
    const msgTokens = rawMsg?.tokenCount ?? countMessageTokens(msg);

    if (historyTokensUsed + msgTokens > historyBudget) {
      logger.debug(
        `[CWM] Stopping history inclusion: would exceed budget (${historyTokensUsed + msgTokens} > ${historyBudget})`
      );
      break;
    }

    selectedHistory.unshift(msg);
    historyTokensUsed += msgTokens;
  }

  return {
    selectedHistory,
    historyTokensUsed,
    messagesIncluded: selectedHistory.length,
    messagesDropped: conversationHistory.length - selectedHistory.length,
  };
}

function countMessageTokens(message: BaseMessage): number {
  const content = message.content;
  if (typeof content === 'string') {
    return countTextTokens(content);
  }
  return countTextTokens(JSON.stringify(content));
}

function countMemoryTokens(memories: MemoryDocument[]): number {
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
