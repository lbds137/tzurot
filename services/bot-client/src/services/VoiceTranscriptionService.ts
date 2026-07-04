/**
 * Voice Transcription Service
 *
 * Handles voice message detection, transcription, and caching.
 * Sends transcription to Discord and stores in Redis for personality processing.
 */

import type { Message, MessageMentionOptions } from 'discord.js';
import { transcribe } from '../utils/gatewayServiceCalls.js';
import { DISCORD_LIMITS } from '@tzurot/common-types/constants/discord';
import { CONTENT_TYPES } from '@tzurot/common-types/constants/media';
import {
  sttProviderDisplayName,
  sttProviderInfoUrl,
  type SttProvider,
} from '@tzurot/common-types/types/sttProvider';
import { splitMessage } from '@tzurot/common-types/utils/discord';
import { isTimeoutError, isTooLongError } from '@tzurot/common-types/utils/errors';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { voiceTranscriptCache } from '../redis.js';
import { hasForwardedSnapshots, getSnapshots } from '../utils/forwardedMessageUtils.js';
import { isVoiceAttachment } from '../utils/voiceAttachment.js';
import { sendTypingIndicator } from '../utils/typingErrorClassifier.js';
import { classifyBotAudio } from '../utils/botAudioClassifier.js';

const logger = createLogger('VoiceTranscriptionService');

/** Interval for refreshing the typing indicator (Discord expires at ~10s, matches JobTracker.ts) */
const TYPING_INDICATOR_INTERVAL_MS = 8000;

/**
 * Uses Discord `-#` subtext so the line renders small+muted under the transcript.
 *
 * Mirrors the LLM model footer's `Model: [name](<url>)` clickable-link shape from
 * `buildModelFooterText` in `@tzurot/common-types/constants/discord` — readers
 * can click through to the upstream model card to learn what produced the text.
 *
 * Gated on the user's `showModelFooter` preference (resolved server-side and
 * piggybacked on the transcribe response). `undefined` preserves the legacy
 * behavior of always showing the footer when a provider is known — keeps
 * old api-gateway versions from silently dropping the footer during a
 * deploy-window mismatch.
 */
function formatProviderAttribution(
  provider: SttProvider | undefined,
  showModelFooter: boolean | undefined
): string | null {
  if (provider === undefined) {
    return null;
  }
  if (showModelFooter === false) {
    return null;
  }
  const name = sttProviderDisplayName(provider);
  const url = sttProviderInfoUrl(provider);
  return `-# Transcribed by [${name}](<${url}>)`;
}

/** Inlines attribution on the last chunk; spills to a follow-up reply when inlining would exceed Discord's per-message length limit. */
async function sendTranscriptChunks(
  message: Message,
  chunks: string[],
  attribution: string | null
): Promise<void> {
  const allowedMentions: MessageMentionOptions = { parse: [], repliedUser: false };

  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;

    // Non-last chunks (and last chunk with no attribution to append) just go out as-is.
    if (!isLast || attribution === null) {
      await message.reply({ content: chunks[i], allowedMentions });
      continue;
    }

    // Last chunk + attribution present: try inline; spill to a follow-up if too long.
    const withAttribution = `${chunks[i]}\n${attribution}`;
    if (withAttribution.length > DISCORD_LIMITS.MESSAGE_LENGTH) {
      await message.reply({ content: chunks[i], allowedMentions });
      await message.reply({ content: attribution, allowedMentions });
    } else {
      await message.reply({ content: withAttribution, allowedMentions });
    }
  }
}

/** Attachment info for transcription */
interface TranscriptionAttachment {
  url: string;
  // Canonical cache-key field — matches `AttachmentMetadata.originalUrl` used by ai-worker's `lookupCachedTranscript`. Equals `url` at construction time (no bot-client pipeline transforms).
  originalUrl: string;
  contentType: string;
  name: string;
  size: number;
  isVoiceMessage: boolean;
  duration: number | undefined;
  waveform: string | undefined;
}

