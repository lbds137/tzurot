/**
 * Pure helpers for MultiTagCoordinator. Extracted into a sibling file so
 * the coordinator stays under the 400-line `max-lines` cap and so these
 * projections can be unit-tested independently if desired.
 *
 * - `buildSlotContext`: project a runtime slot + its parent entry into the
 *   shape SlotDeliveryService consumes per delivery call.
 * - `toSnapshot`: project a runtime entry into the Redis-storable snapshot
 *   (drops live objects: message, channel, timer handle, personality
 *   instances). Used by persistence and recovery.
 */

import type { Message } from 'discord.js';
import type { TypingChannel } from '@tzurot/common-types/types/discord-types';
import type { LLMGenerationResult } from '@tzurot/common-types/types/schemas/generation';
import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import type { SlotDeliveryContext } from './SlotDeliveryService.js';
import type { CoordinatorEntrySnapshot } from './MultiTagPersistence.js';
import type { SlotSource } from './SlotResolver.js';

/** Per-slot runtime state. Re-declared here so the helpers can be standalone. */
export interface RuntimeSlot {
  slotIndex: number;
  personality: LoadedPersonality;
  personaId: string;
  source: SlotSource;
  isAutoResponse: boolean;
  jobId: string;
  status: 'pending' | 'completed' | 'errored' | 'timedout';
  result?: LLMGenerationResult;
}

/** Per-fan-out runtime state. Mirrors the coordinator's private type. */
export interface RuntimeEntry {
  groupId: string;
  sourceMessageId: string;
  message: Message;
  channel: TypingChannel;
  guildId: string | null;
  clientId: string | undefined;
  userId: string;
  userMessageTime: Date;
  userMessageContent: string;
  slots: RuntimeSlot[];
  createdAt: number;
  timeoutHandle: NodeJS.Timeout;
  /**
   * Did the resolver's cap drop at least one tagged personality? Set at
   * fan-out start from `StartFanOutInput.truncated`; consumed by
   * `deliverGroup` to append a post-burst notice. Persisted to the
   * snapshot so the notice survives restart/recovery.
   */
  truncated: boolean;
}

/**
 * Build the SlotDeliveryContext for one slot. Pure projection — every field
 * is either constant across the group (channel/guild/clientId/message) or
 * slot-specific (personality/persona/isAutoResponse).
 */
export function buildSlotContext(entry: RuntimeEntry, slot: RuntimeSlot): SlotDeliveryContext {
  return {
    message: entry.message,
    channel: entry.channel,
    guildId: entry.guildId,
    clientId: entry.clientId,
    personality: slot.personality,
    personaId: slot.personaId,
    userMessageContent: entry.userMessageContent,
    userMessageTime: entry.userMessageTime,
    isAutoResponse: slot.isAutoResponse,
    recipientUserId: entry.userId,
  };
}

/** Project the runtime entry into the Redis-storable snapshot. */
export function toSnapshot(entry: RuntimeEntry): CoordinatorEntrySnapshot {
  return {
    groupId: entry.groupId,
    sourceMessageId: entry.sourceMessageId,
    channelId: entry.channel.id,
    guildId: entry.guildId,
    userId: entry.userId,
    userMessageTime: entry.userMessageTime.toISOString(),
    userMessageContent: entry.userMessageContent,
    slots: entry.slots.map(s => ({
      slotIndex: s.slotIndex,
      personalityId: s.personality.id,
      personalitySlug: s.personality.slug,
      // Persist the hot-path-resolved persona so recovery replays the
      // historically-correct attribution instead of re-resolving (which would
      // need Prisma + could attribute to a since-changed current persona).
      personaId: s.personaId,
      source: s.source,
      isAutoResponse: s.isAutoResponse,
      jobId: s.jobId,
      status: s.status,
    })),
    createdAt: entry.createdAt,
    truncated: entry.truncated,
  };
}
