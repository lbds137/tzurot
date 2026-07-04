/**
 * Personality Chat Manager
 *
 * Owns the domain pipeline for an @mention/reply/auto-response chat:
 * gates (denylist, NSFW), config resolution, context build, reference
 * enrichment, user-message persistence, and gateway job submission.
 *
 * Does NOT own delivery or tracking — the caller (PersonalityMessageHandler)
 * receives a tracking context and hands it to JobTracker.
 *
 * The slash-command path (`/character chat`) builds its own context with
 * command-invoker identity overrides and weigh-in semantics, so it bypasses
 * the manager entirely — the manager exists for the canonical Discord-Message
 * pipeline only.
 */

import type { Message, SendableChannels } from 'discord.js';
import { MESSAGE_LIMITS } from '@tzurot/common-types/constants/message';
import { type SettingSource } from '@tzurot/common-types/schemas/api/adminSettings';
import { type ConfigResolutionResult } from '@tzurot/common-types/types/configResolution';
import { isTypingChannel } from '@tzurot/common-types/types/discord-types';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { isBotOwner } from '@tzurot/common-types/utils/ownerMiddleware';
import type { UserClient } from '@tzurot/clients';
import { generate } from '../../utils/gatewayServiceCalls.js';
import { clientsForUser } from '../../utils/gatewayClients.js';
import { type MessageContextBuilder } from '../MessageContextBuilder.js';
import { type ConversationPersistence } from '../ConversationPersistence.js';
import {
  handleNsfwVerification,
  sendVerificationConfirmation,
} from '../../utils/nsfwVerification.js';
import type { DenylistCache } from '../DenylistCache.js';
import type { MessageJobContext } from '../JobTracker.js';

const logger = createLogger('PersonalityChatManager');

export interface PersonalityChatManagerDeps {
  contextBuilder: MessageContextBuilder;
  persistence: ConversationPersistence;
  denylistCache?: DenylistCache;
}

export interface SubmitChatJobInput {
  message: Message;
  personality: LoadedPersonality;
  content: string;
  isAutoResponse?: boolean;
}

export type SubmitChatJobResult =
  | {
      kind: 'submitted';
      jobId: string;
      /**
       * Ready-to-track context. The caller passes
       * `(jobId, trackingContext.channel, trackingContext)` to JobTracker.
       */
      trackingContext: MessageJobContext;
    }
  | {
      kind: 'denied';
      reason: 'denylisted' | 'nsfw-blocked' | 'unsupported-channel';
    };

export class PersonalityChatManager {
  private readonly contextBuilder: MessageContextBuilder;
  private readonly persistence: ConversationPersistence;
  private readonly denylistCache?: DenylistCache;

  constructor(deps: PersonalityChatManagerDeps) {
    this.contextBuilder = deps.contextBuilder;
    this.persistence = deps.persistence;
    this.denylistCache = deps.denylistCache;
  }

  /**
   * Resolve LLM config from gateway, applying user overrides.
   * Falls back to personality defaults on error so a transient gateway
   * blip degrades gracefully rather than failing the request.
   */
  private async resolveConfig(
    userClient: UserClient,
    personality: LoadedPersonality,
    channelId?: string
  ): Promise<ConfigResolutionResult> {
    const result = await userClient.resolveUserLlmConfig({
      personalityId: personality.id,
      personalityConfig: personality,
      channelId,
    });

    if (!result.ok) {
      logger.warn(
        { userId: userClient.actor, personalityId: personality.id, error: result.error },
        'Failed to resolve config, using personality defaults'
      );
      return {
        config: {
          model: personality.model,
          maxMessages: personality.maxMessages ?? MESSAGE_LIMITS.DEFAULT_MAX_MESSAGES,
          maxAge: personality.maxAge ?? null,
          maxImages: personality.maxImages ?? MESSAGE_LIMITS.DEFAULT_MAX_IMAGES,
        },
        source: 'personality',
      };
    }

    // Cast bridges the runtime ConfigResolutionResult shape (declared on the
    // server, in services/LlmConfigResolver.ts) and the schema's narrower
    // declared response (only required fields, rest .passthrough()).
    return result.data as unknown as ConfigResolutionResult;
  }

  /**
   * Build extended-context settings from resolved config.
   * Prefers per-field cascade overrides (`overrides.sources`) when available
   * so the caller can attribute each setting to its tier of origin.
   */
  private buildExtendedContextSettings(resolvedConfig: ConfigResolutionResult): {
    maxMessages: number;
    maxAge: number | null;
    maxImages: number;
    sources: {
      maxMessages: SettingSource;
      maxAge: SettingSource;
      maxImages: SettingSource;
    };
  } {
    const { config, source, overrides } = resolvedConfig;

    if (overrides !== undefined) {
      return {
        maxMessages: overrides.maxMessages,
        maxAge: overrides.maxAge,
        maxImages: overrides.maxImages,
        sources: {
          maxMessages: overrides.sources.maxMessages,
          maxAge: overrides.sources.maxAge,
          maxImages: overrides.sources.maxImages,
        },
      };
    }

    // ConfigResolutionSource includes a TTS-only tier 'free-default' that
    // SettingSource (dashboard taxonomy) doesn't share. LLM resolution
    // never produces it in practice; narrow defensively in case the union
    // surface widens.
    const settingSource: SettingSource = source === 'free-default' ? 'hardcoded' : source;
    return {
      maxMessages: config.maxMessages ?? MESSAGE_LIMITS.DEFAULT_MAX_MESSAGES,
      maxAge: config.maxAge ?? null,
      maxImages: config.maxImages ?? 10,
      sources: {
        maxMessages: settingSource,
        maxAge: settingSource,
        maxImages: settingSource,
      },
    };
  }

