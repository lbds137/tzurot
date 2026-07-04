/**
 * Raw assembly envelope construction.
 *
 * bot-client attaches these raw Discord-origin assembly inputs to every job;
 * ai-worker's ContextAssembler re-derives the whole message context from them.
 * Everything here is Discord-origin or pure mapping — no DB.
 *
 * This module's output IS the thin-envelope payload: the re-derivable assembled
 * fields don't ship, so this is the job's sole context source.
 */

import type { Message } from 'discord.js';
import { type ConversationMessage } from '@tzurot/common-types/types/conversationMessage';
import {
  type AttachmentMetadata,
  type GuildMemberInfo,
} from '@tzurot/common-types/types/schemas/discord';
import {
  type apiConversationMessageSchema,
  type ReferencedMessage,
} from '@tzurot/common-types/types/schemas/message';
import {
  type RawAssemblyInputs,
  type RawDiscordUser,
  type RawMentionedChannel,
  type RawMentionedRole,
} from '@tzurot/common-types/types/schemas/rawEnvelope';
import type { z } from 'zod';
import type { ExtendedContextUser, FetchResult } from '../channelFetcher/types.js';
import { VoiceMessageProcessor } from '../../processors/VoiceMessageProcessor.js';
import { getEffectiveContent } from '../../utils/forwardedMessageUtils.js';
import { buildKnownChannelEnvironments } from '../CrossChannelHistoryFetcher.js';

/** The pre-resolution extended-context snapshot threaded out of the fetch. */
export interface RawExtendedContextSnapshot {
  messages: ConversationMessage[];
  extendedContextUsers: ExtendedContextUser[];
  reactorUsers: ExtendedContextUser[];
  /** Pre-remap guild info, still keyed `discord:<authorId>`. */
  participantGuildInfo?: Record<string, GuildMemberInfo>;
  /** Uncapped extended-context image list (each carries sourceDiscordMessageId). */
  imageAttachments?: AttachmentMetadata[];
  /** Extended-context voice attachments the bot couldn't transcribe at fetch time
   * (each carries sourceDiscordMessageId); the worker re-resolves them. */
  voiceAttachments?: AttachmentMetadata[];
}

/**
 * Capture the raw extended-context snapshot from a fetch result. Must be
 * called BEFORE resolveExtendedContextPersonaIds, which mutates the fetched
 * messages in place (placeholder personaIds → UUIDs) AND remaps the
 * participantGuildInfo keys — the worker-side assembler needs the
 * pre-resolution shape to re-run its own batch upsert + persona resolution.
 */
export function captureRawExtendedContext(
  fetchResult: Pick<
    FetchResult,
    | 'messages'
    | 'extendedContextUsers'
    | 'reactorUsers'
    | 'participantGuildInfo'
    | 'imageAttachments'
    | 'voiceAttachments'
  >
): RawExtendedContextSnapshot {
  return {
    // Messages are deep-cloned because resolveExtendedContextPersonaIds
    // rewrites msg.personaId in place; the guild map is deep-cloned because
    // the same resolution remaps its keys in place. The user and attachment
    // arrays only need shallow copies — resolution reads them but never
    // mutates the objects. If that ever changes, upgrade to structuredClone.
    messages: structuredClone(fetchResult.messages),
    extendedContextUsers: [...(fetchResult.extendedContextUsers ?? [])],
    reactorUsers: [...(fetchResult.reactorUsers ?? [])],
    participantGuildInfo:
      fetchResult.participantGuildInfo !== undefined
        ? structuredClone(fetchResult.participantGuildInfo)
        : undefined,
    imageAttachments:
      fetchResult.imageAttachments !== undefined ? [...fetchResult.imageAttachments] : undefined,
    voiceAttachments:
      fetchResult.voiceAttachments !== undefined ? [...fetchResult.voiceAttachments] : undefined,
  };
}

/** Map a locally-observed Discord user to the raw-envelope wire shape. */
export function toRawDiscordUser(u: ExtendedContextUser): RawDiscordUser {
  return {
    discordId: u.discordId,
    username: u.username,
    displayName: u.displayName ?? u.username,
    ...(u.isBot && { isBot: true }),
  };
}

/**
 * The wire (API) serialization of a ConversationMessage — derived from the
 * schema so the type cannot drift from what the worker validates against.
 */
export type ApiConversationMessage = z.infer<typeof apiConversationMessageSchema>;

/**
 * Serialize a ConversationMessage to the wire (API) shape. Shared by the
 * assembled conversationHistory and the raw-envelope extended-context
 * snapshot so the two serializations cannot drift.
 */
