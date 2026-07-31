/**
 * XML Metadata Formatters
 *
 * Functions for formatting message metadata (quotes, images, embeds, voice, reactions)
 * as XML sections within conversation history messages.
 * Extracted from conversationUtils.ts for better modularity.
 */

import { type StoredReferencedMessage } from '@tzurot/common-types/types/schemas/message';
import { formatPromptTimestamp } from '@tzurot/common-types/utils/dateFormatting';
import {
  escapeXmlContent,
  neutralizeWrapperClosingTags,
} from '@tzurot/common-types/utils/promptSanitizer';
import { capDedupText } from '@tzurot/common-types/utils/referenceEnrichment';
import { escapeXml } from '@tzurot/common-types/utils/xmlBuilder';
import {
  formatQuoteElement,
  formatDedupedQuote,
  classifyAttachment,
  type RenderableAttachment,
} from '../../services/prompt/QuoteFormatter.js';
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

  const attachments: RenderableAttachment[] = (ref.attachments ?? []).map(att => {
    const common = { filename: att.name, contentType: att.contentType };

    // Same classifier the live path uses — see `classifyAttachment`. These two
    // producers must agree about what a given attachment IS, or the same file
    // renders one way in the turn it arrives and another when replayed.
    switch (classifyAttachment(att)) {
      case 'image': {
        const name = att.name;
        const description = name !== undefined ? descriptionsByFilename.get(name) : undefined;
        if (name !== undefined && description !== undefined) {
          matched.add(name);
          return { kind: 'image', ...common, description };
        }
        return { kind: 'image', ...common, status: 'undescribed' };
      }
      case 'voice':
        // Always `untranscribed` on this path, and that is the honest rendering
        // rather than a bug: `StoredReferencedMessage` has no audio counterpart
        // to `resolvedImageDescriptions`, so a replayed voice reference has no
        // transcript to carry. Saying so beats an unexplained bare element —
        // closing the gap is a schema change (TASK-367), not a render change.
        // The duration IS persisted, so it rides along; the live path forwards
        // it too, and dropping it here was one more live/stored divergence.
        return { kind: 'voice', ...common, durationSeconds: att.duration, status: 'untranscribed' };
      case 'file':
        return { kind: 'file', ...common };
    }
  });

  for (const [filename, description] of descriptionsByFilename) {
    if (!matched.has(filename)) {
      attachments.push({ kind: 'image', filename, description });
    }
  }

  return attachments;
}

/**
 * Format a single stored reference as a <quote> element.
 *
 * Uses the shared formatQuoteElement() for consistent XML structure across
 * all quote formatting paths (real-time refs, history refs, forwarded messages).
 *
 * @param ref - The stored referenced message
 * @param personalityName - Name of the active AI personality (to infer role)
 * @param allPersonalityNames - Optional set of all AI personality names in the conversation
 * @returns Formatted XML string
 */
function formatStoredReferencedMessage(
  ref: StoredReferencedMessage,
  personalityName: string,
  allPersonalityNames?: Set<string>
): string {
  // Use hydrated persona name if available, fall back to original Discord display name
  const authorName = ref.resolvedPersonaName ?? (ref.authorDisplayName || ref.authorUsername);
  const role = deriveRefRole(ref.authorRole, authorName, personalityName, allPersonalityNames);

  // Format location if present (should be XML formatted by bot-client using shared formatLocationAsXml)
  // Skip legacy Markdown format (from old stored data) - detectable by "**Server**" or
  // "This conversation is taking place" patterns that predate XML formatting
  let locationContext: string | undefined;
  if (
    ref.locationContext !== undefined &&
    ref.locationContext.length > 0 &&
    !ref.locationContext.includes('**Server**') &&
    !ref.locationContext.includes('This conversation is taking place')
  ) {
    locationContext = ref.locationContext;
  }

  const attachments = buildStoredAttachments(ref);

  return formatQuoteElement({
    type: ref.isForwarded === true ? 'forward' : undefined,
    from: authorName,
    fromId: ref.resolvedPersonaId,
    role,
    timeFormatted:
      ref.timestamp !== undefined && ref.timestamp.length > 0
        ? formatPromptTimestamp(ref.timestamp)
        : undefined,
    content: ref.content,
    locationContext,
    embedsXml: ref.embeds !== undefined && ref.embeds.length > 0 ? [ref.embeds] : undefined,
    attachments: attachments.length > 0 ? attachments : undefined,
  });
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

  // Full refs: existing behavior
  const formattedFull = fullRefs.map(ref =>
    formatStoredReferencedMessage(ref, personalityName, allPersonalityNames)
  );

  // Deduped refs: lightweight stubs with truncated content and reply-target note.
  // Media rides along in full — `persistReferenceDescriptions` writes descriptions
  // onto the stored row precisely so a quoted image survives replay, and the
  // history entry the stub points at renders that image as a URL, not a
  // description.
  //
  // An UNdescribed attachment now renders here too, as a `status`-carrying
  // element. Its predecessor omitted markers on this branch as chat-log
  // redundancy, which was true for the file's NAME and false for its existence:
  // an attachment with no description and no marker is simply invisible, the
  // same drop class as the descriptions this branch used to lose entirely.
  const formattedDeduped = dedupedRefs.map(ref => {
    const authorName = ref.resolvedPersonaName ?? (ref.authorDisplayName || ref.authorUsername);
    const role = deriveRefRole(ref.authorRole, authorName, personalityName, allPersonalityNames);
    return formatDedupedQuote({
      from: authorName,
      role,
      timeFormatted:
        ref.timestamp !== undefined && ref.timestamp.length > 0
          ? formatPromptTimestamp(ref.timestamp)
          : undefined,
      // Cap the stored text preview HERE (the single truncation point) — formatDedupedQuote
      // renders as-is. Stored refs carry their attachments as structured elements, so
      // content is text-only and safe to cap directly.
      content: capDedupText(ref.content),
      attachments: buildStoredAttachments(ref),
    });
  });

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
