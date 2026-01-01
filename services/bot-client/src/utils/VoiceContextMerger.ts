/**
 * Voice Context Merger
 *
 * Merges voice message transcripts with their parent voice messages for cleaner
 * context in extended history. Uses the "Reverse Zipper" algorithm:
 *
 * Since messages are processed newest-first, we encounter transcript replies
 * BEFORE their parent voice messages. We store transcripts in a pending map,
 * then merge them when we find the corresponding voice message.
 *
 * This solves the attribution problem where the LLM might think the bot
 * said the transcript text instead of the original user.
 */

import type { Message, Collection } from 'discord.js';
import { createLogger } from '@tzurot/common-types';

const logger = createLogger('VoiceContextMerger');

/**
 * Result of merging voice context
 */
export interface MergeResult {
  /** Messages with transcripts merged (transcript replies removed) */
  messages: Message[];
  /** Number of voice messages that had transcripts merged */
  mergedCount: number;
  /** Number of voice messages without transcripts */
  unmergedCount: number;
  /** Number of orphan transcripts (voice message not in fetch window) */
  orphanTranscripts: number;
}

/**
 * Pending transcript info stored during the reverse zipper pass
 */
interface PendingTranscript {
  /** The bot's transcript reply message */
  message: Message;
  /** The transcript text content */
  content: string;
  /** ID of the voice message this transcript references */
  voiceMessageId: string;
}

/**
 * Check if a message is a voice message
 */
export function isVoiceMessage(message: Message): boolean {
  // Check for audio attachments (voice messages are audio/ogg)
  for (const attachment of message.attachments.values()) {
    if (
      attachment.contentType?.startsWith('audio/') === true ||
      attachment.duration !== null // Voice messages have duration metadata
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a message is a bot transcript reply to a voice message
 */
export function isTranscriptReply(message: Message, botUserId: string): boolean {
  // Must be from the bot
  if (message.author.id !== botUserId) {
    return false;
  }

  // Must be a reply to another message
  if (message.reference?.messageId === undefined) {
    return false;
  }

  // Must have text content (the transcript)
  if (message.content.length === 0) {
    return false;
  }

  return true;
}

/**
 * Merge voice message transcripts with their parent messages
 *
 * Uses the "Reverse Zipper" algorithm:
 * 1. Process messages newest-first
 * 2. When we see a bot transcript reply, store it in pendingTranscripts
 * 3. When we see a voice message, check if we have a pending transcript for it
 * 4. If found, inject transcript content and mark bot reply for removal
 *
 * @param messages - Discord messages sorted newest-first
 * @param botUserId - The bot's user ID
 * @returns Merged messages with transcripts injected
 */
export function mergeVoiceContext(
  messages: Collection<string, Message> | Message[],
  botUserId: string
): MergeResult {
  // Convert to array if Collection
  const messageArray = Array.isArray(messages) ? messages : [...messages.values()];

  // Sort newest-first (critical for the reverse zipper algorithm)
  const sortedMessages = [...messageArray].sort((a, b) => b.createdTimestamp - a.createdTimestamp);

  // Map to store transcripts waiting for their parent voice message
  // Key: Voice message ID, Value: Pending transcript info
  const pendingTranscripts = new Map<string, PendingTranscript>();

  // Track stats
  let mergedCount = 0;
  let unmergedCount = 0;

  // First pass: identify transcript replies and store them
  for (const msg of sortedMessages) {
    if (isTranscriptReply(msg, botUserId)) {
      const voiceMessageId = msg.reference!.messageId!;
      pendingTranscripts.set(voiceMessageId, {
        message: msg,
        content: msg.content,
        voiceMessageId,
      });
      logger.debug(
        { transcriptId: msg.id, voiceMessageId },
        '[VoiceContextMerger] Found transcript reply'
      );
    }
  }

  // Second pass: process messages and merge transcripts
  const result: Message[] = [];

  for (const msg of sortedMessages) {
    // Skip bot transcript replies for now - we'll add orphans back at the end
    // We only skip if this transcript is in our pending map (it references a voice message)
    if (isTranscriptReply(msg, botUserId)) {
      const voiceMessageId = msg.reference!.messageId!;
      if (pendingTranscripts.has(voiceMessageId)) {
        // Don't add to result yet - wait to see if voice message is found
        continue;
      }
      // Not in pending transcripts (shouldn't happen), add to result
    }

    // Check if this is a voice message with a pending transcript
    if (isVoiceMessage(msg)) {
      const transcript = pendingTranscripts.get(msg.id);
      if (transcript !== undefined) {
        // Inject transcript into message content
        // We create a modified message with the transcript
        injectTranscript(msg, transcript.content);
        mergedCount++;
        // Remove from pending so it won't be treated as orphan
        pendingTranscripts.delete(msg.id);
        logger.debug(
          { voiceMessageId: msg.id, transcriptLength: transcript.content.length },
          '[VoiceContextMerger] Merged transcript into voice message'
        );
      } else {
        unmergedCount++;
        logger.debug(
          { voiceMessageId: msg.id },
          '[VoiceContextMerger] Voice message without transcript'
        );
      }
    }

    result.push(msg);
  }

  // Handle orphan transcripts (voice message was outside fetch window)
  // These are transcripts still in pendingTranscripts because their voice message wasn't found
  const orphanTranscripts = pendingTranscripts.size;
  if (orphanTranscripts > 0) {
    logger.info(
      { count: orphanTranscripts },
      '[VoiceContextMerger] Orphan transcripts (voice message not in fetch window)'
    );
    // Add orphan transcript messages back to result so context isn't lost
    for (const pending of pendingTranscripts.values()) {
      result.push(pending.message);
    }
  }

  logger.info(
    { mergedCount, unmergedCount, orphanTranscripts, totalMessages: result.length },
    '[VoiceContextMerger] Voice context merge complete'
  );

  return {
    messages: result,
    mergedCount,
    unmergedCount,
    orphanTranscripts,
  };
}

/**
 * Inject transcript text into a voice message
 *
 * Modifies the message content to include the transcript with attribution.
 * Note: This mutates the message object.
 */
function injectTranscript(message: Message, transcript: string): void {
  // Format: [Voice transcript]: actual transcript text
  // This clearly attributes the spoken words to the message author
  const authorName =
    message.member?.displayName ??
    message.author.globalName ??
    message.author.username ??
    'Unknown';

  // Replace the message content with the transcript
  // The original attachment info is still in message.attachments if needed
  Object.defineProperty(message, 'content', {
    value: `[Voice message from ${authorName}]: ${transcript}`,
    writable: true,
    configurable: true,
  });
}
