import { type ConversationMessage } from '@tzurot/common-types/types/conversationMessage';
import { type RawAssemblyInputs } from '@tzurot/common-types/types/schemas/rawEnvelope';

/**
 * Normalizes a raw extended-context message (as fetched bot-side) into the
 * internal `ConversationMessage` shape used during assembly. The wire schema
 * leaves several fields optional that the fetcher always populates; this fills
 * the defensive defaults so downstream assembly never has to guard them.
 */
export function fromApiMessage(
  msg: NonNullable<RawAssemblyInputs['rawExtendedContextMessages']>[number],
  channelId: string,
  guildId: string | null
): ConversationMessage {
  return {
    ...msg,
    channelId,
    guildId,
    // id/personaId are schema-optional on the wire but always populated by
    // the bot-side fetcher; '' mirrors the shadow diff's own normalization
    // ('' ids are excluded from id-keyed diffs, personaIds compare via ?? '').
    id: msg.id ?? '',
    personaId: msg.personaId ?? '',
    // Discord messages always carry timestamps; epoch-0 is a defensive
    // fallback that sorts such a row first rather than crashing assembly.
    createdAt: msg.createdAt !== undefined ? new Date(msg.createdAt) : new Date(0),
    discordMessageId: msg.discordMessageId ?? [],
  } satisfies ConversationMessage;
}
