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
import { isTypingChannel } from '@tzurot/common-types/types/discord-types';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { isBotOwner } from '@tzurot/common-types/utils/ownerMiddleware';
import { generate } from '../../utils/gatewayServiceCalls.js';
import { clientsForUser } from '../../utils/gatewayClients.js';
import { resolveChatLlmConfig, buildExtendedContextSettings } from './chatConfigResolution.js';
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
    const resolvedConfig = await resolveChatLlmConfig(userClient, personality, message.channel.id);

    const extendedContextSettings = buildExtendedContextSettings(resolvedConfig);

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

    const buildResult = await this.contextBuilder.buildContext(message, personality, content, {
      extendedContext: extendedContextSettings,
      botUserId,
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
