/**
 * Reference and mention extraction for MessageContextBuilder.
 *
 * Extracts referenced messages (from replies and message links) and resolves
 * @mentions to persona names for the AI context.
 */

import type { Message } from 'discord.js';
import {
  createLogger,
  MessageRole,
  CONTENT_TYPES,
  INTERVALS,
  MESSAGE_LIMITS,
} from '@tzurot/common-types';
import type {
  PrismaClient,
  LoadedPersonality,
  MentionedPersona,
  ReferencedChannel,
  ReferencedMessage,
  ConversationMessage,
} from '@tzurot/common-types';
import { MessageReferenceExtractor } from '../../handlers/MessageReferenceExtractor.js';
import type { MentionResolver } from '../MentionResolver.js';

const logger = createLogger('MessageContextBuilder');

/** Result of extracting references and resolving mentions */
export interface ReferencesAndMentionsResult {
  messageContent: string;
  referencedMessages: ReferencedMessage[];
  mentionedPersonas?: MentionedPersona[];
  referencedChannels?: ReferencedChannel[];
}

/** Options for reference extraction */
export interface ExtractReferencesOptions {
  prisma: PrismaClient;
  mentionResolver: MentionResolver;
  message: Message;
  content: string;
  personality: LoadedPersonality;
  history: ConversationMessage[];
  isWeighInMode?: boolean;
}

/**
 * Extract referenced messages and resolve mentions.
 */
// eslint-disable-next-line max-lines-per-function -- Cohesive extraction workflow with debug logging
export async function extractReferencesAndMentions(
  opts: ExtractReferencesOptions
): Promise<ReferencesAndMentionsResult> {
  const {
    prisma,
    mentionResolver,
    message,
    content,
    personality,
    history,
    isWeighInMode = false,
  } = opts;
  // In weigh-in mode, the anchor message is the latest channel message (not from the invoking user).
  // Its reply references are irrelevant to the weigh-in prompt — skip extraction entirely.
  if (isWeighInMode) {
    return {
      messageContent: content,
      referencedMessages: [],
      mentionedPersonas: undefined,
      referencedChannels: undefined,
    };
  }

  const conversationHistoryMessageIds = history
    .flatMap(msg => msg.discordMessageId ?? [])
    .filter((id): id is string => id !== undefined && id !== null);
  const conversationHistoryTimestamps = history.map(msg => msg.createdAt);

  // Debug logging for voice message replies
  if (
    message.attachments.some(
      a =>
        (a.contentType?.startsWith(CONTENT_TYPES.AUDIO_PREFIX) ?? false) ||
        (a.duration !== null && a.duration !== undefined)
    )
  ) {
    const mostRecentAssistant = history.filter(m => m.role === MessageRole.Assistant).slice(-1)[0];
    const mostRecentAssistantIds = mostRecentAssistant?.discordMessageId ?? [];

    logger.debug(
      {
        isReply: message.reference !== null,
        replyToMessageId: message.reference?.messageId,
        messageContent: content ?? '(empty - voice only)',
        historyCount: history.length,
        replyMatchesRecentAssistant: mostRecentAssistantIds.includes(
          message.reference?.messageId ?? ''
        ),
      },
      '[MessageContextBuilder] Processing voice message reply - deduplication data'
    );
  }

  // Extract referenced messages
  logger.debug('[MessageContextBuilder] Extracting referenced messages with deduplication');
  const referenceExtractor = new MessageReferenceExtractor({
    prisma,
    maxReferences: MESSAGE_LIMITS.MAX_REFERENCED_MESSAGES,
    embedProcessingDelayMs: INTERVALS.EMBED_PROCESSING_DELAY,
    conversationHistoryMessageIds,
    conversationHistoryTimestamps,
  });

  const { references: referencedMessages, updatedContent } =
    await referenceExtractor.extractReferencesWithReplacement(message);

  if (referencedMessages.length > 0) {
    logger.info(
      {
        count: referencedMessages.length,
        referenceNumbers: referencedMessages.map(r => r.referenceNumber),
      },
      '[MessageContextBuilder] Extracted referenced messages (after deduplication)'
    );
  }

  // Preserve the content parameter as authoritative message content.
  // Apply link replacements from reference extraction.
  let messageContent = content ?? '[no text content]';
  if (updatedContent !== undefined) {
    messageContent = updatedContent;
  }

  // Resolve all mentions
  const mentionResult = await mentionResolver.resolveAllMentions(
    messageContent,
    message,
    personality.id
  );
  messageContent = mentionResult.processedContent;

  let mentionedPersonas: MentionedPersona[] | undefined;
  let referencedChannels: ReferencedChannel[] | undefined;

  if (mentionResult.mentionedUsers.length > 0) {
    mentionedPersonas = mentionResult.mentionedUsers.map(u => ({
      personaId: u.personaId,
      personaName: u.personaName,
    }));
    logger.debug(
      { mentionedCount: mentionedPersonas.length },
      '[MessageContextBuilder] Resolved user mentions'
    );
  }

  if (mentionResult.mentionedChannels.length > 0) {
    referencedChannels = mentionResult.mentionedChannels.map(c => ({
      channelId: c.channelId,
      channelName: c.channelName,
      topic: c.topic,
      guildId: c.guildId,
    }));
    logger.debug(
      { channelCount: referencedChannels.length },
      '[MessageContextBuilder] Resolved channel mentions for LTM scoping'
    );
  }

  return { messageContent, referencedMessages, mentionedPersonas, referencedChannels };
}
