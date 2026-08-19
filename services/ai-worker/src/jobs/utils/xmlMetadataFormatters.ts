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
import { isOwnPersonaVoice } from '@tzurot/common-types/utils/ownVoice';
import { enrichmentKey } from '../../services/prompt/QuoteFormatter.js';
import { dedupeReference, renderReference } from '../../services/prompt/RenderableReference.js';
import { fromStoredReference } from '../../services/prompt/storedReference.js';
import type { InlineImageDescription, RawHistoryEntry } from './conversationTypes.js';
import { resolveSpeakerInfo } from './participantUtils.js';

/**
 * Format quoted messages section for XML output.
 *
 * Takes the history ENTRIES rather than their ids alone. The id set answers
 * "is this quote already in the chat log?", which decides dedup; the entry
 * answers "and what does the chat log actually render for it?", which decides
 * how much of the quote is redundant. Only the second can be derived, so only
 * the second stops the stub asserting things about a renderer it cannot see.
 */
export interface QuotedSectionInput {
  msg: RawHistoryEntry;
  normalizedRole: string;
  /** The responding personality's name, for the role name-match fallback. */
  personalityName: string;
  /** Discord-message-id → history entry, for dedup and its subtraction set. */
  historyEntries: Map<string, RawHistoryEntry> | undefined;
  allPersonalityNames: Set<string> | undefined;
  /**
   * The responding personality's id. With a quote's own `authorPersonalityId`
   * it decides self-vs-sibling exactly; absent, the name comparison decides
   * (the same pairing `formatSingleHistoryEntryAsXml` already threads for
   * chat-log rows).
   */
  responderPersonalityId: string | undefined;
}

export function formatQuotedSection(input: QuotedSectionInput): string {
  const {
    msg,
    normalizedRole,
    personalityName,
    historyEntries,
    allPersonalityNames,
    responderPersonalityId,
  } = input;
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
    if (historyEntries?.has(ref.discordMessageId) === true) {
      dedupedRefs.push(ref);
    } else {
      fullRefs.push(ref);
    }
  }

  if (fullRefs.length === 0 && dedupedRefs.length === 0) {
    return '';
  }

  const formattedFull = fullRefs.map(ref =>
    renderReference(
      fromStoredReference(ref, personalityName, allPersonalityNames, responderPersonalityId)
    )
  );

  // Deduped refs are the SAME reference, projected — not a second build. Media
  // rides along by default: the worker writes each reference's descriptions and
  // transcripts onto this row when it builds them, precisely so quoted media
  // survives replay, and the history entry the stub points at usually renders
  // that image as a bare URL. Usually, not always — so the exception is
  // computed from the entry rather than assumed away.
  const formattedDeduped = dedupedRefs.map(ref => {
    const entry = historyEntries?.get(ref.discordMessageId);
    return renderReference(
      dedupeReference(
        fromStoredReference(ref, personalityName, allPersonalityNames, responderPersonalityId),
        entry === undefined
          ? undefined
          : chatLogEnrichmentFor(entry, personalityName, allPersonalityNames)
      )
    );
  });

  const allFormatted = [...formattedFull, ...formattedDeduped].join('\n');
  return `\n<quoted_messages>\n${allFormatted}\n</quoted_messages>`;
}

/**
 * The enrichment text this entry's own chat-log rendering already carries.
 *
 * Answers "would the model read this description anyway, without the quote?" —
 * the question a deduped stub needs before deciding whether to repeat media it
 * was handed. DERIVED, not asserted: it asks the two section renderers whether
 * they emit for this entry and reads the strings they would emit, so a change
 * to what history renders moves this with it. The predecessor was a sentence in
 * a docstring claiming history "renders that image as a URL, not a
 * description", which was true for a message nobody had triggered on and false
 * for one that had been a trigger itself — `injectImageDescriptions` populates
 * `imageDescriptions` on exactly those entries.
 *
 * Empty when the entry renders nothing (an unresolvable speaker, an assistant's
 * own TTS transcript), which is the correct answer rather than a missing one:
 * nothing is in the chat log to subtract against.
 */
