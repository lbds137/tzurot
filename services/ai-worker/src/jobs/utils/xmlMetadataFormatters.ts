/**
 * XML Metadata Formatters
 *
 * Functions for formatting message metadata (quotes, images, embeds, voice, reactions)
 * as XML sections within conversation history messages.
 * Extracted from conversationUtils.ts for better modularity.
 */

import { type StoredReferencedMessage } from '@tzurot/common-types/types/schemas/message';
import {
  escapeXmlContent,
  neutralizeWrapperClosingTags,
} from '@tzurot/common-types/utils/promptSanitizer';
import { escapeXml } from '@tzurot/common-types/utils/xmlBuilder';
import {
  buildRenderableAttachments,
  type RenderableAttachment,
} from '../../services/prompt/QuoteFormatter.js';
import {
  dedupeReference,
  promptTime,
  renderReference,
  type RenderableReference,
} from '../../services/prompt/RenderableReference.js';
import { deriveRefRole } from '../../services/prompt/referenceRole.js';
import type { RawHistoryEntry } from './conversationTypes.js';

/**
 * Build a stored reference's attachments in renderable form: one element per
 * attachment, carrying its persisted vision description when there is one.
 *
 * The predecessor split this into two lists — described images in one
 * vocabulary, everything else as `[contentType: name]` markers in another —
 * and then had to suppress a marker whenever a description existed for the
 * same file, matching the two halves BY FILENAME. That correspondence was
 * fragile in a specific way: the two sides defaulted a nameless attachment
 * differently (`'image'` vs `'attachment'`), so the lookup missed and the same
 * picture rendered twice. One element per attachment removes the lookup, and
 * that whole bug class with it — a nameless attachment now simply has no
 * `filename` attribute, and there is nothing to correlate.
 *
 * Descriptions are joined ONTO the attachment list rather than replacing it, and
 * any description that matches no attachment is still appended: a description is
 * paid-for enrichment, and dropping one because its attachment row went missing
 * would re-create the class this function exists to close.
 */
export function buildStoredAttachments(ref: StoredReferencedMessage): RenderableAttachment[] {
  const descriptionsByFilename = new Map(
    (ref.resolvedImageDescriptions ?? []).map(desc => [desc.filename, desc.description])
  );
  const matched = new Set<string>();

  // Only images can be enriched here, and that is honest rather than a gap in
  // this function: `StoredReferencedMessage` has no audio counterpart to
  // `resolvedImageDescriptions`, so a replayed voice reference has no transcript
  // to carry and renders `status="untranscribed"`. Closing THAT is a schema
  // change (TASK-367), not a render change — and a shared builder that quietly
  // emitted an empty transcript section would paper over it.
  const attachments = buildRenderableAttachments(ref.attachments ?? [], att => {
    const name = att.name;
    if (name === undefined) {
      return undefined;
    }
    const description = descriptionsByFilename.get(name);
    if (description !== undefined) {
      matched.add(name);
    }
    return description;
  });

  for (const [filename, description] of descriptionsByFilename) {
    if (!matched.has(filename)) {
      attachments.push({ kind: 'image', filename, description });
    }
  }

  return attachments;
}

/**
 * Adapt a stored history reference into the canonical renderable shape.
 *
 * The one place the stored schema is read. `number` stays absent by design — a
 * replayed quote has no `[Reference N]` marker in the current message to point
 * at, so numbering it would invent a referent.
 */
export function fromStoredReference(
  ref: StoredReferencedMessage,
  personalityName: string,
  allPersonalityNames?: Set<string>
): RenderableReference {
  // Hydrated persona name where one resolved, else the Discord display name.
  const from = ref.resolvedPersonaName ?? (ref.authorDisplayName || ref.authorUsername);

  return {
    isForwarded: ref.isForwarded,
    from,
    fromId: ref.resolvedPersonaId,
    username: ref.authorUsername,
    role: deriveRefRole(ref.authorRole, from, personalityName, allPersonalityNames),
    time: promptTime(ref.timestamp),
    content: ref.content,
    locationContext: usableLocationContext(ref.locationContext),
    embedsXml: ref.embeds !== undefined && ref.embeds.length > 0 ? [ref.embeds] : undefined,
    attachments: buildStoredAttachments(ref),
  };
}

/**
 * Location context, unless it predates XML formatting.
 *
 * Legacy stored rows carry a Markdown location block that would render as prose
 * inside the quote. Detectable by two phrases the old format always contained.
 */
function usableLocationContext(locationContext: string | undefined): string | undefined {
  if (
    locationContext === undefined ||
    locationContext.length === 0 ||
    locationContext.includes('**Server**') ||
    locationContext.includes('This conversation is taking place')
  ) {
    return undefined;
  }
  return locationContext;
}

