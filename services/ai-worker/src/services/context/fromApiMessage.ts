import { type ConversationMessage } from '@tzurot/common-types/types/conversationMessage';
import { type RawAssemblyInputs } from '@tzurot/common-types/types/schemas/rawEnvelope';

/**
 * Normalizes a raw extended-context message (as fetched bot-side) into the
 * internal `ConversationMessage` shape used during assembly. The wire schema
 * leaves several fields optional that the fetcher populates in practice; this
 * fills defensive defaults so the shape is total.
 *
 * The defaults make the fields PRESENT, not meaningful — `''` and `[]` are
 * "absent, spelled in a non-optional type". Downstream still guards them, and
 * should: `findDescriptionsForEntry` checks `id.length > 0` and
 * `buildHistoryEntryIndex` skips empty ids, because an entry defaulted here
 * must not match another entry defaulted the same way. Read this as widening a
 * type, never as a guarantee that the values are real.
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
    // the bot-side fetcher. '' is the normalization contract for both: an ''
    // id is excluded from every id-keyed lookup, and personaId compares as
    // '' when absent — never treat either as a real identifier.
    id: msg.id ?? '',
    personaId: msg.personaId ?? '',
    // Discord messages always carry timestamps; epoch-0 is a defensive
    // fallback that sorts such a row first rather than crashing assembly.
    createdAt: msg.createdAt !== undefined ? new Date(msg.createdAt) : new Date(0),
    discordMessageId: msg.discordMessageId ?? [],
  } satisfies ConversationMessage;
}
