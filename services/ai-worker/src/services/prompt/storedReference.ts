/**
 * The durable form of a quoted reference — read and write, in one module.
 *
 * A reference exists twice: once as the live snapshot the worker renders for
 * this turn, and once as a row in `message_metadata.referencedMessages` that a
 * later turn replays out of `<chat_log>`. Those two copies have to agree, and
 * for a long time they did not — the write half patched a field nothing set,
 * so it wrote nothing at all, while the read half quietly degraded a quoted
 * image to `status="undescribed"` as soon as a one-hour cache entry expired.
 *
 * Keeping `toStoredReference` and `fromStoredReference` in the same file is the
 * cheap structural half of the fix: the two functions that must agree about
 * this schema are the two functions in front of you. The expensive half is
 * that `toStoredReference` takes the attachments AS BUILT — the very objects
 * the renderer emits — so the description that reaches the model and the
 * description that reaches the database cannot be different strings.
 */

import {
  type AttachmentEnrichment,
  type ReferencedMessage,
  type StoredReferencedMessage,
} from '@tzurot/common-types/types/schemas/message';
import { createLogger } from '@tzurot/common-types/utils/logger';
import {
  attachmentEnrichment,
  buildRenderableAttachments,
  type BuiltAttachment,
  type RenderableAttachment,
} from './QuoteFormatter.js';
import { promptTime, type RenderableReference } from './RenderableReference.js';
import { deriveRefRole } from './referenceRole.js';
import { isOwnPersonaVoice, redactOwnVoiceTranscript } from '../voice/ownVoiceGuard.js';

const logger = createLogger('StoredReference');

/**
 * Adapt a freshly-built live reference into its durable form.
 *
 * Identity comes from the ENRICHED reference, not the raw envelope snapshot:
 * by this point `stripBotVoiceAttachments` has removed the personality's own
 * TTS audio and `appendVoiceTranscripts` has folded in transcripts the DB
 * already held, and persisting the pre-enrichment shape would undo both on
 * every replay.
 *
 * Two fields are deliberately NOT carried:
 * - `isDeduplicated` — a decision about THIS turn's prompt. Replay re-derives
 *   it from its own history index (`buildHistoryEntryIndex`), and a stored
 *   `true` would stub a quote whose full copy had since aged out of the window.
 * - the derived `role` — `authorRole` is stored raw instead, because the
 *   sibling-persona demotion depends on which personalities are visible in the
 *   replaying turn's history, not this one's.
 *
 * `requestId` is not stored and never shapes the row: it exists only so the
 * keyless-enrichment warning below can name the request that lost the work.
 */
export function toStoredReference(
  ref: ReferencedMessage,
  built: BuiltAttachment[],
  requestId?: string
): StoredReferencedMessage {
  return {
    discordMessageId: ref.discordMessageId,
    authorUsername: ref.authorUsername,
    authorDisplayName: ref.authorDisplayName,
    authorDiscordId: ref.discordUserId,
    authorRole: ref.authorRole,
    content: ref.content,
    embeds: ref.embeds.length > 0 ? ref.embeds : undefined,
    timestamp: ref.timestamp,
    locationContext: ref.locationContext,
    attachments: ref.attachments,
    isForwarded: ref.isForwarded,
    attachmentEnrichment: collectEnrichment(built, requestId),
  };
}

/**
 * The enrichment worth writing down: every built attachment that carries text.
 *
 * The text comes from `attachmentEnrichment`, the same accessor the renderer
 * uses for the element's content — so this is a copy of what shipped, never a
 * second derivation from the vision/STT result. A `file` has no enrichment
 * slot at all, so it can never contribute one.
 *
 * Undefined rather than `[]` when there is nothing: absence has to keep meaning
 * "never computed" (retryable), and an empty array would read as "computed,
 * found nothing".
 */
