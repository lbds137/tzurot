/**
 * Message Handler
 *
 * Coordinates message processing using Chain of Responsibility pattern.
 * Each processor in the chain handles a specific type of message.
 * Implements full dependency injection for testability and flexibility.
 */

import { MessageType, type Client, type Message } from 'discord.js';
import { stripErrorSpoiler } from '@tzurot/common-types/constants/error';
import { type MaintenanceFlag } from '@tzurot/common-types/services/MaintenanceFlag';
import { type LLMGenerationResult } from '@tzurot/common-types/types/schemas/generation';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { buildErrorContent } from '../utils/buildErrorContent.js';
import { buildResultMetadataPassthrough } from '../utils/resultMetadataPassthrough.js';
import { acknowledgeMessageDuringMaintenance } from '../utils/maintenanceResponses.js';
import type { IMessageProcessor } from '../processors/IMessageProcessor.js';
import { isUserContentMessage } from '../utils/messageTypeUtils.js';
import { fetchTypingChannel } from '../utils/fetchTypingChannel.js';
import { type DiscordResponseSender } from '../services/DiscordResponseSender.js';
import { type ConversationPersistence } from '../services/ConversationPersistence.js';
import {
  type JobTracker,
  type MessageJobContext,
  type SlashJobContext,
} from '../services/JobTracker.js';
import { confirmDelivery, updateDiagnosticResponseIds } from '../utils/gatewayServiceCalls.js';
import type { SlotDeliveryService, SlotDeliveryContext } from '../services/SlotDeliveryService.js';
import type { MultiTagCoordinator } from '../services/MultiTagCoordinator.js';
import type { IPersonalityLoader } from '../types/IPersonalityLoader.js';

/** Notice prepended to a late-recovered reply so the user knows why it's late. */
const LATE_RECOVERY_NOTICE = '-# ⏰ This reply took longer than expected to generate.\n\n';

const logger = createLogger('MessageHandler');

/**
 * Message Handler - routes Discord messages using Chain of Responsibility
 */
export interface MessageHandlerDeps {
  processors: IMessageProcessor[];
  responseSender: DiscordResponseSender;
  persistence: ConversationPersistence;
  jobTracker: JobTracker;
  slotDelivery: SlotDeliveryService;
  coordinator: MultiTagCoordinator;
  /** Loads personalities by slug for late-result recovery (access-scoped). */
  personalityService: IPersonalityLoader;
  /** Discord client — re-fetches the channel for a late-recovered delivery. */
  client: Client;
  /** Maintenance-window gate — checked before the processor chain runs. */
  maintenanceFlag: MaintenanceFlag;
}

export class MessageHandler {
  private readonly processors: IMessageProcessor[];
  private readonly responseSender: DiscordResponseSender;
  private readonly persistence: ConversationPersistence;
  private readonly jobTracker: JobTracker;
  private readonly slotDelivery: SlotDeliveryService;
  private readonly coordinator: MultiTagCoordinator;
  private readonly personalityService: IPersonalityLoader;
  private readonly client: Client;
  private readonly maintenanceFlag: MaintenanceFlag;

  constructor(deps: MessageHandlerDeps) {
    this.processors = deps.processors;
    this.responseSender = deps.responseSender;
    this.persistence = deps.persistence;
    this.jobTracker = deps.jobTracker;
    this.slotDelivery = deps.slotDelivery;
    this.coordinator = deps.coordinator;
    this.personalityService = deps.personalityService;
    this.client = deps.client;
    this.maintenanceFlag = deps.maintenanceFlag;
    logger.info({ processorCount: deps.processors.length }, 'Initialized with processor chain');
  }

