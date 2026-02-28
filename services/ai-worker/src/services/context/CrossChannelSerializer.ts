/**
 * Cross-Channel History Serializer
 *
 * Handles token budget allocation and XML serialization for cross-channel
 * conversation history. Extracted from ContextWindowManager to stay under
 * max-lines limit.
 */

import {
  countTextTokens,
  createLogger,
  formatLocationAsXml,
  type CrossChannelHistoryGroupEntry,
} from '@tzurot/common-types';
import {
  formatCrossChannelHistoryAsXml,
  getFormattedMessageCharLength,
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
  groups: CrossChannelHistoryGroupEntry[],
  personalityName: string,
  tokenBudget: number
): { xml: string; messagesIncluded: number } {
  if (groups.length === 0 || tokenBudget <= 0) {
    return { xml: '', messagesIncluded: 0 };
  }

  const selectedGroups: CrossChannelHistoryGroupEntry[] = [];
  let tokensUsed = 0;

  // Account for <prior_conversations> wrapper overhead
  const wrapperOverhead = countTextTokens('<prior_conversations>\n</prior_conversations>');
  const availableBudget = tokenBudget - wrapperOverhead;

  if (availableBudget <= 0) {
    return { xml: '', messagesIncluded: 0 };
  }

  for (const group of groups) {
    // Estimate per-channel overhead (location block + channel_history tags)
    const channelOverhead = estimateChannelOverhead(group);

    const selectedMessages: typeof group.messages = [];
    let groupTokens = channelOverhead;

    // Recency strategy: iterate newest-first to prioritize recent messages when
    // budget is tight (matching current-channel selection in selectCurrentChannelEntries).
    // Messages arrive in chronological order (oldest first) from getCrossChannelHistory,
    // so we iterate in reverse and then restore chronological order for XML output.
    const messages = group.messages;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      // Use cached tokenCount when available, fall back to chars/4 approximation
      const msgTokens =
        msg.tokenCount ?? Math.ceil(getFormattedMessageCharLength(msg, personalityName) / 4);
      if (tokensUsed + groupTokens + msgTokens > availableBudget) {
        // Contiguous tail: once we hit a message that doesn't fit, stop selecting from
        // this group entirely. Skipping to older messages would create narrative gaps.
        break;
      }
      selectedMessages.unshift(msg); // Restore chronological order
      groupTokens += msgTokens;
    }

    // Groups where no messages fit (e.g., overhead alone exceeds remaining budget) are
    // skipped, but the loop continues — a later group with smaller messages may still
    // fit within the remaining budget.
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
    return { xml: '', messagesIncluded: 0 };
  }

  const messagesIncluded = selectedGroups.reduce((sum, g) => sum + g.messages.length, 0);
  const xml = formatCrossChannelHistoryAsXml(selectedGroups, personalityName);
  logger.debug(
    { groupCount: selectedGroups.length, messagesIncluded, tokensUsed, budget: tokenBudget },
    '[CrossChannelSerializer] Serialized channel groups'
  );
  return { xml, messagesIncluded };
}

/**
 * Estimate the token overhead for a channel's wrapper (location block + tags).
 * Only counts `<channel_history>` + `<location>` tags — NOT the `<prior_conversations>` wrapper,
 * which is already accounted for by `wrapperOverhead` in the caller.
 */
function estimateChannelOverhead(group: CrossChannelHistoryGroupEntry): number {
  const locationXml = formatLocationAsXml(group.channelEnvironment);
  const channelTags = '<channel_history>\n</channel_history>';
  // Speed tradeoff: chars/4 approximation here (called per-group) vs countTextTokens
  // for wrapperOverhead (called once). The ~1 token per 4 chars estimate is conservative
  // for XML/English text — slight overcount is fine since the final output is re-measured.
  return Math.ceil((locationXml.length + channelTags.length) / 4);
}
