/**
 * Cross-Channel History Serializer
 *
 * Handles token budget allocation and XML serialization for cross-channel
 * conversation history. Extracted from ContextWindowManager to stay under
 * max-lines limit.
 */

import { countTextTokens, createLogger, formatLocationAsXml } from '@tzurot/common-types';
import {
  formatCrossChannelHistoryAsXml,
  getFormattedMessageCharLength,
  type CrossChannelGroup,
} from '../../jobs/utils/conversationUtils.js';

const logger = createLogger('CrossChannelSerializer');

/**
 * Serialize cross-channel history groups within a token budget.
 * Iterates groups (most recent channel first), selecting messages that fit.
 *
 * @param groups - Cross-channel groups ordered by most recent channel first
 * @param personalityName - AI personality name for message formatting
 * @param tokenBudget - Maximum tokens available for cross-channel content
 * @returns Serialized XML string, or empty string if nothing fits
 */
export function serializeCrossChannelHistory(
  groups: CrossChannelGroup[],
  personalityName: string,
  tokenBudget: number
): string {
  if (groups.length === 0 || tokenBudget <= 0) {
    return '';
  }

  const selectedGroups: CrossChannelGroup[] = [];
  let tokensUsed = 0;

  // Account for <prior_conversations> wrapper overhead
  const wrapperOverhead = countTextTokens('<prior_conversations>\n</prior_conversations>');
  const availableBudget = tokenBudget - wrapperOverhead;

  if (availableBudget <= 0) {
    return '';
  }

  for (const group of groups) {
    // Estimate per-channel overhead (location block + channel_history tags)
    const channelOverhead = estimateChannelOverhead(group);

    const selectedMessages: typeof group.messages = [];
    let groupTokens = channelOverhead;

    for (const msg of group.messages) {
      // Use cached tokenCount when available, fall back to chars/4 approximation
      const msgTokens =
        msg.tokenCount ?? Math.ceil(getFormattedMessageCharLength(msg, personalityName) / 4);
      if (tokensUsed + groupTokens + msgTokens > availableBudget) {
        break;
      }
      selectedMessages.push(msg);
      groupTokens += msgTokens;
    }

    if (selectedMessages.length > 0) {
      selectedGroups.push({
        channelEnvironment: group.channelEnvironment,
        messages: selectedMessages,
      });
      tokensUsed += groupTokens;
    }

    if (tokensUsed >= availableBudget) {
      break;
    }
  }

  if (selectedGroups.length === 0) {
    return '';
  }

  const result = formatCrossChannelHistoryAsXml(selectedGroups, personalityName);
  logger.info(
    { groupCount: selectedGroups.length, tokensUsed, budget: tokenBudget },
    '[CrossChannelSerializer] Serialized channel groups'
  );
  return result;
}

/**
 * Estimate the token overhead for a channel's wrapper (location block + tags).
 * Only counts `<channel_history>` + `<location>` tags — NOT the `<prior_conversations>` wrapper,
 * which is already accounted for by `wrapperOverhead` in the caller.
 */
function estimateChannelOverhead(group: CrossChannelGroup): number {
  const locationXml = formatLocationAsXml(group.channelEnvironment);
  const channelTags = '<channel_history>\n</channel_history>';
  // chars/4 approximation: ~1 token per 4 chars for XML/English text (conservative estimate)
  return Math.ceil((locationXml.length + channelTags.length) / 4);
}
