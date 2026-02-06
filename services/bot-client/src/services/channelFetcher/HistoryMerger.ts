/**
 * History Merger
 *
 * Functions for merging extended context messages with database conversation history.
 * Extracted from DiscordChannelFetcher.ts for better modularity.
 */

import { createLogger, type ConversationMessage } from '@tzurot/common-types';

const logger = createLogger('HistoryMerger');

/**
 * Recover empty DB message content from extended context.
 * Handles cases where voice messages were stored but content was cleared by a bug.
 */
export function recoverEmptyDbContent(
  dbHistory: ConversationMessage[],
  extendedMessageMap: Map<string, ConversationMessage>
): number {
  let recoveredCount = 0;
  for (const dbMsg of dbHistory) {
    const dbContent = dbMsg.content ?? '';
    if (dbContent.length > 0) {
      continue;
    } // Has content, no recovery needed

    const msgId = dbMsg.discordMessageId[0];
    if (msgId === undefined) {
      continue;
    } // No message ID to look up

    const extendedMsg = extendedMessageMap.get(msgId);
    const extendedContent = extendedMsg?.content ?? '';
    if (extendedContent.length === 0) {
      continue;
    } // Extended context also empty

    // Extended context has content (likely from bot transcript fallback) - use it
    dbMsg.content = extendedContent;
    // Also copy over voice transcripts if available
    if (extendedMsg?.messageMetadata?.voiceTranscripts !== undefined) {
      dbMsg.messageMetadata = dbMsg.messageMetadata ?? {};
      dbMsg.messageMetadata.voiceTranscripts = extendedMsg.messageMetadata.voiceTranscripts;
    }
    recoveredCount++;
    logger.info(
      { messageId: msgId, contentLength: extendedContent.length },
      '[HistoryMerger] Recovered empty DB message content from extended context'
    );
  }
  return recoveredCount;
}

/**
 * Enrich DB messages with extended context metadata (reactions, embeds).
 * Reactions are only available from live Discord fetch, not stored in DB.
 */
export function enrichDbMessagesWithExtendedMetadata(
  dbHistory: ConversationMessage[],
  extendedMessageMap: Map<string, ConversationMessage>
): number {
  let reactionsEnrichedCount = 0;
  for (const dbMsg of dbHistory) {
    const msgId = dbMsg.discordMessageId[0];
    if (msgId === undefined) {
      continue;
    }

    const extendedMsg = extendedMessageMap.get(msgId);
    if (extendedMsg === undefined) {
      continue;
    }

    // Copy reactions from extended context to DB message
    if (extendedMsg.messageMetadata?.reactions !== undefined) {
      dbMsg.messageMetadata = dbMsg.messageMetadata ?? {};
      dbMsg.messageMetadata.reactions = extendedMsg.messageMetadata.reactions;
      reactionsEnrichedCount++;
    }

    // Copy embeds from extended context if not already present
    if (
      extendedMsg.messageMetadata?.embedsXml !== undefined &&
      dbMsg.messageMetadata?.embedsXml === undefined
    ) {
      dbMsg.messageMetadata = dbMsg.messageMetadata ?? {};
      dbMsg.messageMetadata.embedsXml = extendedMsg.messageMetadata.embedsXml;
    }

    // Copy isForwarded flag from extended context (not stored in DB)
    if (extendedMsg.isForwarded === true && dbMsg.isForwarded !== true) {
      dbMsg.isForwarded = true;
    }
  }

  if (reactionsEnrichedCount > 0) {
    logger.debug(
      { reactionsEnrichedCount },
      '[HistoryMerger] Enriched DB messages with reactions from extended context'
    );
  }
  return reactionsEnrichedCount;
}

/**
 * Merge extended context messages with database conversation history
 *
 * This handles deduplication when the same message appears in both sources.
 * Priority: DB history (more complete metadata) > Discord fetch
 *
 * @param extendedMessages - Messages from Discord channel fetch
 * @param dbHistory - Messages from database conversation history (chronological order)
 * @returns Merged and deduplicated message list in chronological order (oldest first)
 */
export function mergeWithHistory(
  extendedMessages: ConversationMessage[],
  dbHistory: ConversationMessage[]
): ConversationMessage[] {
  // Build map of message IDs to DB messages for deduplication and content comparison
  const dbMessageMap = new Map<string, ConversationMessage>();
  for (const msg of dbHistory) {
    for (const id of msg.discordMessageId) {
      dbMessageMap.set(id, msg);
    }
  }

  // Build map of extended context messages by ID for content recovery
  const extendedMessageMap = new Map<string, ConversationMessage>();
  for (const msg of extendedMessages) {
    const msgId = msg.discordMessageId[0];
    if (msgId !== undefined) {
      extendedMessageMap.set(msgId, msg);
    }
  }

  // Recover empty DB content from extended context
  const recoveredCount = recoverEmptyDbContent(dbHistory, extendedMessageMap);

  // Enrich DB messages with extended context metadata (reactions, embeds)
  enrichDbMessagesWithExtendedMetadata(dbHistory, extendedMessageMap);

  // Filter extended messages to exclude those already in DB history
  const uniqueExtendedMessages = extendedMessages.filter(msg => {
    const msgId = msg.discordMessageId[0];
    return !dbMessageMap.has(msgId);
  });

  logger.debug(
    {
      extendedCount: extendedMessages.length,
      dbHistoryCount: dbHistory.length,
      uniqueExtendedCount: uniqueExtendedMessages.length,
      deduplicatedCount: extendedMessages.length - uniqueExtendedMessages.length,
      recoveredCount,
    },
    '[HistoryMerger] Merged extended context with DB history'
  );

  // Combine: DB history (chronological, richer metadata) + unique extended messages
  const merged = [...dbHistory, ...uniqueExtendedMessages];

  // Sort by timestamp ascending (oldest first = chronological order)
  // This ensures newest messages appear last in the prompt, getting
  // more attention from LLMs due to recency bias in attention mechanisms
  merged.sort((a, b) => {
    const timeA =
      a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
    const timeB =
      b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime();
    return timeA - timeB;
  });

  return merged;
}
