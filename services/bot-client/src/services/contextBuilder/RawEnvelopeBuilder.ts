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
import {
  apiConversationMessageSchema,
  type AttachmentMetadata,
  type ConversationMessage,
  type GuildMemberInfo,
  type RawAssemblyInputs,
  type RawDiscordUser,
  type ReferencedMessage,
  type RawMentionedChannel,
  type RawMentionedRole,
} from '@tzurot/common-types';
import type { z } from 'zod';
import type { ExtendedContextUser, FetchResult } from '../channelFetcher/types.js';
import { VoiceMessageProcessor } from '../../processors/VoiceMessageProcessor.js';
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
 * Assemble the raw envelope. `rawMessageContent` is Discord's
 * message.content VERBATIM (ground truth — empty for voice and forwarded
 * triggers); any bot-side STT transcript rides the dedicated
 * rawRoutingTranscript field instead, telemetry-only.
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
  return {
    rawMessageContent: message.content,
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
      message.mentions.users.size > 0
        ? [...message.mentions.users.values()].map(u => ({
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
    knownChannelEnvironments: buildKnownChannelEnvironments(message.client),
  };
}
