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
  type LoadedPersonality,
  type ReferencedMessage,
  type ConversationMessage,
  type RawMentionedChannel,
  type RawMentionedRole,
} from '@tzurot/common-types';
import { MessageReferenceExtractor } from '../../handlers/MessageReferenceExtractor.js';
import type { MentionResolver } from '../MentionResolver.js';

const logger = createLogger('MessageContextBuilder');

/** Result of extracting references and resolving mentions */
export interface ReferencesAndMentionsResult {
  messageContent: string;
  referencedMessages: ReferencedMessage[];
  /**
   * Raw-envelope fields: pre-enrichment reference snapshots plus the
   * guild-cache-resolved channel and role mention data the worker needs to
   * re-run content rewriting.
   */
  rawReferencedMessages?: ReferencedMessage[];
  rawMentionedChannels?: RawMentionedChannel[];
  rawMentionedRoles?: RawMentionedRole[];
}

/** Options for reference extraction */
interface ExtractReferencesOptions {
  mentionResolver: MentionResolver;
  message: Message;
  content: string;
  personality: LoadedPersonality;
  history: ConversationMessage[];
  isWeighInMode?: boolean;
  /** Maximum number of references to extract. Shares budget with maxMessages. */
  maxReferences: number;
}

/**
 * Extract referenced messages and resolve mentions.
 */

export async function extractReferencesAndMentions(
  opts: ExtractReferencesOptions
): Promise<ReferencesAndMentionsResult> {
  const {
    mentionResolver,
    message,
    content,
    personality,
    history,
    isWeighInMode = false,
    maxReferences,
  } = opts;
  // In weigh-in mode, the anchor message is the latest channel message (not from the invoking user).
  // Its reply references are irrelevant to the weigh-in prompt — skip extraction entirely.
  if (isWeighInMode) {
    return {
      messageContent: content,
      referencedMessages: [],
    };
  }

  const conversationHistoryMessageIds = history
    .flatMap(msg => msg.discordMessageId ?? [])
    .filter((id): id is string => id !== undefined && id !== null);
  const conversationHistoryTimestamps = history.map(msg => msg.createdAt);

  logVoiceReplyDiagnostics(message, content, history);

  // Extract referenced messages
  logger.debug('Extracting referenced messages with deduplication');
  const referenceExtractor = new MessageReferenceExtractor({
    maxReferences,
    embedProcessingDelayMs: INTERVALS.EMBED_PROCESSING_DELAY,
    conversationHistoryMessageIds,
    conversationHistoryTimestamps,
  });

  const {
    references: referencedMessages,
    updatedContent,
    rawReferences,
  } = await referenceExtractor.extractReferencesWithReplacement(message, content);

  if (referencedMessages.length > 0) {
    logger.info(
      {
        count: referencedMessages.length,
        referenceNumbers: referencedMessages.map(r => r.referenceNumber),
      },
      'Extracted referenced messages (after deduplication)'
    );
  }

  // Adopt the link-replaced content. updatedContent is `content` (the snapshot
  // text for forwards) with Discord links rewritten to [Reference N], so this no
  // longer clobbers authoritative content with empty top-level message text.
  let messageContent = updatedContent;

  // Resolve all mentions
  const mentionResult = await mentionResolver.resolveAllMentions(
    messageContent,
    message,
    personality.id
  );

  messageContent = mentionResult.processedContent;

  const rawEnvelopeFields = captureRawEnvelopeFields(rawReferences, mentionResult);

  return {
    messageContent,
    referencedMessages,
    ...rawEnvelopeFields,
  };
}

/** Voice-message-reply dedup diagnostics (debug-only). */
function logVoiceReplyDiagnostics(
  message: Message,
  content: string,
  history: ConversationMessage[]
): void {
  const hasVoiceAttachment = message.attachments.some(
    a =>
      (a.contentType?.startsWith(CONTENT_TYPES.AUDIO_PREFIX) ?? false) ||
      (a.duration !== null && a.duration !== undefined)
  );
  if (!hasVoiceAttachment) {
    return;
  }
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

/**
 * Raw-envelope capture: the mention resolver already produced the
 * guild-cache-pure channel/role data — reuse it rather than re-scanning.
 */
type RawEnvelopeFields = Pick<
  ReferencesAndMentionsResult,
  'rawReferencedMessages' | 'rawMentionedChannels' | 'rawMentionedRoles'
>;

function captureRawEnvelopeFields(
  rawReferences: ReferencedMessage[] | undefined,
  mentionResult: Awaited<ReturnType<MentionResolver['resolveAllMentions']>>
): RawEnvelopeFields {
  return {
    // No `?? []` fallback: the extractor always produced an array, and if a
    // future path legitimately passes undefined, ABSENT is the accurate signal
    // to propagate (see schema semantics).
    rawReferencedMessages: rawReferences,
    rawMentionedChannels: mentionResult.mentionedChannels.map(ch => ({
      channelId: ch.channelId,
      channelName: ch.channelName,
      topic: ch.topic,
      guildId: ch.guildId,
    })),
    rawMentionedRoles: mentionResult.mentionedRoles.map(r => ({
      roleId: r.roleId,
      roleName: r.roleName,
      mentionable: r.mentionable,
    })),
  };
}
