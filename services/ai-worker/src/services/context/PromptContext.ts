/**
 * Prompt Context Types
 *
 * Defines the data structure passed between ContextWindowManager and PromptBuilder.
 * This encapsulates all the information needed to build a final prompt within token budget.
 */

import type { BaseMessage } from '@langchain/core/messages';

/**
 * Memory document structure (from pgvector)
 */
export interface MemoryDocument {
  pageContent: string;
  metadata?: {
    id?: string;
    createdAt?: string | number;
    score?: number;
    [key: string]: unknown;
  };
}

/**
 * Token budget breakdown
 *
 * Provides transparency into how tokens are allocated across different components
 */
export interface TokenBudget {
  /** Total context window size */
  contextWindowTokens: number;
  /** Tokens used by system prompt */
  systemPromptTokens: number;
  /** Tokens used by current user message */
  currentMessageTokens: number;
  /** Tokens used by relevant memories */
  memoryTokens: number;
  /** Tokens available for conversation history */
  historyBudget: number;
  /** Tokens actually used by selected history */
  historyTokensUsed: number;
}

/**
 * Prompt Context
 *
 * The complete context needed to build a final prompt, with token budget applied.
 * This is the output of ContextWindowManager and input to PromptBuilder.
 */
export interface PromptContext {
  /** The full system prompt (already built) */
  systemPrompt: BaseMessage;

  /** The current user message (already built) */
  currentMessage: BaseMessage;

  /** Selected conversation history (within token budget) */
  selectedHistory: BaseMessage[];

  /** Relevant memories from vector database */
  relevantMemories: MemoryDocument[];

  /** Token budget breakdown */
  tokenBudget: TokenBudget;

  /** Debugging metadata */
  metadata: {
    /** Number of history messages included */
    messagesIncluded: number;
    /** Number of history messages dropped due to budget */
    messagesDropped: number;
    /** Selection strategy used */
    strategy: 'recency';
  };
}