function collectEnrichment(
  built: BuiltAttachment[],
  requestId?: string
): AttachmentEnrichment[] | undefined {
  const entries = built.flatMap(({ url, attachment }): AttachmentEnrichment[] => {
    const description = attachmentEnrichment(attachment);
    if (attachment.kind === 'file' || description === undefined || description.length === 0) {
      return [];
    }
    if (url.length === 0) {
      // Keyless enrichment cannot be persisted — there is nothing for replay to
      // correlate it against. It reached the prompt for this turn and is lost
      // after; say so rather than dropping it in silence, which is the exact
      // habit this whole change exists to break. Reachable when a transcription
      // result carries no attachment URL and the processor defaults it to ''.
      logger.warn(
        { requestId, kind: attachment.kind, filename: attachment.filename },
        'Enrichment has no attachment URL to key it by — reached the prompt, will not survive replay'
      );
      return [];
    }
    return [{ url, kind: attachment.kind, description }];
  });
  return entries.length > 0 ? entries : undefined;
}

/**
 * Build a stored reference's attachments in renderable form: one element per
 * attachment, carrying whatever description or transcript was written down for
 * it.
 *
 * Correlation is by URL, matching how the live paths already find their own
 * enrichment. The predecessor matched by FILENAME, and that key was wrong in
 * two ways at once: two `image.png`s in one reply are indistinguishable, and a
 * nameless attachment had no key at all — producers invented different
 * placeholders (`'image'` vs `'attachment'`), the lookup missed, and the same
 * picture rendered twice.
 *
 * Enrichment that matches no attachment row is still appended rather than
 * dropped, under the modality recorded when it was built: it is paid-for work,
 * and guessing `image` for a transcript would state something untrue about it.
 */
export function buildStoredAttachments(ref: StoredReferencedMessage): RenderableAttachment[] {
  const enrichmentByUrl = new Map(
    (ref.attachmentEnrichment ?? []).map(entry => [entry.url, entry])
  );
  const matched = new Set<string>();

  const attachments = buildRenderableAttachments(ref.attachments ?? [], att => {
    const hit = enrichmentByUrl.get(att.url);
    if (hit === undefined) {
      return undefined;
    }
    matched.add(att.url);
    return hit.description;
  }).map(built => built.attachment);

  for (const entry of ref.attachmentEnrichment ?? []) {
    if (matched.has(entry.url) || entry.description.length === 0) {
      continue;
    }
    attachments.push(
      entry.kind === 'image'
        ? { kind: 'image', description: entry.description }
        : { kind: 'voice', description: entry.description }
    );
  }

  // Render-side belt-and-suspenders: a row persisted BEFORE this guard existed
  // can still carry a real STT transcript in `attachmentEnrichment` — replay
  // must not let it back into the prompt just because it survived in storage.
  if (isOwnPersonaVoice(ref.authorRole)) {
    return attachments.map(att => (att.kind === 'voice' ? redactOwnVoiceTranscript(att) : att));
  }

  return attachments;
}

/**
 * Adapt a stored history reference into the canonical renderable shape.
 *
 * `number` stays absent by design — a replayed quote has no `[Reference N]`
 * marker in the current message to point at, so numbering it would invent a
 * referent.
 */
export function fromStoredReference(
  ref: StoredReferencedMessage,
  personalityName: string,
  allPersonalityNames?: Set<string>
): RenderableReference {
  // Hydrated persona name where one resolved, else the Discord display name.
  const from = ref.resolvedPersonaName ?? (ref.authorDisplayName || ref.authorUsername);

  // Role derivation gets the DISCORD name, never the hydrated one: the
  // self/sibling name-match runs against personality names, which are Discord
  // vocabulary — a webhook line's display name IS the character name, while a
  // human's persona name matching a personality is a collision, not identity.
  const discordName = ref.authorDisplayName || ref.authorUsername;

  return {
    isForwarded: ref.isForwarded,
    from,
    fromId: ref.resolvedPersonaId,
    username: ref.authorUsername,
    role: deriveRefRole(ref.authorRole, discordName, personalityName, allPersonalityNames),
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