/**
 * Extract audio attachments from a message snapshot
 * @internal
 */
function extractAudioFromSnapshot(snapshot: {
  attachments?: ReadonlyMap<
    string,
    {
      url: string;
      contentType: string | null;
      name: string;
      size: number;
      duration: number | null;
      waveform?: string | null;
    }
  > | null;
}): TranscriptionAttachment[] {
  if (!snapshot.attachments || snapshot.attachments.size === 0) {
    return [];
  }

  return Array.from(snapshot.attachments.values())
    .filter(isVoiceAttachment)
    .map(attachment => ({
      url: attachment.url,
      originalUrl: attachment.url,
      contentType:
        attachment.contentType !== null &&
        attachment.contentType !== undefined &&
        attachment.contentType.length > 0
          ? attachment.contentType
          : CONTENT_TYPES.BINARY,
      name: attachment.name,
      size: attachment.size,
      // Always true here (these attachments already passed the isVoiceAttachment
      // filter above) — routed through the shared predicate so no duration-only
      // copy of the heuristic survives to drift.
      isVoiceMessage: isVoiceAttachment(attachment),
      duration: attachment.duration ?? undefined,
      waveform: attachment.waveform ?? undefined,
    }));
}

/**
 * Check if a snapshot has any audio attachments
 * @internal
 */
function snapshotHasAudio(snapshot: {
  attachments?: ReadonlyMap<
    string,
    {
      contentType: string | null;
      duration: number | null;
    }
  > | null;
}): boolean {
  if (!snapshot.attachments || snapshot.attachments.size === 0) {
    return false;
  }

  return Array.from(snapshot.attachments.values()).some(isVoiceAttachment);
}

/**
 * Extract audio attachments from forwarded message snapshots
 * @internal
 */
function extractAudioFromForwardedSnapshots(message: Message): TranscriptionAttachment[] {
  const snapshots = getSnapshots(message);
  if (snapshots === undefined) {
    return [];
  }

  for (const snapshot of snapshots.values()) {
    const snapshotAttachments = extractAudioFromSnapshot(snapshot);
    if (snapshotAttachments.length > 0) {
      return snapshotAttachments; // Return first snapshot with audio
    }
  }

  return [];
}

/**
 * Result of voice transcription
 */
interface VoiceTranscriptionResult {
  /** Transcript text */
  transcript: string;
  /** Whether the message also targets a personality (mention/reply) */
  continueToPersonalityHandler: boolean;
}

/**
 * Handles voice message transcription and caching
 */