  /**
   * Handle incoming Discord message
   * Passes message through processor chain until one handles it
   */
  async handleMessage(message: Message): Promise<void> {
    try {
      // Skip system messages (thread creation, pinned messages, user joins, etc.)
      // Only process user-generated content (Default, Reply, Forward)
      if (!isUserContentMessage(message)) {
        logger.debug(
          {
            messageId: message.id,
            messageType: message.type,
            messageTypeName: MessageType[message.type],
          },
          'Ignoring system message'
        );
        return;
      }

      // Maintenance gate — BEFORE the processor chain, so nothing reaches the
      // (503ing) gateway during a destructive-migration window. Friendly
      // acknowledgement where it's cheap to know the message was for us
      // (DMs, @mentions); silent drop otherwise.
      if (await this.maintenanceFlag.isActive()) {
        await acknowledgeMessageDuringMaintenance(message);
        return;
      }

      logger.debug({ messageId: message.id, authorTag: message.author.tag }, 'Processing message');

      // Pass message through the chain of processors
      for (const processor of this.processors) {
        const wasHandled = await processor.process(message);

        if (wasHandled) {
          logger.debug(
            { messageId: message.id, processorName: processor.constructor.name },
            'Message handled by processor'
          );
          return; // Stop the chain
        }
      }

      // No processor handled the message
      logger.debug({ messageId: message.id }, 'Message not handled by any processor');
    } catch (error) {
      logger.error({ err: error }, 'Error processing message');

      // Try to send error message to user
      await message
        .reply('Sorry, I encountered an error processing your message.')
        .catch(replyError => {
          logger.warn(
            { err: replyError, messageId: message.id },
            'Failed to send error message to user'
          );
        });
    }
  }

  /**
   * Handle async job result when it arrives from ResultsListener
   * This is called from index.ts result handler
   */

  async handleJobResult(jobId: string, result: LLMGenerationResult): Promise<void> {
    // Multi-tag interception: in-memory map lookup (O(1)). Checked first so
    // the common single-personality path doesn't pay the Redis round-trip
    // of the stale check below. A currently-owned jobId can't also be
    // stale — it was just registered in this process — so the order is
    // semantically equivalent.
    if (this.coordinator.ownsJob(jobId)) {
      await this.coordinator.handleJobResult(jobId, result);
      return;
    }

    // Pre-restart stale check: if the jobId was marked stale during a prior
    // shutdown (because its result hadn't arrived yet), discard the result
    // silently. Recovery already submitted a fresh job; the new jobId will
    // arrive separately. confirmDelivery clears the Redis stream entry.
    //
    // Fast-path short-circuit: in normal operation (no recent shutdown, no
    // recovery pending), the stale-jobs SET is empty and the Redis
    // SISMEMBER would be wasted. The coordinator's `staleCheckNeeded` flag
    // flips true once any jobId has been marked stale during the process's
    // lifetime (either via `beginShutdown` or `MultiTagRecovery`). Skipping
    // the check in the common case saves one Redis roundtrip per single-
    // personality result.
    if (this.coordinator.staleCheckNeeded && (await this.coordinator.isStale(jobId))) {
      logger.info({ jobId }, 'Discarding result for pre-restart (stale) jobId');
      // Confirm delivery so the Redis stream entry clears, and remove the
      // jobId from the stale SET so it doesn't accumulate across the bot's
      // lifetime (each graceful shutdown adds N entries; without cleanup the
      // SET grows monotonically).
      void confirmDelivery(jobId).catch(err =>
        logger.warn(
          { err, jobId },
          'stale-discard: confirmDelivery failed — Redis stream entry may not clear'
        )
      );
      void this.coordinator
        .clearStale(jobId)
        .catch(err =>
          logger.warn(
            { err, jobId },
            'stale-discard: clearStale failed — stale entry will expire via TTL'
          )
        );
      return;
    }

    // Single-personality path: JobTracker has the context.
    const jobContext = this.jobTracker.getContext(jobId);
    if (!jobContext) {
      // Before dropping: a multi-tag slot we already synthetic-timed-out may
      // have a recovery marker. If so, deliver the real result as a late
      // follow-up rather than silently dropping it.
      if (await this.tryRecoverLateResult(jobId, result)) {
        return;
      }
      logger.warn({ jobId }, 'Received result for unknown job - ignoring');
      return;
    }

    // Complete the job (clears typing indicator and removes from tracker)
    this.jobTracker.completeJob(jobId);

    if (jobContext.kind === 'slash') {
      await this.handleSlashJobResult(jobId, result, jobContext);
      return;
    }

    await this.handleMessageJobResult(jobId, result, jobContext);
  }

