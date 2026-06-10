/**
 * Context-payload variant selection.
 *
 * Decides whether bot-client ships a THIN context (`kind: 'envelope'`, the four
 * re-derivable fields omitted because the worker assembles them from
 * `rawAssemblyInputs`) or a FAT legacy context (`kind: 'legacy'`, all fields
 * present). Extracted from MessageContextBuilder to keep buildContext within
 * the complexity/line budgets and to make the variant rule independently
 * testable.
 */

import { isThinPayloadEnabled } from '../../utils/contextWritePath.js';
import type { MessageContext } from '../../types.js';

/** The four fields the worker re-derives from the raw envelope. */
export interface ReDerivableContextFields {
  conversationHistory: MessageContext['conversationHistory'];
  referencedMessages: MessageContext['referencedMessages'];
  mentionedPersonas: MessageContext['mentionedPersonas'];
  referencedChannels: MessageContext['referencedChannels'];
}

/**
 * The discriminant plus the re-derivable fields. A discriminated union (not
 * `& Partial<>`) so the invariant "envelope ⇒ no re-derivable fields" is
 * compiler-checked: a `{ kind: 'envelope' }` value cannot carry them, and a
 * legacy value carries all of them (referencedMessages optional because the
 * empty-array→undefined normalization can drop it).
 */
export type ContextVariant =
  | ({ kind: 'legacy' } & Omit<ReDerivableContextFields, 'referencedMessages'> & {
        referencedMessages?: ReDerivableContextFields['referencedMessages'];
      })
  | { kind: 'envelope' };

/** Minimal logger surface — just the warn used for the misconfig path. */
interface VariantLogger {
  warn(obj: object, msg: string): void;
}

/**
 * Select the context variant. Thin (kind:'envelope') is chosen only when
 * CONTEXT_THIN_PAYLOAD is on AND the raw envelope is present — going thin
 * without the envelope would ship a payload the worker can't assemble (and the
 * gateway schema would reject), so that misconfiguration warns and falls back
 * to legacy.
 */
export function selectContextVariant(args: {
  hasRawEnvelope: boolean;
  fields: ReDerivableContextFields;
  logger: VariantLogger;
  channelId: string;
}): ContextVariant {
  const thinRequested = isThinPayloadEnabled();
  if (thinRequested && !args.hasRawEnvelope) {
    args.logger.warn(
      { channelId: args.channelId },
      'CONTEXT_THIN_PAYLOAD is on but no raw envelope was built (CONTEXT_RAW_ENVELOPE off?) — shipping legacy payload'
    );
  }
  if (thinRequested && args.hasRawEnvelope) {
    return { kind: 'envelope' };
  }
  // Legacy keeps all four fields; normalize an empty referencedMessages array to
  // undefined for payload parity (the worker treats absent and [] the same).
  const { referencedMessages, ...rest } = args.fields;
  return {
    kind: 'legacy',
    ...rest,
    referencedMessages:
      referencedMessages !== undefined && referencedMessages.length > 0
        ? referencedMessages
        : undefined,
  };
}
