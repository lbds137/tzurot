/**
 * Slot Delivery Service
 *
 * Shared per-slot delivery logic used by both:
 *   - MessageHandler (single-personality path: @mention / reply / activation)
 *   - MultiTagCoordinator (multi-tag fan-out path)
 *
 * "Slot" naming reflects the multi-tag mental model — a single message can
 * produce up to MULTI_TAG.MAX_TAGS slots, each requiring this same
 * send-and-persist sequence. For single-personality messages, N=1.
 *
 * Responsibilities (per slot):
 *  1. Upgrade user-message row with attachment descriptions from the AI result.
 *  2. Send the AI response to Discord via the webhook/DM sender.
 *  3. Persist the assistant message to conversation history.
 *  4. Update the diagnostic log with response message IDs (fire-and-forget).
 *
 * Error path is parallel: send the error content, persist a stripped version,
 * update diagnostics. On webhook failure, fall back to a direct message.reply.
 */

import type { Message } from 'discord.js';
import { stripErrorSpoiler } from '@tzurot/common-types/constants/error';
import { type TypingChannel } from '@tzurot/common-types/types/discord-types';
import { type LLMGenerationResult } from '@tzurot/common-types/types/schemas/generation';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DiscordResponseSender } from './DiscordResponseSender.js';
import type { ConversationPersistence } from './ConversationPersistence.js';
import { updateDiagnosticResponseIds } from '../utils/gatewayServiceCalls.js';

const logger = createLogger('SlotDeliveryService');

/**
 * Everything `SlotDeliveryService` needs to deliver one slot's response.
 *
 * Tracks the Discord-side anchor (`message`, `channel`, `recipientUserId`)
 * separately from the personality identity (`personality`, `personaId`) so
 * a multi-tag fan-out can reuse the channel-level fields across N slots
 * while swapping the personality per slot.
 */
export interface SlotDeliveryContext {
  /** Original Discord message that triggered this slot. */
  message: Message;
  /** Channel for webhook/DM send. */
  channel: TypingChannel;
  /** Guild ID (null for DM channels) — picks webhook vs DM routing. */
  guildId: string | null;
  /** Bot's Discord application ID (for TTS filename construction). */
  clientId: string | undefined;
  /** Personality whose response is being delivered. */
  personality: LoadedPersonality;
  /** Persona ID of the user (for conversation-history attribution). */
  personaId: string;
  /** Raw user message content (for placeholder-to-rich upgrade). */
  userMessageContent: string;
  /** Timestamp anchoring user-message < assistant-message ordering. */
  userMessageTime: Date;
  /** True for ambient sources (activation, dm-session). Drives footer text. */
  isAutoResponse: boolean;
  /** Discord user ID of the message author — gates bot-owner-only TTS notices. */
  recipientUserId: string;
}

/**
 * The subset of `SlotDeliveryContext` needed to send an in-character error
 * via the webhook + reply-fallback, WITHOUT the fields (`personaId`,
 * `userMessageTime`, etc.) that only the history-persistence step consumes.
 * Used by `deliverErrorNoPersist` for the submit-failure path.
 */
export type EphemeralErrorContext = Pick<
  SlotDeliveryContext,
  'message' | 'channel' | 'guildId' | 'clientId' | 'personality' | 'isAutoResponse'
>;

export interface SlotDeliveryServiceDeps {
  responseSender: DiscordResponseSender;
  persistence: ConversationPersistence;
}

/**
 * Pure delivery service — no internal state. Holds DI deps and routes each
 * call through to the sender/persistence/diagnostic pipelines.
 */
export class SlotDeliveryService {
  private readonly responseSender: DiscordResponseSender;
  private readonly persistence: ConversationPersistence;

  constructor(deps: SlotDeliveryServiceDeps) {
    this.responseSender = deps.responseSender;
    this.persistence = deps.persistence;
  }