  /**
   * Run the gates that produce a 'denied' result without submitting a job.
   * Returns null when the gates pass; otherwise the denial reason.
   */
  private async runGates(
    message: Message,
    personality: LoadedPersonality
  ): Promise<SubmitChatJobResult | null> {
    if (
      this.denylistCache !== undefined &&
      !isBotOwner(message.author.id) &&
      this.denylistCache.isPersonalityDenied(message.author.id, personality.id)
    ) {
      logger.debug(
        { userId: message.author.id, personalityId: personality.id },
        'User denied for this personality, ignoring'
      );
      return { kind: 'denied', reason: 'denylisted' };
    }

    const verificationResult = await handleNsfwVerification(message);
    if (!verificationResult.allowed) {
      return { kind: 'denied', reason: 'nsfw-blocked' };
    }

    if (verificationResult.wasNewVerification) {
      // First-time verification gets a self-destructing confirmation. Cast
      // through SendableChannels because the helper accepts any channel that
      // implements .send (including DMs/threads/text channels).
      void sendVerificationConfirmation(message.channel as SendableChannels);
    }

    return null;
  }

  /**
   * Submit a chat job for an @mention / reply / auto-response.
   *
   * Returns 'submitted' with a ready-to-track context, or 'denied' with a
   * specific reason if a gate (denylist, NSFW, channel type) refused.
   */
  async submitChatJob(input: SubmitChatJobInput): Promise<SubmitChatJobResult> {
    const { message, personality, content, isAutoResponse } = input;
    const { channel } = message;

    const denied = await this.runGates(message, personality);
    if (denied !== null) {
      return denied;
    }

    if (!isTypingChannel(channel)) {
      logger.warn({ channelType: channel.type }, 'Unsupported channel type for AI interactions');
      return { kind: 'denied', reason: 'unsupported-channel' };
    }

    const { userClient } = clientsForUser(message.author);
    const resolvedConfig = await this.resolveConfig(userClient, personality, message.channel.id);

    const extendedContextSettings = this.buildExtendedContextSettings(resolvedConfig);

    logger.debug(
      {
        channelId: message.channel.id,
        personalityId: personality.id,
        maxMessages: extendedContextSettings.maxMessages,
        maxAge: extendedContextSettings.maxAge,
        maxImages: extendedContextSettings.maxImages,
        sources: extendedContextSettings.sources,
      },
      'Extended context settings for this request'
    );

    const botUserId = message.client.user?.id;
    const crossChannelHistoryEnabled =
      resolvedConfig.overrides?.crossChannelHistoryEnabled ?? false;

    const buildResult = await this.contextBuilder.buildContext(message, personality, content, {
      extendedContext: extendedContextSettings,
      botUserId,
      crossChannelHistoryEnabled,
    });
    const { context, personaId, messageContent } = buildResult;

    // References are NOT persisted bot-client-side: the worker re-derives them
    // from `rawReferencedMessages` in the envelope. (The previous
    // `referencedMessages: context.referencedMessages` arg was a no-op — that
    // field is never populated on the thin envelope.)
    //
    // Best-effort: a transient gateway/DB failure persisting the trigger message
    // (conversation-history durability) must NOT block generation. The worker's
    // context is already built above and shipped in the envelope, and
    // triggerMessageId is only a Redis dedup key downstream — never a DB read of
    // this row — so generation does not depend on the persist. Losing one history
    // row on a rare transient timeout beats failing the whole response (the
    // "something's slow, try again" dead-end the user otherwise hits).
    try {
      await this.persistence.saveUserMessage({
        message,
        personality,
        personaId,
        messageContent,
        attachments: context.attachments,
      });
    } catch (err) {
      logger.error(
        { err, personalityId: personality.id, messageId: message.id },
        'Trigger-message persist failed; continuing to generate (history row may be missing)'
      );
    }

    const userMessageTime = new Date();

    const { jobId } = await generate(personality, {
      ...context,
      triggerMessageId: message.id,
    });

    logger.info(
      {
        jobId,
        personalityName: personality.displayName,
      },
      'Job submitted successfully, awaiting async result'
    );

    const trackingContext: MessageJobContext = {
      kind: 'message',
      channel,
      guildId: message.guildId,
      clientId: botUserId,
      userMessageTime,
      message,
      personality,
      personaId,
      userMessageContent: messageContent,
      isAutoResponse,
    };

    return { kind: 'submitted', jobId, trackingContext };
  }
}
