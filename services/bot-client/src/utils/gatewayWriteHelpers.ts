/**
 * Context write path.
 *
 * The gateway-write helpers for bot-client's Discord-event conversation writes
 * (user/assistant persist, edit/delete sync). The gateway endpoints ARE the
 * write path — bot-client performs no local Prisma conversation writes for the
 * Discord-event surface.
 */

import { SYNC_LIMITS } from '@tzurot/common-types/constants/timing';
import { type MessageMetadata } from '@tzurot/common-types/types/schemas/message';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { getServiceClient } from './gatewayClients.js';

const logger = createLogger('gatewayWriteHelpers');

interface AssistantMessageWriteParams {
  channelId: string;
  guildId: string | null;
  personalityId: string;
  personaId: string;
  content: string;
  chunkMessageIds: string[];
  userMessageTime: Date;
}

interface ObservedSyncSnapshotMessage {
  id: string;
  content: string;
  createdAt: Date;
}

interface UserMessageWriteParams {
  channelId: string;
  guildId: string | null;
  personalityId: string;
  personaId: string;
  /** Final content: user text + attachment placeholders, assembled bot-side. */
  content: string;
  discordMessageId: string;
  messageMetadata?: MessageMetadata;
  /** Discord message timestamp — becomes the row's createdAt. */
  messageTime: Date;
}

function buildUserMessagePayload(params: UserMessageWriteParams): {
  channelId: string;
  guildId: string | null;
  personalityId: string;
  personaId: string;
  content: string;
  discordMessageId: string;
  messageMetadata?: MessageMetadata;
  messageTime: string;
} {
  return {
    channelId: params.channelId,
    guildId: params.guildId,
    personalityId: params.personalityId,
    personaId: params.personaId,
    content: params.content,
    discordMessageId: params.discordMessageId,
    ...(params.messageMetadata !== undefined && { messageMetadata: params.messageMetadata }),
    messageTime: params.messageTime.toISOString(),
  };
}

/**
 * Persist the trigger user message via the gateway endpoint — the authoritative
 * write, called synchronously BEFORE job submission so the next message's
 * history query always sees this row. Throws on failure.
 */
export async function persistUserMessageViaGateway(params: UserMessageWriteParams): Promise<void> {
  const result = await getServiceClient().persistUserMessage(buildUserMessagePayload(params));
  if (!result.ok) {
    throw new Error(`User-message persist failed via gateway: ${result.status} ${result.error}`);
  }
  if (result.data.created === false && result.data.matched === false) {
    // Idempotent replay with divergent content — durable row wins; warn only.
    logger.warn(
      { ...result.data, channelId: params.channelId },
      'User-message gateway persist hit an existing row with different content'
    );
    return;
  }
  logger.debug(
    { id: result.data.id, created: result.data.created, channelId: params.channelId },
    'User message persisted via gateway'
  );
}

function buildAssistantMessagePayload(params: AssistantMessageWriteParams): {
  channelId: string;
  guildId: string | null;
  personalityId: string;
  personaId: string;
  content: string;
  chunkMessageIds: string[];
  userMessageTime: string;
} {
  return {
    channelId: params.channelId,
    guildId: params.guildId,
    personalityId: params.personalityId,
    personaId: params.personaId,
    content: params.content,
    chunkMessageIds: params.chunkMessageIds,
    userMessageTime: params.userMessageTime.toISOString(),
  };
}

/**
 * Map an observed snapshot to the wire shape, capped at the schema's
 * MAX_DISCORD_ID_LOOKUP bound. A truncated snapshot makes the gateway's
 * delete pass see fewer messages than were actually observed — false-positive
 * deletions/divergence — so the cap warns loudly if it ever fires.
 */
function buildSyncSnapshotPayload(
  channelId: string,
  personalityId: string,
  observedMessages: ObservedSyncSnapshotMessage[]
): {
  channelId: string;
  personalityId: string;
  observedMessages: { discordMessageId: string; content: string; createdAt: string }[];
} {
  const dropped = observedMessages.length - SYNC_LIMITS.MAX_DISCORD_ID_LOOKUP;
  if (dropped > 0) {
    logger.warn(
      { channelId, dropped, sent: SYNC_LIMITS.MAX_DISCORD_ID_LOOKUP },
      'Conversation-sync snapshot truncated to wire cap; delete detection unreliable for this pass'
    );
  }
  return {
    channelId,
    personalityId,
    observedMessages: observedMessages.slice(0, SYNC_LIMITS.MAX_DISCORD_ID_LOOKUP).map(m => ({
      discordMessageId: m.id,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

/**
 * Persist an assistant message via the gateway endpoint — the authoritative
 * write. Throws on failure; callers own the catch.
 */
export async function persistAssistantMessageViaGateway(
  params: AssistantMessageWriteParams
): Promise<void> {
  const result = await getServiceClient().persistAssistantMessage(
    buildAssistantMessagePayload(params)
  );
  if (!result.ok) {
    throw new Error(
      `Assistant-message persist failed via gateway: ${result.status} ${result.error}`
    );
  }
  if (result.data.created === false && result.data.matched === false) {
    // Nothing else writes this row — created=false means an
    // idempotent replay (re-delivery), and matched=false on a replay means
    // the replayed content differs from what was first persisted. Rare and
    // worth eyes, but the row is already durable, so don't fail the caller.
    logger.warn(
      { ...result.data, channelId: params.channelId },
      'Assistant-message gateway persist hit an existing row with different content'
    );
    return;
  }
  logger.debug(
    { id: result.data.id, created: result.data.created, channelId: params.channelId },
    'Assistant message persisted via gateway'
  );
}

/**
 * Run edit/delete sync via the gateway endpoint — the authoritative sync. Never
 * throws (sync is opportunistic); returns zero counts on failure.
 */
export async function syncConversationViaGateway(
  channelId: string,
  personalityId: string,
  observedMessages: ObservedSyncSnapshotMessage[]
): Promise<{ updated: number; deleted: number }> {
  if (observedMessages.length === 0) {
    return { updated: 0, deleted: 0 };
  }
  try {
    const result = await getServiceClient().syncConversation(
      buildSyncSnapshotPayload(channelId, personalityId, observedMessages)
    );
    if (!result.ok) {
      logger.warn({ status: result.status, channelId }, 'Conversation sync via gateway failed');
      return { updated: 0, deleted: 0 };
    }
    return result.data;
  } catch (error) {
    logger.warn({ err: error, channelId }, 'Conversation sync via gateway error');
    return { updated: 0, deleted: 0 };
  }
}