  /**
   * Deliver a successful AI result for a single slot.
   * Returns the chunk message IDs (useful for diagnostic tracking by the
   * caller — fire-and-forget update already enqueued internally).
   *
   * **Caller contract**: every caller MUST validate content before invoking
   * this. The runtime guard below exists as a belt-and-suspenders backstop
   * for the type system (which can express `success: true` but not
   * "content is a non-empty string"). Callers must fork to `deliverError`
   * when content is missing/empty. Direct tests exercise the throw (see
   * `SlotDeliveryService.test.ts`).
   *
   * @throws Error if `result.content` is empty, null, undefined, or non-string.
   */
  async deliverSuccess(
    result: LLMGenerationResult & { success: true },
    slot: SlotDeliveryContext
  ): Promise<{ chunkMessageIds: string[] }> {
    if (
      result.content === undefined ||
      result.content === null ||
      result.content.length === 0 ||
      typeof result.content !== 'string'
    ) {
      throw new Error('deliverSuccess called with empty/invalid content');
    }

    const { chunkMessageIds } = await this.responseSender.sendResponse({
      content: result.content,
      personality: slot.personality,
      channel: slot.channel,
      guildId: slot.guildId,
      clientId: slot.clientId,
      modelUsed: result.metadata?.modelUsed,
      providerUsed: result.metadata?.providerUsed,
      fallbackProviderAttempted: result.metadata?.fallbackProviderAttempted,
      quotaFallback: result.metadata?.quotaFallback,
      isGuestMode: result.metadata?.isGuestMode,
      isAutoResponse: slot.isAutoResponse,
      freshModeEnabled: result.metadata?.freshModeEnabled,
      incognitoModeActive: result.metadata?.incognitoModeActive,
      thinkingContent: result.metadata?.thinkingContent,
      showThinking: result.metadata?.showThinking,
      showModelFooter: result.metadata?.showModelFooter,
      ttsAudioKey: result.metadata?.ttsAudioKey,
      ttsAudioContentType: result.metadata?.ttsAudioContentType,
      ttsNotices: result.metadata?.ttsNotices,
      recipientUserId: slot.recipientUserId,
    });

    // Webhook send already succeeded above — the user has received the
    // message. Persistence failures from here MUST NOT propagate, so the
    // caller's per-slot catch doesn't log a misleading "Slot delivery
    // threw" while the user just got their response. Symmetric with the
    // try/catch in deliverError: after a successful webhook send,
    // persist failures are logged but never bubble to the caller.
    try {
      await this.persistence.saveAssistantMessage({
        message: slot.message,
        personality: slot.personality,
        personaId: slot.personaId,
        content: result.content,
        chunkMessageIds,
        userMessageTime: slot.userMessageTime,
      });
    } catch (persistError) {
      logger.error(
        { err: persistError, personalityId: slot.personality.id },
        'Failed to persist assistant message to conversation history (webhook already sent)'
      );
    }

    if (chunkMessageIds.length > 0) {
      void updateDiagnosticResponseIds(result.requestId, chunkMessageIds).catch(err => {
        logger.warn({ err }, 'Failed to update diagnostic response IDs');
      });
    }

    return { chunkMessageIds };
  }

