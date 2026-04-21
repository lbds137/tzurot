/**
 * Discord Response Sender
 *
 * Handles sending AI responses to Discord via webhooks or DMs.
 * Manages message chunking, model indicators, and webhook storage.
 */

import type { Message, DMChannel } from 'discord.js';
import { TextChannel, ThreadChannel } from 'discord.js';
import {
  splitMessage,
  createLogger,
  AI_ENDPOINTS,
  GUEST_MODE,
  DISCORD_LIMITS,
  BOT_FOOTER_TEXT,
  buildModelFooterText,
} from '@tzurot/common-types';
import type { LoadedPersonality } from '@tzurot/common-types';
import { WebhookManager } from '../utils/WebhookManager.js';
import { redisService } from '../redis.js';

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
interface SendResponseOptions {
  /** The AI response content */
  content: string;
  /** The personality to send as */
  personality: LoadedPersonality;
  /** The original user message (for context and replies) */
  message: Message;
  /** Model name used for generation (optional, adds indicator) */
  modelUsed?: string;
  /** Whether response was generated in guest mode (free model, no API key) */
  isGuestMode?: boolean;
  /** Whether this is an auto-response from channel activation (not @mention) */
  isAutoResponse?: boolean;
  /** Whether focus mode was active (LTM retrieval skipped) */
  focusModeEnabled?: boolean;
  /** Whether incognito mode was active (LTM storage skipped) */
  incognitoModeActive?: boolean;
  /**
   * Extracted thinking/reasoning content from <think> tags.
   * If present, will be sent as a separate message before the main response.
   * Displayed in a collapsible spoiler format.
   */
  thinkingContent?: string;
  /**
   * Whether to display thinking content.
   * From the user's LLM config (preset or override).
   */
  showThinking?: boolean;
  /** Whether to show the model indicator footer (from config cascade) */
  showModelFooter?: boolean;
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
 * Append footer to the last chunk, or add as a new chunk if it would overflow.
 */
function appendFooterToChunks(chunks: string[], footer: string): void {
  if (chunks.length === 0 || footer.length === 0) {
    return;
  }
  const lastIndex = chunks.length - 1;
  if (chunks[lastIndex].length + footer.length <= DISCORD_LIMITS.MESSAGE_LENGTH) {
    chunks[lastIndex] += footer;
  } else {
    chunks.push(footer.trimStart());
  }
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
   */
  async sendResponse(options: SendResponseOptions): Promise<DiscordSendResult> {
    const { content, personality, message } = options;

    // Send thinking content as a separate message before the main response
    if (
      options.showThinking === true &&
      options.thinkingContent !== undefined &&
      options.thinkingContent.length > 0
    ) {
      await this.sendThinkingBlock(message, personality, options.thinkingContent);
    }

    const footer = this.buildFooter(options);
    const ttsFiles = await this.fetchTTSFiles(options.ttsAudioKey, options.ttsAudioContentType);

    // Determine routing and build chunks
    const isWebhookChannel =
      message.guild !== null &&
      (message.channel instanceof TextChannel || message.channel instanceof ThreadChannel);

    const rawContent = isWebhookChannel ? content : `**${personality.displayName}:** ${content}`;
    const chunks = splitMessage(rawContent);
    appendFooterToChunks(chunks, footer);

    const chunkMessageIds: string[] = [];
    const sendOpts: ChunkedSendOptions = { chunks, personality, chunkMessageIds, ttsFiles };

    if (isWebhookChannel) {
      await this.sendViaWebhook(message.channel, sendOpts);
    } else {
      await this.sendViaDM(message.channel as DMChannel, sendOpts);
    }

    logger.debug(
      {
        chunks: chunkMessageIds.length,
        isWebhook: isWebhookChannel,
        personalityName: personality.name,
      },
      '[DiscordResponseSender] Response sent successfully'
    );

    return {
      chunkMessageIds,
      chunkCount: chunkMessageIds.length,
    };
  }

  /** Send via webhook (guild channels) */
  private async sendViaWebhook(
    channel: TextChannel | ThreadChannel,
    opts: ChunkedSendOptions
  ): Promise<void> {
    const { chunks, personality, chunkMessageIds, ttsFiles } = opts;

    for (let i = 0; i < chunks.length; i++) {
      // Attach TTS audio to the last chunk (same placement as footer)
      const isLastChunk = i === chunks.length - 1;
      const files = isLastChunk ? ttsFiles : undefined;

      const sentMessage = await this.webhookManager.sendAsPersonality(
        channel,
        personality,
        chunks[i],
        files
      );

      if (sentMessage !== null && sentMessage !== undefined) {
        await redisService.storeWebhookMessage(sentMessage.id, personality.id);
        chunkMessageIds.push(sentMessage.id);
      }
    }
  }

  /** Send via DM (adds personality prefix) */
  private async sendViaDM(dmChannel: DMChannel, opts: ChunkedSendOptions): Promise<void> {
    const { chunks, personality, chunkMessageIds, ttsFiles } = opts;

    for (let i = 0; i < chunks.length; i++) {
      // Attach TTS audio to the last chunk
      const isLastChunk = i === chunks.length - 1;
      const files = isLastChunk ? ttsFiles : undefined;

      const sentMessage = await dmChannel.send({
        content: chunks[i],
        ...(files !== undefined && { files }),
      });

      await redisService.storeWebhookMessage(sentMessage.id, personality.id);
      chunkMessageIds.push(sentMessage.id);
    }
  }

  /** Build the footer string from response options (model indicator, mode badges) */
  private buildFooter(options: SendResponseOptions): string {
    const {
      modelUsed,
      isGuestMode,
      isAutoResponse,
      focusModeEnabled,
      incognitoModeActive,
      showModelFooter,
    } = options;
    let footer = '';
    if (showModelFooter !== false && modelUsed !== undefined && modelUsed.length > 0) {
      const modelUrl = `${AI_ENDPOINTS.OPENROUTER_MODEL_CARD_URL}/${encodeURIComponent(modelUsed)}`;
      footer += `\n-# ${buildModelFooterText(modelUsed, modelUrl, isAutoResponse === true)}`;
    } else if (isAutoResponse === true) {
      footer += `\n-# ${BOT_FOOTER_TEXT.AUTO_RESPONSE}`;
    }
    if (isGuestMode === true) {
      footer += `\n-# ${GUEST_MODE.FOOTER_MESSAGE}`;
    }
    if (focusModeEnabled === true) {
      footer += `\n-# ${BOT_FOOTER_TEXT.FOCUS_MODE}`;
    }
    if (incognitoModeActive === true) {
      footer += `\n-# ${BOT_FOOTER_TEXT.INCOGNITO_MODE}`;
    }
    return footer;
  }

  /** Fetch TTS audio files from Redis, if a key is provided.
   *
   * When the audio exceeds Discord's 8 MiB attachment limit, returns a tiny text
   * attachment in its place so the user has a visible signal that voice was
   * attempted but couldn't be delivered — rather than a silent drop where the
   * text arrives without audio and the user assumes the bot is broken.
   */
  private async fetchTTSFiles(
    ttsAudioKey?: string,
    contentType?: string
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
    return [{ attachment: audioBuffer, name: `voice.${extension}` }];
  }

  /**
   * Send thinking/reasoning content as a collapsible message
   *
   * Uses Discord's spoiler format to make the thinking content collapsible.
   * This allows users to optionally view the model's reasoning process
   * without cluttering the main conversation.
   *
   * Format:
   * 💭 **Thinking:** ||
   * [content hidden in spoiler]
   * ||
   *
   * For very long thinking content, splits into multiple messages.
   */
  private async sendThinkingBlock(
    message: Message,
    personality: LoadedPersonality,
    thinkingContent: string
  ): Promise<void> {
    const HEADER = '💭 **Thinking:**';

    // Calculate available space for content in spoiler
    // Format: "💭 **Thinking:**\n||content||"
    // Reserve space for header, newlines, and spoiler markers (|| ... ||)
    const OVERHEAD = HEADER.length + 1 + 4; // +1 for \n, +4 for || and ||
    const MAX_CONTENT_PER_MESSAGE = DISCORD_LIMITS.MESSAGE_LENGTH - OVERHEAD;

    // Truncate thinking content if it's extremely long (rare edge case)
    // Most thinking blocks are under 10k chars; Discord allows up to 6 messages
    const MAX_THINKING_LENGTH = MAX_CONTENT_PER_MESSAGE * 3; // Allow up to 3 messages
    const truncatedContent =
      thinkingContent.length > MAX_THINKING_LENGTH
        ? thinkingContent.substring(0, MAX_THINKING_LENGTH) + '\n[...truncated]'
        : thinkingContent;

    // Escape any existing spoiler markers in the content to prevent format breaking
    const escapedContent = truncatedContent.replace(/\|\|/g, '\\|\\|');

    // Use existing splitMessage utility for natural boundary splitting
    const chunks = splitMessage(escapedContent, MAX_CONTENT_PER_MESSAGE);

    // Determine channel type
    const isWebhookChannel =
      message.guild !== null &&
      (message.channel instanceof TextChannel || message.channel instanceof ThreadChannel);

    // Send each chunk as a spoiler message
    for (let i = 0; i < chunks.length; i++) {
      const isFirst = i === 0;
      const chunkContent = isFirst ? `${HEADER}\n||${chunks[i]}||` : `||${chunks[i]}||`;

      try {
        if (isWebhookChannel) {
          // Send via webhook (matches personality appearance)
          await this.webhookManager.sendAsPersonality(message.channel, personality, chunkContent);
        } else {
          // Send via DM (with personality prefix, no reply indicator)
          await (message.channel as DMChannel).send(
            `**${personality.displayName}:** ${chunkContent}`
          );
        }
      } catch (error) {
        logger.warn(
          { err: error, chunk: i + 1, totalChunks: chunks.length },
          '[DiscordResponseSender] Failed to send thinking block chunk'
        );
        // Continue with main response even if thinking fails
        break;
      }
    }

    logger.debug(
      {
        thinkingLength: thinkingContent.length,
        chunks: chunks.length,
        personalityName: personality.name,
      },
      '[DiscordResponseSender] Sent thinking block'
    );
  }
}
