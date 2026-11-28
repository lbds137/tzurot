/**
 * Discord Response Sender
 *
 * Handles sending AI responses to Discord via webhooks or DMs.
 * Manages message chunking, model indicators, and webhook storage.
 */

import { type DMChannel, NewsChannel, TextChannel, ThreadChannel } from 'discord.js';
import { DISCORD_LIMITS } from '@tzurot/common-types/constants/discord';
import { type TypingChannel } from '@tzurot/common-types/types/discord-types';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { splitMessage } from '@tzurot/common-types/utils/discord';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { type WebhookManager } from '../utils/WebhookManager.js';
import { redisService } from '../redis.js';
import { appendFooterToChunks } from '../utils/appendFooterToChunks.js';
import { buildBotAudioFilename } from '../utils/botAudioClassifier.js';
import { classifyDmError, dmErrorCode } from '../utils/dmErrorClassifier.js';
import { reportPersonaDmUndeliverable } from '../utils/retentionGatewayCalls.js';
import { stripDmPrefix, toSendFailure } from './partialDelivery.js';
import { buildResponseFooter, type ResponseFooterOptions } from './responseFooter.js';

const logger = createLogger('DiscordResponseSender');

/**
 * Result of sending a Discord response
 */
interface DiscordSendResult {
  /** Discord message IDs for all chunks sent */
  chunkMessageIds: string[];
  /** Number of chunks sent */
  chunkCount: number;
}

/**
 * Options for sending a Discord response
 */
interface SendResponseOptions extends ResponseFooterOptions {
  /** The AI response content */
  content: string;
  /** The personality to send as */
  personality: LoadedPersonality;
  /**
   * Channel to deliver the response to. Webhook delivery is used for
   * TextChannel/ThreadChannel when guildId is set; DM delivery is used
   * for DMChannel (guildId === null).
   */
  channel: TypingChannel;
  /** Guild ID, or null for DM channels — picks webhook vs DM routing. */
  guildId: string | null;
  /**
   * Bot's Discord application ID. Used to build TTS audio filenames
   * the receive-side classifier can recognize on forward. Optional
   * because discord.js types `client.user` as nullable; falls back to
   * a legacy filename shape when absent.
   */
  clientId: string | undefined;
  /** Redis key for TTS audio buffer (set by ai-worker TTSStep) */
  ttsAudioKey?: string;
  /** MIME type of TTS audio (e.g., 'audio/wav', 'audio/mpeg') for file extension */
  ttsAudioContentType?: string;
}

/** Shared options for internal send methods */
interface ChunkedSendOptions {
  chunks: string[];
  personality: LoadedPersonality;
  chunkMessageIds: string[];
  ttsFiles?: { attachment: Buffer; name: string }[];
}

/**
 * Sends AI responses to Discord channels via webhooks or DMs
 */
export class DiscordResponseSender {
  private webhookManager: WebhookManager;

  constructor(webhookManager: WebhookManager) {
    this.webhookManager = webhookManager;
  }