export function toApiConversationMessage(msg: ConversationMessage): ApiConversationMessage {
  return {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    tokenCount: msg.tokenCount, // Pre-computed with tiktoken at message save time
    createdAt: msg.createdAt.toISOString(),
    isForwarded: msg.isForwarded, // For XML attribute (forwarded="true")
    personaId: msg.personaId,
    personaName: msg.personaName,
    discordUsername: msg.discordUsername, // For collision detection in prompt building
    discordMessageId: msg.discordMessageId, // For quote deduplication in prompt building
    // AI personality info for multi-AI channel attribution
    // Allows correct attribution when multiple AI personalities respond in the same channel
    personalityId: msg.personalityId,
    personalityName: msg.personalityName,
    messageMetadata: msg.messageMetadata,
  };
}

/**
 * Assemble the raw envelope. `rawMessageContent` is the message's EFFECTIVE
 * text (via getEffectiveContent): message.content for normal triggers, and the
 * forward snapshot text for forwarded triggers — the worker re-derives the
 * current turn solely from this field, so a forward's snapshot text MUST land
 * here or the turn is empty (the "Hello"-placeholder content-loss bug). Empty
 * for voice triggers, where the worker re-transcribes the shipped attachment
 * itself (the bot-side STT transcript rides rawRoutingTranscript, telemetry-only).
 */
export function buildRawAssemblyInputs(
  message: Message,
  raw: RawExtendedContextSnapshot | undefined,
  refs?: {
    rawReferencedMessages?: ReferencedMessage[];
    rawMentionedChannels?: RawMentionedChannel[];
    rawMentionedRoles?: RawMentionedRole[];
    /** The author's effective display name from buildContext step 1. */
    rawAuthorDisplayName?: string;
    /** The triggering user's guild member info (raw form of activePersonaGuildInfo). */
    rawActiveGuildMemberInfo?: GuildMemberInfo;
  }
): RawAssemblyInputs {
  // Wrapper-only mentions: message.mentions reflects the trigger message's OWN
  // parsed mentions, which are empty for a forward — the snapshot's <@id> tokens
  // aren't here. Resolving forward-snapshot user-mentions is a tracked follow-up
  // (cold/follow-ups.md): non-trivial because MessageSnapshot strips mention
  // metadata, so it needs regex + a per-id fetch. The forward's text still reaches
  // the AI via rawMessageContent; only embedded <@id> name-substitution degrades.
  // eslint-disable-next-line no-restricted-syntax -- wrapper-only mentions; forward-snapshot <@id> resolution is a tracked follow-up (cold/follow-ups.md)
  const wrapperMentionedUsers = message.mentions.users;
  return {
    // getEffectiveContent yields message.content for normal triggers and the
    // forward snapshot text for forwarded ones; a bare message.content is empty
    // for a forward, which drops the whole forwarded message from the prompt.
    rawMessageContent: getEffectiveContent(message),
    rawRoutingTranscript: VoiceMessageProcessor.getVoiceTranscript(message),
    rawAuthorDisplayName: refs?.rawAuthorDisplayName,
    // No clone needed (unlike the participant guild map): this scalar is a
    // freshly-built extractGuildMemberInfo result with no in-place mutation
    // path — nothing downstream remaps or edits the active speaker's roles.
    rawActiveGuildMemberInfo: refs?.rawActiveGuildMemberInfo,
    rawReferencedMessages: refs?.rawReferencedMessages,
    rawMentionedChannels: refs?.rawMentionedChannels,
    rawMentionedRoles: refs?.rawMentionedRoles,
    rawMentionedUsers:
      wrapperMentionedUsers.size > 0
        ? [...wrapperMentionedUsers.values()].map(u => ({
            discordId: u.id,
            username: u.username,
            displayName: u.globalName ?? u.username,
            ...(u.bot && { isBot: true }),
          }))
        : undefined,
    rawExtendedContextMessages: raw?.messages.map(toApiConversationMessage),
    rawExtendedContextUsers: raw?.extendedContextUsers.map(toRawDiscordUser),
    rawReactorUsers: raw?.reactorUsers.map(toRawDiscordUser),
    rawParticipantGuildInfo: raw?.participantGuildInfo,
    rawExtendedContextImageAttachments: raw?.imageAttachments,
    rawExtendedContextVoiceMessages: raw?.voiceAttachments,
    knownChannelEnvironments: buildKnownChannelEnvironments(message.client),
  };
}
