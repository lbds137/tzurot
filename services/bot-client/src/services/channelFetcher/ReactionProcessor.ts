/**
 * Reaction Processor
 *
 * Functions for extracting and processing reactions from Discord messages.
 * Extracted from DiscordChannelFetcher.ts for better modularity.
 */

import type { Message } from 'discord.js';
import { createLogger, MESSAGE_LIMITS, type MessageReaction } from '@tzurot/common-types';
import type { ConversationMessage } from '@tzurot/common-types';
import type { ExtendedContextUser } from './types.js';
import { collectReactorUsers } from './ParticipantContextCollector.js';

const logger = createLogger('ReactionProcessor');

/**
 * Process reactions from recent messages and attach to ConversationMessages
 *
 * @param sortedMessages - All Discord messages in ascending order (oldest first)
 * @param result - ConversationMessage array to attach reactions to
 * @param messageIdToIndex - Map from Discord message ID to result array index
 * @param existingUserIds - Set of user IDs already in participants (for deduplication)
 * @returns Array of reactor users to add to participant resolution
 */
export async function processReactions(
  sortedMessages: Message[],
  result: ConversationMessage[],
  messageIdToIndex: Map<string, number>,
  existingUserIds: Set<string>
): Promise<ExtendedContextUser[]> {
  // Extract reactions from the last N messages (most recent)
  // sortedMessages is in ascending order (oldest first), so slice from the end
  const reactionMessages = sortedMessages.slice(-MESSAGE_LIMITS.MAX_REACTION_MESSAGES);
  const allReactions: MessageReaction[] = [];

  for (const msg of reactionMessages) {
    // Skip messages with no reactions
    if (msg.reactions.cache.size === 0) {
      continue;
    }

    // Extract reactions from this message
    const reactions = await extractReactions(msg);
    if (reactions.length === 0) {
      continue;
    }

    // Find the corresponding ConversationMessage and add reactions to its metadata
    const msgIndex = messageIdToIndex.get(msg.id);
    if (msgIndex !== undefined) {
      const convMsg = result[msgIndex];
      if (convMsg !== undefined) {
        convMsg.messageMetadata = convMsg.messageMetadata ?? {};
        convMsg.messageMetadata.reactions = reactions;
      }
    }

    // Collect reactions for reactor user extraction
    allReactions.push(...reactions);
  }

  // Collect unique reactor users (dedupe with existing participants)
  const reactorUsers = collectReactorUsers(allReactions, existingUserIds);

  if (allReactions.length > 0) {
    logger.debug(
      {
        reactionMessageCount: reactionMessages.length,
        totalReactions: allReactions.length,
        reactorUserCount: reactorUsers.length,
      },
      '[ReactionProcessor] Extracted reactions from recent messages'
    );
  }

  return reactorUsers;
}

/**
 * Extract reactions from a Discord message
 *
 * Rate-limited to prevent API overload on popular messages:
 * - MAX_REACTIONS_PER_MESSAGE: limits reaction types fetched
 * - MAX_USERS_PER_REACTION: limits users per reaction
 *
 * @param msg - Discord message to extract reactions from
 * @returns Array of reactions with emoji and reactor info
 */
export async function extractReactions(msg: Message): Promise<MessageReaction[]> {
  const reactions: MessageReaction[] = [];

  // Limit number of reaction types to process (rate limiting)
  const reactionValues = [...msg.reactions.cache.values()].slice(
    0,
    MESSAGE_LIMITS.MAX_REACTIONS_PER_MESSAGE
  );

  // Iterate through cached reactions (limited)
  for (const reaction of reactionValues) {
    try {
      // Fetch users who reacted (may require API call)
      // Limit to MAX_USERS_PER_REACTION to prevent context bloat
      const users = await reaction.users.fetch({ limit: MESSAGE_LIMITS.MAX_USERS_PER_REACTION });

      const reactors = users
        .filter(user => !user.bot) // Exclude bot reactions
        .map(user => ({
          personaId: `discord:${user.id}`,
          displayName: user.displayName ?? user.username,
        }));

      if (reactors.length === 0) {
        continue; // Skip reactions with only bot reactors
      }

      // Format emoji string
      // Unicode emojis: use the emoji directly
      // Custom emojis: use :name: format (id is needed for rendering but not context)
      const emoji = reaction.emoji;
      const emojiString = emoji.id !== null ? `:${emoji.name}:` : (emoji.name ?? '');
      const isCustom = emoji.id !== null;

      reactions.push({
        emoji: emojiString,
        isCustom,
        reactors,
      });
    } catch (error) {
      logger.warn(
        { messageId: msg.id, emoji: reaction.emoji.name, error },
        '[ReactionProcessor] Failed to fetch reaction users'
      );
    }
  }

  return reactions;
}
