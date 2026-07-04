import type { ConversationMessage } from '@tzurot/common-types/types/conversationMessage';
import type { AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';

/**
 * Fan a converted extended-context message's attachments into the two flat
 * worker-bound lists (each ref stamped with its source message id):
 * - images → always (the worker re-derives vision descriptions);
 * - voice → only when the bot couldn't transcribe it at fetch time (empty
 *   `voiceTranscripts`: aged out of the Redis cache, no bot reply in window).
 *   The worker re-resolves those (DB-first, STT-fallback). A resolved transcript
 *   already rides on the message metadata, so it needs no ref.
 *
 * Mutates `images`/`voice` in place (push). No-op when the message has no
 * attachments.
 *
 * IMPORTANT — ordering invariant: callers push in iteration order, which is
 * OLDEST-first (the fetcher reverses only the `messages` array, not these
 * attachment lists). The worker caps both lists from the TAIL — images via
 * `slice(-maxImages)` and voice via `slice(-cap)` in
 * `ContextAssembler.injectExtendedContextVoiceTranscripts` — to keep the NEWEST
 * when a window exceeds the cap. Do NOT reverse these lists to match `messages`
 * without flipping those slices, or the cap would silently keep the stalest
 * attachments (no test fails on the bot side — the assumption is cross-file).
 */
export function collectExtendedContextAttachments(
  conversionResult: { message: ConversationMessage; attachments: AttachmentMetadata[] },
  sourceDiscordMessageId: string,
  images: AttachmentMetadata[],
  voice: AttachmentMetadata[]
): void {
  if (conversionResult.attachments.length === 0) {
    return;
  }
  images.push(
    ...conversionResult.attachments
      .filter(a => a.contentType?.startsWith('image/') && a.isVoiceMessage !== true)
      .map(img => ({ ...img, sourceDiscordMessageId }))
  );
  const resolvedTranscripts = conversionResult.message.messageMetadata?.voiceTranscripts;
  if (resolvedTranscripts === undefined || resolvedTranscripts.length === 0) {
    voice.push(
      ...conversionResult.attachments
        .filter(a => a.isVoiceMessage === true)
        .map(v => ({ ...v, sourceDiscordMessageId }))
    );
  }
}
