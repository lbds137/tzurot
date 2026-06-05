/**
 * Context write path (Phase 2.5).
 *
 * Everything governing WHO owns bot-client's Discord-event conversation
 * writes (assistant persist, edit/delete sync) lives here: the CONTEXT_MODE
 * toggle, the authoritative gateway-write helpers used in service mode, and
 * the legacy-mode dual-write mirrors. This module is deleted (along with the
 * legacy path and both flags) in 2.5d once service mode has burned in.
 */

import { createLogger, SYNC_LIMITS, type MessageMetadata } from '@tzurot/common-types';
import { getServiceClient } from './gatewayClients.js';

const logger = createLogger('contextWritePath');

// CONTEXT_MODE governs who owns bot-client's conversation writes:
//   legacy  (default) — local Prisma writes are authoritative; when
//                       CONTEXT_DUAL_WRITE=true they're ALSO mirrored to the
//                       gateway endpoints for log-only comparison (burn-in).
//   service           — the gateway endpoints ARE the write path; bot-client
//                       performs no local Prisma conversation writes for the
//                       Discord-event surface (assistant persist, edit/delete
//                       sync). Rollback = env flip + restart.
//
// The authoritative and mirror paths share the payload builders below so the
// wire shape cannot drift between them.

export type ContextMode = 'legacy' | 'service';

/** Anything other than the exact string 'service' resolves to legacy. */
export function getContextMode(env: NodeJS.ProcessEnv = process.env): ContextMode {
  return env.CONTEXT_MODE === 'service' ? 'service' : 'legacy';
}

export function isContextDualWriteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CONTEXT_DUAL_WRITE === 'true';
}

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
 * Persist the trigger user message via the gateway endpoint — the
 * AUTHORITATIVE write in service mode, called synchronously BEFORE job
 * submission so the next message's history query always sees this row.
 * Throws on failure, matching the legacy local write's error semantics.
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

/**
 * Mirror a just-persisted user message to the gateway endpoint (legacy-mode
 * burn-in). Fire-and-forget: never throws. Expected outcome is
 * `created: false, matched: true`; anything else logs as divergence.
 */
export async function dualWritePersistUserMessage(params: UserMessageWriteParams): Promise<void> {
  if (!isContextDualWriteEnabled()) {
    return;
  }
  try {
    const result = await getServiceClient().persistUserMessage(buildUserMessagePayload(params));
    if (!result.ok) {
      logger.warn(
        { status: result.status, channelId: params.channelId },
        'User-message dual-write request failed'
      );
      return;
    }
    if (result.data.created || result.data.matched === false) {
      logger.warn(
        { ...result.data, channelId: params.channelId },
        'User-message dual-write DIVERGED from local write'
      );
    } else {
      logger.debug({ id: result.data.id }, 'User-message dual-write matched');
    }
  } catch (error) {
    logger.warn({ err: error, channelId: params.channelId }, 'User-message dual-write error');
  }
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
 * Persist an assistant message via the gateway endpoint — the AUTHORITATIVE
 * write in service mode. Throws on failure, matching the error semantics of
 * the legacy local Prisma write (callers own the catch).
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
    // In service mode nothing else writes this row — created=false means an
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
 * Run edit/delete sync via the gateway endpoint — the AUTHORITATIVE sync in
 * service mode. Never throws (sync is opportunistic, same contract as the
 * legacy runSync path); returns zero counts on failure.
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

/**
 * Mirror a just-persisted assistant message to the gateway endpoint.
 * Fire-and-forget: never throws. Expected outcome is `created: false,
 * matched: true` (the local write landed first with identical data);
 * anything else is logged as a divergence signal.
 */
export async function dualWritePersistAssistantMessage(
  params: AssistantMessageWriteParams
): Promise<void> {
  if (!isContextDualWriteEnabled()) {
    return;
  }
  try {
    const result = await getServiceClient().persistAssistantMessage(
      buildAssistantMessagePayload(params)
    );
    if (!result.ok) {
      logger.warn(
        { status: result.status, channelId: params.channelId },
        'Assistant-message dual-write request failed'
      );
      return;
    }
    if (result.data.created || result.data.matched === false) {
      // created=true means the local write is missing from the DB (or wrote a
      // different deterministic id); matched=false means the row content or
      // chunk IDs differ. Both are burn-in divergence signals.
      logger.warn(
        { ...result.data, channelId: params.channelId },
        'Assistant-message dual-write DIVERGED from local write'
      );
    } else {
      logger.debug({ id: result.data.id }, 'Assistant-message dual-write matched');
    }
  } catch (error) {
    logger.warn({ err: error, channelId: params.channelId }, 'Assistant-message dual-write error');
  }
}

/**
 * Mirror an already-applied edit/delete sync snapshot to the gateway
 * endpoint. Fire-and-forget: never throws. The local sync ran first, so the
 * gateway should find zero remaining work — nonzero counts mean the two
 * paths disagreed.
 */
export async function dualWriteConversationSync(
  channelId: string,
  personalityId: string,
  observedMessages: ObservedSyncSnapshotMessage[]
): Promise<void> {
  if (!isContextDualWriteEnabled() || observedMessages.length === 0) {
    return;
  }
  try {
    const result = await getServiceClient().syncConversation(
      buildSyncSnapshotPayload(channelId, personalityId, observedMessages)
    );
    if (!result.ok) {
      logger.warn(
        { status: result.status, channelId },
        'Conversation-sync dual-write request failed'
      );
      return;
    }
    if (result.data.updated > 0 || result.data.deleted > 0) {
      logger.warn(
        { ...result.data, channelId, personalityId },
        'Conversation-sync dual-write found work the local sync missed (DIVERGED)'
      );
    } else {
      logger.debug({ channelId }, 'Conversation-sync dual-write matched (zero work)');
    }
  } catch (error) {
    logger.warn({ err: error, channelId }, 'Conversation-sync dual-write error');
  }
}
