import type { ConversationMessage } from '@tzurot/common-types/types/conversationMessage';
import type { AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import type {
  ForwardedOrigin,
  StoredReferencedMessage,
} from '@tzurot/common-types/types/schemas/message';

/** The content-derived carriers a converted message can contribute to metadata. */
export interface BuiltMessageContentCarriers {
  isForwarded: boolean;
  attachments: AttachmentMetadata[];
  embedsXml?: string[];
  voiceTranscripts?: string[];
  /**
   * Recovered identity of a forwarded message's original author, when the
   * caller has one in hand. Absent for non-forwards and for forwards whose
   * origin could not be resolved — both render unattributed, as before.
   */
  forwardedFrom?: ForwardedOrigin;
}

/**
 * Assemble a converted message's structured metadata from its three independent
 * carriers:
 * - the embed / voice-transcript payloads produced by content building;
 * - forwarded-image description lines, the text fallback the model reads when
 *   vision isn't available for a forwarded attachment;
 * - the forwarded origin, when the caller resolved one;
 * - link-resolved references, appended to any references already present.
 *
 * Stays `undefined` when no carrier applies, so the field is absent on the wire
 * rather than an empty object.
 */
export function buildMessageMetadata(
  discordMessageId: string,
  carriers: BuiltMessageContentCarriers,
  resolvedReferences?: Map<string, StoredReferencedMessage[]>
): ConversationMessage['messageMetadata'] {
  const { isForwarded, attachments, embedsXml, voiceTranscripts, forwardedFrom } = carriers;

  const hasMetadata = embedsXml !== undefined || voiceTranscripts !== undefined;
  let messageMetadata: ConversationMessage['messageMetadata'] = hasMetadata
    ? { embedsXml, voiceTranscripts }
    : undefined;

  // Store forwarded attachment descriptions as fallback for when vision isn't available
  if (isForwarded && attachments.length > 0) {
    const imageLines = attachments
      .filter(a => a.contentType?.startsWith('image/'))
      .map(a => `[${a.contentType}: ${a.name ?? 'image'}]`);
    if (imageLines.length > 0) {
      messageMetadata = messageMetadata ?? {};
      messageMetadata.forwardedAttachmentLines = imageLines;
    }
  }

  // The renderer reads `forwardedFrom` to attribute a forward's quote; it is
  // absent for every non-forward and for unresolvable forwards.
  if (forwardedFrom !== undefined) {
    messageMetadata = messageMetadata ?? {};
    messageMetadata.forwardedFrom = forwardedFrom;
  }

  // Merge resolved link references into messageMetadata
  const linkedRefs = resolvedReferences?.get(discordMessageId);
  if (linkedRefs !== undefined && linkedRefs.length > 0) {
    messageMetadata = messageMetadata ?? {};
    messageMetadata.referencedMessages = [
      ...(messageMetadata.referencedMessages ?? []),
      ...linkedRefs,
    ];
  }

  return messageMetadata;
}