  /**
   * Late-result recovery for multi-tag slots that were synthetic-timed-out.
   * Returns true if this jobId had a recovery marker (i.e. we own the outcome
   * — delivered, or determined unrecoverable), false if it's a genuinely
   * unknown job that should drop as before.
   *
   * On a marker hit we always confirm delivery + clear the marker so the
   * Redis stream entry clears and the marker doesn't linger. A successful
   * result is re-sent as a personality follow-up (prefixed with a "took
   * longer than expected" notice); a failed/empty late result is dropped
   * silently since the user already received the synthetic timeout message.
   *
   * Note: the follow-up is NOT persisted to conversation history — the marker
   * deliberately carries minimal context (no personaId/userMessageTime) and
   * this is a rare >18-min-job edge case. The user sees the reply; it just
   * won't anchor a subsequent turn's memory. Acceptable for the recovery path.
   */
  private async tryRecoverLateResult(jobId: string, result: LLMGenerationResult): Promise<boolean> {
    const ctx = await this.coordinator.getSyntheticTimeout(jobId);
    if (ctx === null) {
      return false; // not a synthetic-timeout job — let the caller drop it
    }

    // From here we own the outcome. Always confirm + clear (best-effort) so
    // the stream entry clears and the marker doesn't outlive its usefulness.
    const finalize = async (): Promise<void> => {
      // confirmDelivery is fire-and-forget: stream-entry cleanup is best-effort,
      // and the gateway entry expires on its own TTL if this call never lands.
      // clearSyntheticTimeout is awaited so the recovery marker doesn't linger
      // if we crash right after the follow-up send but before its TTL elapses.
      void confirmDelivery(jobId).catch(err =>
        logger.warn({ err, jobId }, 'late-recovery: confirmDelivery failed')
      );
      await this.coordinator.clearSyntheticTimeout(jobId);
    };

    // Failed/empty late result: the user already saw the synthetic timeout
    // error — don't send a second (error) message. Just clean up.
    if (
      result.success === false ||
      typeof result.content !== 'string' ||
      result.content.length === 0
    ) {
      logger.info(
        { jobId },
        'Late result for synthetic-timed-out job was unusable — clearing marker, no follow-up'
      );
      await finalize();
      return true;
    }

    const personality = await this.personalityService.loadPersonality(
      ctx.personalitySlug,
      ctx.recipientUserId
    );
    if (personality === null) {
      logger.warn(
        { jobId, slug: ctx.personalitySlug },
        'Late recovery: personality no longer loadable — dropping follow-up'
      );
      await finalize();
      return true;
    }

    const channel = await fetchTypingChannel(this.client, ctx.channelId);
    if (channel === null) {
      logger.warn(
        { jobId, channelId: ctx.channelId },
        'Late recovery: channel missing or not a typing channel — dropping follow-up'
      );
      await finalize();
      return true;
    }

    try {
      await this.responseSender.sendResponse({
        content: LATE_RECOVERY_NOTICE + result.content,
        personality,
        channel,
        guildId: ctx.guildId,
        clientId: ctx.clientId,
        recipientUserId: ctx.recipientUserId,
        isAutoResponse: ctx.isAutoResponse,
        ...buildResultMetadataPassthrough(result),
      });
      logger.info(
        { jobId, personalityId: personality.id },
        'Late result recovered and delivered as a follow-up'
      );
    } catch (err) {
      logger.error({ err, jobId }, 'Late recovery: follow-up send failed');
    }
    // finalize() runs even when the send threw. confirmDelivery is an idempotent
    // job_results status flip (PENDING_DELIVERY → DELIVERED), and nothing sweeps
    // PENDING_DELIVERY rows for retry — so confirming after a failed send is
    // cosmetically imprecise but functionally inert. We still finalize so the
    // recovery marker clears rather than lingering until its TTL.
    await finalize();
    return true;
  }