  /**
   * Send AI response to Discord
   *
   * Handles:
   * - Model indicator addition (appended to last chunk to preserve formatting)
   * - Message chunking (2000 char limit)
   * - Webhook vs DM routing
   * - Discord message ID tracking
   * - Redis webhook storage
   *
   * @throws {@link PartialDeliveryError} (from `./partialDelivery.js`) when a
   * chunk fails after at least one earlier chunk was already delivered; the
   * original error otherwise. See `sendResponse` tests in
   * `DiscordResponseSender.test.ts` ("propagates a webhook send failure
   * instead of returning a short id list" and the partial-delivery cases).
   */
  async sendResponse(options: SendResponseOptions): Promise<DiscordSendResult> {
    const { content, personality, channel, guildId, clientId } = options;

    const footer = buildResponseFooter(options);
    const ttsFiles = await this.fetchTTSFiles(
      options.ttsAudioKey,
      options.ttsAudioContentType,
      personality.slug,
      clientId
    );

    // Webhook delivery in guild text/announcement/thread channels;
    // DM channel.send otherwise. NewsChannel (announcement channels)
    // supports webhooks the same way TextChannel does.
    const isWebhookChannel =
      guildId !== null &&
      (channel instanceof TextChannel ||
        channel instanceof NewsChannel ||
        channel instanceof ThreadChannel);

    const dmPrefix = `**${personality.displayName}:** `;
    const rawContent = isWebhookChannel ? content : dmPrefix + content;
    const chunks = splitMessage(rawContent);
    // Undecorated parallel of `chunks`, captured BEFORE `appendFooterToChunks`
    // mutates the last entry with the footer, and with the DM speaker prefix
    // stripped off chunk 0. A persisted partial-delivery row must read like a
    // truncated success row — `result.content` is stored undecorated, without
    // the DM prefix — and the footer/TTS decoration rides only the LAST
    // chunk (or a chunk of its own), which a mid-stream failure never
    // delivers, so `plainChunks` excludes it by construction. Any forced-
    // split markers `splitMessage` itself applies (a trailing "..." on a
    // force-split fragment, re-balanced code fences) are NOT removed here —
    // they're internal to the splitter, not this layer's decoration.
    const plainChunks = chunks.map((chunk, i) =>
      i === 0 && !isWebhookChannel ? stripDmPrefix(chunk, dmPrefix) : chunk
    );
    appendFooterToChunks(chunks, footer);

    const chunkMessageIds: string[] = [];
    const sendOpts: ChunkedSendOptions = { chunks, personality, chunkMessageIds, ttsFiles };

    try {
      if (isWebhookChannel) {
        await this.sendViaWebhook(channel, sendOpts);
      } else {
        // Cast invariant: within TypingChannel (TextChannel | DMChannel |
        // NewsChannel | PublicThread | PrivateThread), reaching this branch
        // requires guildId === null AND not-instanceof-Text/News/Thread —
        // which leaves only DMChannel. If TypingChannel ever expands,
        // re-derive the membership rather than trusting this cast.
        await this.sendViaDM(channel as DMChannel, sendOpts);
      }
    } catch (error) {
      throw toSendFailure(error, { chunkMessageIds, plainChunks, totalChunks: chunks.length });
    }

    logger.debug(
      {
        chunks: chunkMessageIds.length,
        isWebhook: isWebhookChannel,
        personalityName: personality.name,
      },
      'Response sent successfully'
    );

    return {
      chunkMessageIds,
      chunkCount: chunkMessageIds.length,
    };
  }

  /** Send via webhook (guild channels) */
  private async sendViaWebhook(
    channel: TextChannel | NewsChannel | ThreadChannel,
    opts: ChunkedSendOptions
  ): Promise<void> {
    const { chunks, personality, chunkMessageIds, ttsFiles } = opts;

    for (let i = 0; i < chunks.length; i++) {
      // Attach TTS audio to the last chunk (same placement as footer)
      const isLastChunk = i === chunks.length - 1;
      const files = isLastChunk ? ttsFiles : undefined;

      // `sendAsPersonality` returns a non-nullable Message and throws on
      // failure, so the id push is unconditional — identical to `sendViaDM`.
      // A failed chunk aborts the loop; `sendResponse`'s wrapping try/catch
      // converts the abort into a `PartialDeliveryError` carrying the ids
      // pushed so far (zero delivered chunks means the original error
      // propagates unchanged) — see `toSendFailure` and its tests in
      // `partialDelivery.test.ts`, plus the webhook partial-delivery cases in
      // `DiscordResponseSender.test.ts`.
      const sentMessage = await this.webhookManager.sendAsPersonality(
        channel,
        personality,
        chunks[i],
        files
      );

      chunkMessageIds.push(sentMessage.id);
      await redisService.storeWebhookMessage(sentMessage.id, personality.id);
    }
  }