  /**
   * Deliver an error response for a single slot.
   * Falls back to `message.reply` if the webhook path fails.
   *
   * Two phases with distinct error handling — the user must not see the
   * error message twice if the webhook succeeded and only persistence
   * failed:
   *
   *   1. Webhook send (try/catch → reply fallback). Only this phase
   *      triggers `message.reply` on failure.
   *   2. Persistence + diagnostic (failures logged; do NOT trigger reply).
   *
   * Unlike `deliverSuccess`, this path does **not** pass
   * `recipientUserId` to `sendResponse`. That field gates bot-owner-only
   * TTS notices — but error responses don't trigger TTS (there's no
   * successful content to render as audio), so the gate is moot here. The
   * omission is intentional and preserves pre-PR behavior from
   * `sendErrorResponse`.
   */
  async deliverError(
    errorContent: string,
    result: LLMGenerationResult,
    slot: SlotDeliveryContext
  ): Promise<void> {
    const chunkMessageIds = await this.sendErrorViaWebhook(errorContent, result, slot);
    if (chunkMessageIds === null) {
      // Webhook failed and the reply-fallback already ran (or also failed).
      return;
    }

    // Webhook succeeded — persistence/diagnostic failures from here are
    // logged but MUST NOT trigger the reply fallback (would double-send).
    try {
      await this.persistence.saveAssistantMessage({
        message: slot.message,
        personality: slot.personality,
        personaId: slot.personaId,
        content: stripErrorSpoiler(errorContent),
        chunkMessageIds,
        userMessageTime: slot.userMessageTime,
      });
    } catch (persistError) {
      logger.error(
        { err: persistError, personalityId: slot.personality.id },
        'Failed to persist error message to conversation history (webhook already sent)'
      );
    }

    this.updateErrorDiagnostics(result, chunkMessageIds);
  }

  /**
   * Deliver an in-character error line WITHOUT persisting a conversation turn.
   *
   * Used by the multi-tag submit-failure path (`MultiTagCoordinator`'s
   * all-errored branch): the character's `submitChatJob` threw before any
   * user/assistant turn was created, so there is no conversation turn to
   * attribute — fabricating a `saveAssistantMessage` entry (which needs a
   * `personaId` this path never resolved) would record a turn that never
   * happened. The error line still goes out the webhook as the character.
   */
  async deliverErrorNoPersist(
    errorContent: string,
    result: LLMGenerationResult,
    slot: EphemeralErrorContext
  ): Promise<void> {
    // No diagnostic-ID update here: a submit-failure never created an AI
    // response row (its `requestId` is the Discord message ID, not a job ID),
    // so `updateDiagnosticResponseIds` would be a guaranteed server-side miss +
    // a warn on every in-character error delivery. The webhook send is the
    // whole job on this path.
    await this.sendErrorViaWebhook(errorContent, result, slot);
  }

  /**
   * Shared webhook send + reply-fallback for both error-delivery paths.
   * Returns the sent chunk IDs on webhook success, or `null` if the webhook
   * threw (in which case the plain-reply fallback has already been attempted).
   */
  private async sendErrorViaWebhook(
    errorContent: string,
    result: LLMGenerationResult,
    slot: EphemeralErrorContext
  ): Promise<string[] | null> {
    try {
      const sendResult = await this.responseSender.sendResponse({
        content: errorContent,
        personality: slot.personality,
        channel: slot.channel,
        guildId: slot.guildId,
        clientId: slot.clientId,
        modelUsed: result.metadata?.modelUsed,
        providerUsed: result.metadata?.providerUsed,
        fallbackProviderAttempted: result.metadata?.fallbackProviderAttempted,
        quotaFallback: result.metadata?.quotaFallback,
        isGuestMode: result.metadata?.isGuestMode,
        isAutoResponse: slot.isAutoResponse,
        freshModeEnabled: result.metadata?.freshModeEnabled,
        incognitoModeActive: result.metadata?.incognitoModeActive,
        showModelFooter: result.metadata?.showModelFooter,
      });
      return sendResult.chunkMessageIds;
    } catch (sendError) {
      logger.error(
        { err: sendError, personalityId: slot.personality.id },
        'Failed to send error via webhook, falling back to reply'
      );
      await slot.message.reply(errorContent).catch(() => {
        // Already logged the webhook error; ignore reply failure to avoid noise.
      });
      return null;
    }
  }

  private updateErrorDiagnostics(result: LLMGenerationResult, chunkMessageIds: string[]): void {
    if (chunkMessageIds.length > 0) {
      void updateDiagnosticResponseIds(result.requestId, chunkMessageIds).catch(err => {
        logger.warn({ err }, 'Failed to update diagnostic response IDs for error');
      });
    }
  }
}