/** Format quoted messages section for XML output */
export function formatQuotedSection(
  msg: RawHistoryEntry,
  normalizedRole: string,
  personalityName: string,
  historyMessageIds: Set<string> | undefined,
  allPersonalityNames: Set<string> | undefined
): string {
  if (normalizedRole !== 'user') {
    return '';
  }
  if (msg.messageMetadata?.referencedMessages === undefined) {
    return '';
  }
  if (msg.messageMetadata.referencedMessages.length === 0) {
    return '';
  }

  const allRefs = msg.messageMetadata.referencedMessages;

  // Separate refs into full (not in history) and deduped (in history → lightweight stub)
  const fullRefs: StoredReferencedMessage[] = [];
  const dedupedRefs: StoredReferencedMessage[] = [];

  for (const ref of allRefs) {
    if (historyMessageIds?.has(ref.discordMessageId) === true) {
      dedupedRefs.push(ref);
    } else {
      fullRefs.push(ref);
    }
  }

  if (fullRefs.length === 0 && dedupedRefs.length === 0) {
    return '';
  }

  const formattedFull = fullRefs.map(ref =>
    renderReference(fromStoredReference(ref, personalityName, allPersonalityNames))
  );

  // Deduped refs are the SAME reference, projected — not a second build. Media
  // rides along in full: `persistReferenceDescriptions` writes descriptions onto
  // the stored row precisely so a quoted image survives replay, and the history
  // entry the stub points at renders that image as a URL, not a description.
  const formattedDeduped = dedupedRefs.map(ref =>
    renderReference(dedupeReference(fromStoredReference(ref, personalityName, allPersonalityNames)))
  );

  const allFormatted = [...formattedFull, ...formattedDeduped].join('\n');
  return `\n<quoted_messages>\n${allFormatted}\n</quoted_messages>`;
}

/** Format image descriptions section for XML output */
export function formatImageSection(msg: RawHistoryEntry): string {
  if (msg.messageMetadata?.imageDescriptions === undefined) {
    return '';
  }
  if (msg.messageMetadata.imageDescriptions.length === 0) {
    return '';
  }

  const formattedImages = msg.messageMetadata.imageDescriptions
    .map(
      img =>
        `<image filename="${escapeXml(img.filename)}">${escapeXmlContent(img.description)}</image>`
    )
    .join('\n');
  return `\n<image_descriptions>\n${formattedImages}\n</image_descriptions>`;
}

/** Format embeds section for XML output */
export function formatEmbedsSection(msg: RawHistoryEntry): string {
  if (msg.messageMetadata?.embedsXml === undefined) {
    return '';
  }
  if (msg.messageMetadata.embedsXml.length === 0) {
    return '';
  }
  return `\n<embeds>\n${msg.messageMetadata.embedsXml.join('\n')}\n</embeds>`;
}

/** Format voice transcripts section for XML output */
export function formatVoiceSection(msg: RawHistoryEntry): string {
  if (msg.messageMetadata?.voiceTranscripts === undefined) {
    return '';
  }
  if (msg.messageMetadata.voiceTranscripts.length === 0) {
    return '';
  }

  const transcripts = msg.messageMetadata.voiceTranscripts
    // voice_transcripts/transcript aren't in PROTECTED_TAGS — neutralize the
    // wrapper closings so </transcript> in the text can't break out.
    .map(t => `<transcript>${neutralizeWrapperClosingTags(escapeXmlContent(t))}</transcript>`)
    .join('\n');
  return `\n<voice_transcripts>\n${transcripts}\n</voice_transcripts>`;
}

/**
 * Format reactions section for XML output
 *
 * Each reactor becomes a separate <reaction> element with from/from_id attributes
 * matching the message format for consistency. Emoji (or :custom_name:) is the content.
 *
 * Format: <reaction from="PersonaName" from_id="uuid">emoji</reaction>
 */
export function formatReactionsSection(msg: RawHistoryEntry): string {
  if (msg.messageMetadata?.reactions === undefined) {
    return '';
  }
  if (msg.messageMetadata.reactions.length === 0) {
    return '';
  }

  // Flatten reactions: one <reaction> element per reactor per emoji
  const formattedReactions: string[] = [];

  for (const reaction of msg.messageMetadata.reactions) {
    // Custom emoji attribute (for :name: format emojis)
    const customAttr = reaction.isCustom === true ? ' custom="true"' : '';
    const emojiContent = escapeXmlContent(reaction.emoji);

    // Each reactor gets their own <reaction> element
    for (const reactor of reaction.reactors) {
      const fromAttr = `from="${escapeXml(reactor.displayName)}"`;
      const fromIdAttr =
        reactor.personaId !== undefined && reactor.personaId.length > 0
          ? ` from_id="${escapeXml(reactor.personaId)}"`
          : '';
      formattedReactions.push(
        `<reaction ${fromAttr}${fromIdAttr}${customAttr}>${emojiContent}</reaction>`
      );
    }
  }

  if (formattedReactions.length === 0) {
    return '';
  }

  return `\n<reactions>\n${formattedReactions.join('\n')}\n</reactions>`;
}
