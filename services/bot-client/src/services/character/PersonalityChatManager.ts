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
 * The slash-command path (`/chat`) builds its own context with
 * command-invoker identity overrides and weigh-in semantics, so it bypasses
 * the manager entirely — the manager exists for the canonical Discord-Message
 * pipeline only.
 */

import type { Message } from 'discord.js';
import { isTypingChannel, type TypingChannel } from '@tzurot/common-types/types/discord-types';
import {
  type LoadedPersonality,
  type SkippedMessage,
} from '@tzurot/common-types/types/schemas/personality';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { isBotOwner } from '@tzurot/common-types/utils/ownerMiddleware';
import { generate } from '../../utils/gatewayServiceCalls.js';
import { clientsForUser } from '../../utils/gatewayClients.js';
import { resolveChatLlmConfig, buildExtendedContextSettings } from './chatConfigResolution.js';
import { runNsfwGate, type NsfwGate } from './sharedNsfwGate.js';
import { type MessageContextBuilder } from '../MessageContextBuilder.js';
import { type ConversationPersistence } from '../ConversationPersistence.js';
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
  /**
   * Shared gate passed by a fan-out so N slots of one message evaluate and
   * reply once; absent = this submission evaluates alone (pinned in
   * `character/sharedNsfwGate.test.ts`). The gate is bound to one message, so
   * a caller must pass a gate built for this same `message`.
   */
  nsfwGate?: NsfwGate;
  /**
   * When true, skips saving the user message row inside submitChatJob because
   * the coalescing hold registry already persisted the row at hold time.
   * Defaults to false so existing callers keep the save-before-generate behavior.
   */
  skipUserMessageSave?: boolean;
  /**
   * Skipped activation-trigger messages coalesced into this survivor generation job.
   * Forwarded to the gateway only when non-empty.
   */
  skippedMessages?: SkippedMessage[];
}

export type SaveUserMessageResult =
  { kind: 'saved' } | Extract<SubmitChatJobResult, { kind: 'denied' }>;

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
      /**
       * True when the denial is a MUTE-mode denylist entry ("ignore but keep
       * in context") — the caller must not surface ANY visible acknowledgment
       * of the denial, including the all-denied unavailable notice. Absent/
       * false for BLOCK entries and non-denylist denials, which stay overt.
       */
      silent?: boolean;
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
    personality: LoadedPersonality,
    nsfwGate?: NsfwGate
  ): Promise<Extract<SubmitChatJobResult, { kind: 'denied' }> | null> {
    if (
      this.denylistCache !== undefined &&
      !isBotOwner(message.author.id) &&
      this.denylistCache.isPersonalityDenied(message.author.id, personality.id)
    ) {
      logger.debug(
        { userId: message.author.id, personalityId: personality.id },
        'User denied for this personality, ignoring'
      );
      return {
        kind: 'denied',
        reason: 'denylisted',
        silent: this.denylistCache.isPersonalityMuted(message.author.id, personality.id),
      };
    }

    const allowed = nsfwGate !== undefined ? await nsfwGate() : await runNsfwGate(message);
    if (!allowed) {
      return { kind: 'denied', reason: 'nsfw-blocked' };
    }

    return null;
  }

  /**
   * Shared pre-flight gates for both trigger paths: denylist/NSFW gates, then
   * the typing-channel check. Returns the denial to propagate, or the narrowed
   * typing channel to proceed with.
   */
  private async runPreflightGates(
    message: Message,
    personality: LoadedPersonality,
    nsfwGate?: NsfwGate
  ): Promise<
    { kind: 'ok'; channel: TypingChannel } | Extract<SubmitChatJobResult, { kind: 'denied' }>
  > {
    const denied = await this.runGates(message, personality, nsfwGate);
    if (denied !== null) {
      return denied;
    }

    if (!isTypingChannel(message.channel)) {
      logger.warn(
        { channelType: message.channel.type },
        'Unsupported channel type for AI interactions'
      );
      return { kind: 'denied', reason: 'unsupported-channel' };
    }

    return { kind: 'ok', channel: message.channel };
  }

  /**
   * Best-effort persistence of a trigger user message row.
   *
   * References are NOT persisted bot-client-side: the worker re-derives them
   * from `rawReferencedMessages` in the envelope. A transient gateway/DB failure
   * persisting the trigger message must NOT block generation or hold tracking.
   */
  private async persistTriggerMessage(
    message: Message,
    personality: LoadedPersonality,
    buildResult: Awaited<ReturnType<MessageContextBuilder['buildContext']>>
  ): Promise<void> {
    const { context, personaId, messageContent, triggerMessage, triggerEmbedsXml } = buildResult;
    try {
      await this.persistence.saveUserMessage({
        message: triggerMessage,
        personality,
        personaId,
        messageContent,
        attachments: context.attachments,
        embedsXml: triggerEmbedsXml,
      });
    } catch (err) {
      logger.error(
        { err, personalityId: personality.id, messageId: message.id },
        'Trigger-message persist failed; continuing to generate (history row may be missing)'
      );
    }
  }

  /**
   * Persist a trigger user message row without submitting a generation job.
   *
   * Used by the activation coalescing hold so a held trigger's user row lands in
   * conversation history immediately at hold time while the released survivor
   * later calls submitChatJob with `skipUserMessageSave: true`. Applies the same
   * pre-save gates (denylist, NSFW, typing-channel) as submitChatJob so a denied
   * trigger is never persisted or held.
   */
  async saveUserMessage(
    input: Pick<SubmitChatJobInput, 'message' | 'personality' | 'content' | 'nsfwGate'>
  ): Promise<SaveUserMessageResult> {
    const { message, personality, content, nsfwGate } = input;

    const preflight = await this.runPreflightGates(message, personality, nsfwGate);
    if (preflight.kind === 'denied') {
      return preflight;
    }

    const botUserId = message.client.user?.id;
    const buildResult = await this.contextBuilder.buildContext(message, personality, content, {
      botUserId,
    });
    await this.persistTriggerMessage(message, personality, buildResult);
    return { kind: 'saved' };
  }

  /**
   * Submit a chat job for an @mention / reply / auto-response.
   *
   * Returns 'submitted' with a ready-to-track context, or 'denied' with a
   * specific reason if a gate (denylist, NSFW, channel type) refused.
   */
  async submitChatJob(input: SubmitChatJobInput): Promise<SubmitChatJobResult> {
    const {
      message,
      personality,
      content,
      isAutoResponse,
      nsfwGate,
      skipUserMessageSave,
      skippedMessages,
    } = input;

    const preflight = await this.runPreflightGates(message, personality, nsfwGate);
    if (preflight.kind === 'denied') {
      return preflight;
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

    if (skipUserMessageSave !== true) {
      await this.persistTriggerMessage(message, personality, buildResult);
    }

    const userMessageTime = new Date();
    const nonEmptySkipped =
      skippedMessages !== undefined && skippedMessages.length > 0 ? skippedMessages : undefined;

    const { jobId } = await generate(personality, {
      ...context,
      triggerMessageId: message.id,
      ...(nonEmptySkipped !== undefined ? { skippedMessages: nonEmptySkipped } : {}),
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
      channel: preflight.channel,
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