  /**
   * Result delivery for the @mention/reply/auto-response path. Anchors on
   * the original Discord Message: upgrades attachment placeholders, sends
   * via the message-shaped responseSender path, persists with Message
   * context.
   */
  private async handleMessageJobResult(
    jobId: string,
    result: LLMGenerationResult,
    jobContext: MessageJobContext
  ): Promise<void> {
    const slotContext = messageJobContextToSlotContext(jobContext);

    // Handle explicit failure from ai-worker (success: false)
    if (result.success === false) {
      logger.error(
        { jobId, error: result.error, errorInfo: result.errorInfo },
        'Job failed with error from ai-worker'
      );
      await this.slotDelivery.deliverError(buildErrorContent(result), result, slotContext);
      return;
    }

    // BOUNDARY VALIDATION: validate result has usable content before delivery.
    if (
      result.content === undefined ||
      result.content === null ||
      result.content.length === 0 ||
      typeof result.content !== 'string'
    ) {
      logger.error(
        {
          jobId,
          hasContent: result.content !== undefined && result.content !== null,
          contentType: typeof result.content,
        },
        'Job result missing or invalid content field'
      );
      await this.slotDelivery.deliverError(buildErrorContent(result), result, slotContext);
      return;
    }

    try {
      const { chunkMessageIds } = await this.slotDelivery.deliverSuccess(
        result as LLMGenerationResult & { success: true },
        slotContext
      );
      logger.info(
        { jobId, chunks: chunkMessageIds.length },
        'Async job result delivered successfully'
      );
    } catch (error) {
      logger.error({ err: error, jobId }, 'Error handling job result');
      await this.slotDelivery.deliverError(buildErrorContent(result), result, slotContext);
    }
  }

  /**
   * Slash-command result delivery.
   *
   * Mirrors the @mention path but with two differences:
   *  - No Message to upgrade (slash commands don't accept attachments, so
   *    there are no placeholder descriptions to swap for rich text).
   *  - Persistence uses saveAssistantMessageFromFields (no Message anchor).
   *
   * Slash chat now ALSO surfaces TTS audio, thinking blocks, and focus/
   * incognito footers — feature parity with the @mention path that the
   * old polling sender silently dropped.
   */
  private async handleSlashJobResult(
    jobId: string,
    result: LLMGenerationResult,
    jobContext: SlashJobContext
  ): Promise<void> {
    if (result.success === false) {
      logger.error(
        { jobId, error: result.error, errorInfo: result.errorInfo },
        'Slash job failed; surfacing error to channel'
      );
      await this.sendSlashErrorResponse(jobId, buildErrorContent(result), result, jobContext);
      return;
    }

    // Narrow content via real if-check rather than assertion — both
    // `!` and `as` are forbidden by lint rules in this codebase.
    const content = result.content;
    if (typeof content !== 'string' || content.length === 0) {
      logger.error(
        { jobId, contentType: typeof content },
        'Slash job result missing or invalid content field'
      );
      await this.sendSlashErrorResponse(jobId, buildErrorContent(result), result, jobContext);
      return;
    }

    const {
      channel,
      guildId,
      clientId,
      personality,
      personaId,
      userMessageTime,
      isWeighInMode,
      userId,
    } = jobContext;

    try {
      const { chunkMessageIds } = await this.responseSender.sendResponse({
        content,
        personality,
        channel,
        guildId,
        clientId,
        recipientUserId: userId,
        ...buildResultMetadataPassthrough(result),
      });

      // Persist the assistant response to conversation history — including
      // weigh-in/chime-in responses, so they survive once they age out of the
      // live-fetch window and stay part of cross-turn continuity. This is a
      // history-only write: long-term MEMORY creation is gated separately on
      // isWeighIn in the ai-worker (ConversationalRAGService), so persisting
      // here keeps the incognito "no memories" semantics intact.
      await this.persistence.saveAssistantMessageFromFields({
        channelId: channel.id,
        guildId,
        personality,
        personaId,
        content,
        chunkMessageIds,
        userMessageTime,
      });

      if (chunkMessageIds.length > 0) {
        void updateDiagnosticResponseIds(result.requestId, chunkMessageIds).catch(err => {
          logger.warn({ err }, 'Failed to update diagnostic response IDs (slash)');
        });
      }

      logger.info(
        { jobId, chunks: chunkMessageIds.length, isWeighInMode },
        'Slash job result delivered successfully'
      );
    } catch (error) {
      logger.error({ err: error, jobId }, 'Error handling slash job result');
      await this.sendSlashErrorResponse(jobId, buildErrorContent(result), result, jobContext);
    }
  }

