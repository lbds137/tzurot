/**
 * Budget Allocation Logging
 *
 * The one place the token-allocation summary is emitted. Extracted from
 * `ContentBudgetManager` as a free function rather than a private method: it
 * reads nothing off the instance once `memoryTokensTotal` is passed in
 * pre-computed, so it is a pure formatting/logging step that can be asserted
 * directly instead of only through a full `allocate` call.
 */

import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('ContentBudgetManager');

/** The token-accounting figures one `allocate` call resolved. */
export interface BudgetAllocationLogFields {
  contextWindowTokens: number;
  systemPromptBaseTokens: number;
  currentMessageTokens: number;
  memoryTokensUsed: number;
  /**
   * Tokens the FULL retrieved memory set would have cost, pre-selection —
   * passed in already counted so this function needs no PromptBuilder.
   */
  memoryTokensTotal: number;
  historyBudget: number;
  historyTokensUsed: number;
  messagesDropped: number;
  /**
   * Undefined when cross-channel was disabled this turn; 0 when enabled but
   * no eligible messages (still logged so a "why are my logs showing 0?"
   * debugging session sees the silent-skip case explicitly).
   */
  crossChannelMessagesIncluded: number | undefined;
}

/**
 * Emit the per-turn token-allocation summary, plus a separate debug line when
 * history entries were dropped for budget (kept distinct so the drop is
 * greppable on its own rather than buried in the summary's field set).
 *
 * The logger name stays `ContentBudgetManager` even though the code moved —
 * the log stream is an operational surface, and renaming its source would
 * break every saved query built on it.
 */
export function logBudgetAllocation(fields: BudgetAllocationLogFields): void {
  const { messagesDropped, ...summary } = fields;
  logger.info(summary, 'Token allocation');
  if (messagesDropped > 0) {
    logger.debug({ messagesDropped }, 'Dropped history messages due to token budget');
  }
}
