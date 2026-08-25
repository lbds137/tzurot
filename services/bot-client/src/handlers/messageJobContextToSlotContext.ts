/**
 * Project a `MessageJobContext` (what JobTracker stores) into the slot-shaped
 * context `SlotDeliveryService` expects. Pure projection — no side effects.
 *
 * Used by the @mention/reply/auto-response delivery path. Multi-tag fan-out
 * builds equivalent slot contexts directly in MultiTagCoordinator.
 */

import { type MessageJobContext } from '../services/JobTracker.js';
import type { SlotDeliveryContext } from '../services/SlotDeliveryService.js';

export function messageJobContextToSlotContext(jobContext: MessageJobContext): SlotDeliveryContext {
  return {
    message: jobContext.message,
    channel: jobContext.channel,
    guildId: jobContext.guildId,
    clientId: jobContext.clientId,
    personality: jobContext.personality,
    personaId: jobContext.personaId,
    userMessageContent: jobContext.userMessageContent,
    userMessageTime: jobContext.userMessageTime,
    // jobContext.isAutoResponse is optional on the source type but every
    // call site (single-personality, multi-tag) sets it explicitly today.
    // Coerce missing → false; SlotDeliveryContext.isAutoResponse is now
    // non-nullable.
    isAutoResponse: jobContext.isAutoResponse ?? false,
    // discord.js types `author` as non-nullable User on regular Messages,
    // and system messages (which lack author) are filtered upstream by
    // BotMessageFilter. Use optional chaining anyway so tests with minimal
    // Message fixtures don't trip on the access; the empty-string fallback
    // never fires in production (every handled message has an author).
    recipientUserId: jobContext.message.author?.id ?? '',
  };
}