export class VoiceTranscriptionService {
  /**
   * Check if message contains voice attachment (in direct attachments or forwarded message snapshots)
   * Uses centralized utilities from forwardedMessageUtils.ts for consistent forwarded message handling.
   */
  hasVoiceAttachment(message: Message): boolean {
    // Direct attachments (forwarded snapshots handled below).
    const hasDirectAudio = message.attachments.some(isVoiceAttachment);

    if (hasDirectAudio) {
      return true;
    }

    // Check forwarded message snapshots using centralized utility
    if (!hasForwardedSnapshots(message)) {
      return false;
    }

    const snapshots = getSnapshots(message);
    if (snapshots === undefined) {
      return false;
    }

    for (const snapshot of snapshots.values()) {
      if (snapshotHasAudio(snapshot)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Transcribe voice message and send to Discord
   *
   * @param message - Discord message with voice attachment
   * @param hasMention - Whether message also has personality mention
   * @param isReply - Whether message is a reply
   * @returns Transcript text if successful, undefined on error
   */
  async transcribe(
    message: Message,
    hasMention: boolean,
    isReply: boolean
  ): Promise<VoiceTranscriptionResult | null> {
    // Skip transcription of bot's own voice messages (e.g., forwarded TTS)
    if (message.author.id === message.client.user?.id) {
      logger.debug({ messageId: message.id }, 'Skipping transcription of bot own message');
      return null;
    }

    // Extract voice attachment metadata first (direct + forwarded snapshot
    // paths). Doing this BEFORE the typing indicator + gateway call lets us
    // bail out early when the audio is our own bot's TTS output (encoded in
    // the filename) — no STT cost, no fake typing indicator, no wait.
    const attachments = this.resolveTranscriptionAttachments(message);

    // Bot-authored audio short-circuit. Discord's MessageSnapshot strips
    // author metadata from forwards (see botAudioClassifier.ts), so the only
    // reliable signal that the inner audio came from our own TTS is the
    // attachment filename, which we control at upload time. The classifier
    // check itself is synchronous (regex per attachment) — the async cache
    // write only fires on the matched branch, keeping the unmatched
    // path microtask-equivalent to the pre-fix behavior.
    const ownAuthoredSlugs = this.classifyAsOwnBotAudio(message, attachments);
    if (ownAuthoredSlugs !== null) {
      return this.handleOwnBotAudio(attachments, ownAuthoredSlugs, hasMention, isReply);
    }

    let typingInterval: NodeJS.Timeout | undefined;
    try {
      // Show typing indicator (if channel supports it). All sendTyping calls
      // route through the helper for fire-and-forget semantics + latency
      // telemetry — see sendTypingIndicator's docstring for why we never
      // await sendTyping directly.
      //
      // Order matters: arm the interval BEFORE the initial send so that if
      // the initial send fails with `channel-unreachable`, handleTypingError
      // can clear the interval immediately. Reversed order means the initial
      // send sees `typingInterval = undefined` and the interval fires once
      // more before self-terminating. JobTracker.trackJob uses this same
      // order for the same reason.
      if ('sendTyping' in message.channel) {
        const channel = message.channel;
        typingInterval = setInterval(() => {
          sendTypingIndicator(channel, {
            logger,
            source: 'voice-transcription-interval',
            typingInterval,
            extraContext: { messageId: message.id },
          });
        }, TYPING_INDICATOR_INTERVAL_MS);
        sendTypingIndicator(channel, {
          logger,
          source: 'voice-transcription-initial',
          typingInterval,
          extraContext: { messageId: message.id },
        });
      }

      // Send transcribe job to api-gateway (include userId for BYOK key resolution)
      const response = await transcribe(attachments, message.author.id);

      if (!response?.content) {
        throw new Error('No transcript returned from transcription service');
      }

      // Chunk the transcript (respecting 2000 char Discord limit)
      const chunks = splitMessage(response.content);

      logger.info(
        { chars: response.content.length, chunks: chunks.length },
        'Transcription complete'
      );

      // Cache BEFORE Discord replies (default TTL via voiceTranscriptCache).
      // Pass `originalUrl` — same field ai-worker reads in `lookupCachedTranscript`;
      // the cache strips the volatile CDN signature query so store and lookup
      // derive the same key regardless of which signed URL each side holds.
      const voiceAttachment = attachments[0]; // We know there's at least one
      if (voiceAttachment !== undefined && voiceAttachment !== null) {
        await voiceTranscriptCache.store(voiceAttachment.originalUrl, response.content);
        logger.debug(
          { urlPreview: voiceAttachment.url.substring(0, 50) },
          'Cached transcript for attachment'
        );
      }

      // Send chunks + the attribution suffix to Discord as message replies.
      // These appear BEFORE the personality webhook response so the user
      // sees their transcript first. Footer is suppressed when the user
      // has set `showModelFooter: false` (resolved server-side).
      await sendTranscriptChunks(
        message,
        chunks,
        formatProviderAttribution(response.provider, response.showModelFooter)
      );

      // Determine if we should continue to personality handler
      const continueToPersonalityHandler = hasMention || isReply;

      if (continueToPersonalityHandler) {
        logger.debug(
          'Voice message with personality mention/reply - continuing to personality handler'
        );
      }

      return {
        transcript: response.content,
        continueToPersonalityHandler,
      };
    } catch (error) {
      logger.error({ err: error }, 'Error transcribing voice message');

      const userMessage = isTimeoutError(error)
        ? 'Sorry, transcription is taking too long \u2014 the voice service may be starting up. Please try again in a moment.'
        : isTooLongError(error)
          ? 'Sorry, that voice message is too long to transcribe. Please try sending a shorter one.'
          : "Sorry, I couldn't transcribe that voice message.";

      await message
        .reply({
          content: userMessage,
          allowedMentions: { parse: [], repliedUser: false },
        })
        .catch(replyError => {
          logger.warn(
            { err: replyError, messageId: message.id },
            'Failed to send error message to user'
          );
        });
      return null;
    } finally {
      if (typingInterval !== undefined) {
        clearInterval(typingInterval);
      }
    }
  }

  /**
   * Resolve the audio attachments that should drive transcription, checking
   * direct attachments first and falling back to forwarded-message snapshots.
   * Returns an empty array when neither path has audio.
   */
  private resolveTranscriptionAttachments(message: Message): TranscriptionAttachment[] {
    const direct = extractAudioFromSnapshot({ attachments: message.attachments });
    if (direct.length > 0) {
      return direct;
    }
    if (!hasForwardedSnapshots(message)) {
      return [];
    }
    const forwarded = extractAudioFromForwardedSnapshots(message);
    if (forwarded.length > 0) {
      logger.debug('Found audio in forwarded message snapshot');
    }
    return forwarded;
  }

  /**
   * Synchronous classifier: returns the personality slugs when ALL
   * attachments came from this bot's own TTS output, or null otherwise.
   *
   * Mixed-authorship handling: only matches when ALL attachments are
   * bot-authored. A mixed batch (rare in practice — voice messages are
   * typically single-attachment) returns null so the normal STT path
   * preserves the human-authored audio's transcription.
   */
  private classifyAsOwnBotAudio(
    message: Message,
    attachments: TranscriptionAttachment[]
  ): string[] | null {
    const clientId = message.client.user?.id;
    if (clientId === undefined || attachments.length === 0) {
      return null;
    }
    const slugs: string[] = [];
    for (const attachment of attachments) {
      const classification = classifyBotAudio(attachment.name, clientId);
      if (!classification.isOwnBotAudio) {
        return null;
      }
      if (classification.personalitySlug !== undefined) {
        slugs.push(classification.personalitySlug);
      }
    }
    return slugs;
  }

  /**
   * Async path for bot-authored audio: cache the placeholder and return it as
   * the transcript (model-facing context only), then bail. Deliberately
   * silent — the skip is logged, never announced in-channel. "We didn't
   * re-transcribe our own TTS" is an implementation detail the user shouldn't
   * see; if the forward addresses the bot (mention/reply), the persona handler
   * still produces a normal response using the cached placeholder as context.
   * Called only when `classifyAsOwnBotAudio` matched.
   */
  private async handleOwnBotAudio(
    attachments: TranscriptionAttachment[],
    slugs: string[],
    hasMention: boolean,
    isReply: boolean
  ): Promise<VoiceTranscriptionResult> {
    const slugLabel = slugs.length > 0 ? slugs.join(', ') : 'one of our personas';
    const placeholder = `🔁 *Forwarded voice message originally spoken by \`${slugLabel}\` — original audio not re-transcribed.*`;
    logger.info(
      { slugs, attachmentCount: attachments.length },
      'Skipping STT for own-bot forwarded voice message'
    );
    // Cache the placeholder so a re-forward of the same attachment hits the
    // cache instead of re-running this classifier (cheap, but consistent with
    // the existing cache pattern for human-authored transcripts). Pass
    // `originalUrl` to match store-1 + the ai-worker lookup key.
    for (const attachment of attachments) {
      await voiceTranscriptCache.store(attachment.originalUrl, placeholder);
    }
    return {
      transcript: placeholder,
      continueToPersonalityHandler: hasMention || isReply,
    };
  }
}