  /**
   * Slash-error response. No Message to reply to — the deferred interaction
   * reply was already finalized when the job was submitted, so the only
   * delivery surface is `channel.send` (or the response sender for
   * webhook/DM-aware delivery with the error embed shape).
   */
  private async sendSlashErrorResponse(
    jobId: string,
    errorContent: string,
    result: LLMGenerationResult,
    jobContext: SlashJobContext
  ): Promise<void> {
    const { channel, guildId, clientId, personality, personaId, userMessageTime, isWeighInMode } =
      jobContext;

    try {
      const { chunkMessageIds } = await this.responseSender.sendResponse({
        content: errorContent,
        personality,
        channel,
        guildId,
        clientId,
        modelUsed: result.metadata?.modelUsed,
        providerUsed: result.metadata?.providerUsed,
        fallbackProviderAttempted: result.metadata?.fallbackProviderAttempted,
        quotaFallback: result.metadata?.quotaFallback,
        isGuestMode: result.metadata?.isGuestMode,
        freshModeEnabled: result.metadata?.freshModeEnabled,
        incognitoModeActive: result.metadata?.incognitoModeActive,
        showModelFooter: result.metadata?.showModelFooter,
      });

      // Persist the (spoiler-stripped) error to conversation history so the
      // slash-error path matches the @mention error path's behavior — see
      // sendErrorResponse above, which has always done this. The trade-off:
      // the error becomes visible to the next turn's LLM context. Acceptable
      // because (a) it mirrors what users see on screen, and (b) divergence
      // between the two paths would be more surprising than the parity cost.
      if (!isWeighInMode) {
        await this.persistence.saveAssistantMessageFromFields({
          channelId: channel.id,
          guildId,
          personality,
          personaId,
          content: stripErrorSpoiler(errorContent),
          chunkMessageIds,
          userMessageTime,
        });
      }

      if (chunkMessageIds.length > 0) {
        void updateDiagnosticResponseIds(result.requestId, chunkMessageIds).catch(err => {
          logger.warn({ err }, 'Failed to update diagnostic response IDs for slash error');
        });
      }
    } catch (sendError) {
      logger.error(
        { err: sendError, jobId },
        'Failed to send slash error via responseSender, falling back to channel.send'
      );
      // No Message anchor; channel.send is the only fallback path.
      // TypingChannel guarantees `.send` exists, so no duck-type guard needed.
      await channel.send(errorContent).catch(() => {
        // Last-resort: silently drop. We've already logged the primary failure.
      });
    }
  }
}

/**
 * Project a `MessageJobContext` (what JobTracker stores) into the slot-shaped
 * context `SlotDeliveryService` expects. Pure projection — no side effects.
 *
 * Used by the @mention/reply/auto-response delivery path. Multi-tag fan-out
 * builds equivalent slot contexts directly in MultiTagCoordinator.
 */
function messageJobContextToSlotContext(jobContext: MessageJobContext): SlotDeliveryContext {
  return {
    message: jobContext.message,
    channel: jobContext.channel,
    guildId: jobContext.guildId,
    clientId: jobContext.clientId,
    personality: jobContext.personality,
    personaId: jobContext.personaId,
    userMessageContent: jobContext.userMessageContent,
    userMessageTime: jobContext.userMessageTime,
    // jobContext.isAutoResponse is optional on the source type but every
    // call site (single-personality, multi-tag) sets it explicitly today.
    // Coerce missing → false; SlotDeliveryContext.isAutoResponse is now
    // non-nullable.
    isAutoResponse: jobContext.isAutoResponse ?? false,
    // discord.js types `author` as non-nullable User on regular Messages,
    // and system messages (which lack author) are filtered upstream by
    // BotMessageFilter. Use optional chaining anyway so tests with minimal
    // Message fixtures don't trip on the access; the empty-string fallback
    // never fires in production (every handled message has an author).
    recipientUserId: jobContext.message.author?.id ?? '',
  };
}