  /** Send via DM (adds personality prefix) */
  private async sendViaDM(dmChannel: DMChannel, opts: ChunkedSendOptions): Promise<void> {
    const { chunks, personality, chunkMessageIds, ttsFiles } = opts;

    for (let i = 0; i < chunks.length; i++) {
      // Attach TTS audio to the last chunk
      const isLastChunk = i === chunks.length - 1;
      const files = isLastChunk ? ttsFiles : undefined;

      let sentMessage;
      try {
        sentMessage = await dmChannel.send({
          content: chunks[i],
          ...(files !== undefined && { files }),
        });
      } catch (error) {
        const classified = classifyDmError(error);
        if (classified.kind === 'permanent') {
          // Fire-and-forget: the failed reply path must not also wait on a
          // gateway round trip. Rethrow below preserves the caller's existing
          // failure handling unchanged.
          reportPersonaDmUndeliverable(dmChannel.recipientId, dmErrorCode(classified));
        }
        throw error;
      }

      chunkMessageIds.push(sentMessage.id);
      await redisService.storeWebhookMessage(sentMessage.id, personality.id);
    }
  }

  /** Fetch TTS audio files from Redis, if a key is provided.
   *
   * When the audio exceeds Discord's 8 MiB attachment limit, returns a tiny text
   * attachment in its place so the user has a visible signal that voice was
   * attempted but couldn't be delivered — rather than a silent drop where the
   * text arrives without audio and the user assumes the bot is broken.
   *
   * The audio attachment filename encodes the bot's clientId and personality
   * slug (`{clientId}-{slug}-{timestamp}.{ext}`) so the receive-side STT path
   * can recognize forwards of our own TTS output and skip transcription —
   * Discord's `MessageSnapshot` strips author metadata from forwards, but
   * preserves attachment names. See `botAudioClassifier.ts` for full rationale.
   */
  private async fetchTTSFiles(
    ttsAudioKey: string | undefined,
    contentType: string | undefined,
    personalitySlug: string,
    clientId: string | undefined
  ): Promise<{ attachment: Buffer; name: string }[] | undefined> {
    if (ttsAudioKey === undefined) {
      return undefined;
    }
    const audioBuffer = await redisService.getTTSAudio(ttsAudioKey);
    if (audioBuffer === null) {
      logger.warn({ ttsAudioKey }, 'TTS audio expired or not found');
      return undefined;
    }
    // Discord non-Nitro servers have an 8 MiB file upload limit. In the common case
    // this never fires post-transcode (Opus at 64 kbps = ~17 min of speech under 8 MiB).
    // The fallback attachment is for residual cases: transcoding disabled / failed,
    // or text long enough to exceed the limit even compressed.
    if (audioBuffer.length > DISCORD_LIMITS.FILE_UPLOAD_MAX_BYTES) {
      const audioMb = (audioBuffer.length / (1024 * 1024)).toFixed(2);
      logger.warn(
        {
          ttsAudioKey,
          audioSize: audioBuffer.length,
          audioMb,
          limit: DISCORD_LIMITS.FILE_UPLOAD_MAX_BYTES,
          contentType,
        },
        'TTS audio exceeds Discord file size limit, attaching over-size notice instead'
      );
      const notice = Buffer.from(
        `Voice response was too long to attach (${audioMb} MB, Discord limit 8 MB).\n` +
          `The text response was delivered successfully.`,
        'utf-8'
      );
      return [{ attachment: notice, name: 'voice_omitted_too_long.txt' }];
    }
    logger.debug({ ttsAudioKey, audioSize: audioBuffer.length, contentType }, 'TTS audio fetched');
    // Determine file extension from content type. Voice-engine now returns Opus-in-Ogg
    // (audio/ogg) by default; ElevenLabs returns MP3; both are compressed and typically
    // fit well under 8 MiB. WAV fallback remains for the multi-chunk synthesis path.
    const extension =
      contentType === 'audio/mpeg' ? 'mp3' : contentType === 'audio/ogg' ? 'ogg' : 'wav';
    // When the client identity isn't available (shouldn't happen post-login,
    // but typed as optional on discord.js), fall back to the legacy `voice.{ext}`
    // shape. The receive-side classifier won't recognize it, so a forward of
    // such a message would re-transcribe — strictly safer than blocking the
    // upload.
    const name =
      clientId !== undefined
        ? buildBotAudioFilename({ clientId, personalitySlug, extension })
        : `voice.${extension}`;
    return [{ attachment: audioBuffer, name }];
  }
}