export function chatLogEnrichmentFor(
  msg: RawHistoryEntry,
  personalityName: string,
  allPersonalityNames: Set<string> | undefined
): Set<string> {
  const carried = new Set<string>();

  // Resolved rather than passed in: an entry the chat log declines to render at
  // all (resolveSpeakerInfo returns null) contributes nothing, and that is the
  // same question the renderer asks first.
  //
  // Deliberately NOT given the responder's personality id, unlike the renderer
  // and the token measure. This reads only `null`-ness and `normalizedRole` —
  // the RAW role — and the id affects neither; it only splits the assistant
  // role into self vs. sibling. Threading it here would add a parameter to
  // every caller in exchange for a value this function cannot consult.
  const speakerInfo = resolveSpeakerInfo(msg, personalityName, allPersonalityNames);
  if (speakerInfo === null) {
    return carried;
  }

  for (const img of renderedImageDescriptions(msg)) {
    carried.add(enrichmentKey('image', img.description));
  }
  for (const transcript of renderedVoiceTranscripts(msg, speakerInfo.normalizedRole)) {
    carried.add(enrichmentKey('voice', transcript));
  }

  return carried;
}

/**
 * The image descriptions this entry contributes to the chat log — empty when it
 * contributes none.
 *
 * ONE decision with two readers: `formatImageSection` draws these,
 * `chatLogEnrichmentFor` reports them. Sharing the selection rather than having
 * the second ask the first "did you emit?" and then re-read the source keeps a
 * single condition, and skips building an XML string only to measure it.
 */
function renderedImageDescriptions(msg: RawHistoryEntry): InlineImageDescription[] {
  return msg.messageMetadata?.imageDescriptions ?? [];
}

/**
 * The voice transcripts this entry contributes to the chat log.
 *
 * The bot's own voice output (assistant role) is TTS of its message text, so its
 * transcript merely duplicates `content` — without this the bot's lines appear
 * twice in the chat log. Suppression lives HERE, in the shared selection, so the
 * renderer and the enrichment report cannot reach different answers.
 *
 * SCOPE: this covers the message-level render only. A FORWARDED entry renders
 * its attachments through `toRenderableAttachments` instead, which maps
 * transcripts unconditionally — so on that path the two would diverge if an
 * assistant-role entry could ever carry `voiceTranscripts`. It cannot: the only
 * writers are bot-client's inbound-voice builder (user messages by
 * construction) and `ContextAssembler`'s extended-context re-resolution, which
 * returns early on `MessageRole.Assistant`.
 *
 * Deliberately NOT unified with the forwarded path, because the suppression's
 * reason does not transfer: on a forward the transcript is of the FORWARDED
 * voice note, not of the bot's own text, so suppressing it there would delete
 * real content rather than a duplicate. The divergence is the correct behaviour;
 * only its unreachability needs stating.
 */
function renderedVoiceTranscripts(msg: RawHistoryEntry, normalizedRole: string): string[] {
  if (isOwnPersonaVoice(normalizedRole)) {
    return [];
  }
  return msg.messageMetadata?.voiceTranscripts ?? [];
}

/** Format image descriptions section for XML output */
export function formatImageSection(msg: RawHistoryEntry): string {
  const images = renderedImageDescriptions(msg);
  if (images.length === 0) {
    return '';
  }

  const formattedImages = images
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

/**
 * Format voice transcripts section for XML output.
 *
 * Which transcripts an entry contributes — including the assistant own-TTS
 * suppression — is `renderedVoiceTranscripts`, shared with the enrichment
 * report. As a check at this function's call site it was one copy away from the
 * two disagreeing, which is the class this whole change removes.
 */
export function formatVoiceSection(msg: RawHistoryEntry, normalizedRole: string): string {
  const voiceTranscripts = renderedVoiceTranscripts(msg, normalizedRole);
  if (voiceTranscripts.length === 0) {
    return '';
  }

  const transcripts = voiceTranscripts
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
