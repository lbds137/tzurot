/**
 * Tests for SlotDeliveryService — verifies that the extracted send + persist
 * + diagnostic-update sequence flows through to the injected deps correctly.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Message } from 'discord.js';
import { TextChannel } from 'discord.js';
import type { TypingChannel } from '@tzurot/common-types/types/discord-types';
import type { LLMGenerationResult } from '@tzurot/common-types/types/schemas/generation';
import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { SlotDeliveryService, type SlotDeliveryContext } from './SlotDeliveryService.js';
// Value import (not type-only): the wiring test below constructs a REAL
// DiscordResponseSender instance; every other usage in this file still only
// needs the type, which a value import also satisfies.
import { DiscordResponseSender } from './DiscordResponseSender.js';
import type { ConversationPersistence } from './ConversationPersistence.js';
import { updateDiagnosticResponseIds } from '../utils/gatewayServiceCalls.js';
import { PartialDeliveryError } from './partialDelivery.js';
import { stripErrorSpoiler } from '@tzurot/common-types/constants/error';
import type { WebhookManager } from '../utils/WebhookManager.js';

vi.mock('../utils/gatewayServiceCalls.js', () => ({
  updateDiagnosticResponseIds: vi.fn(),
}));

// Only needed for the wiring test's REAL DiscordResponseSender — every other
// test in this file mocks `responseSender` directly and never imports the
// module that pulls these in.
vi.mock('../redis.js', () => ({
  redisService: {
    storeWebhookMessage: vi.fn().mockResolvedValue(undefined),
    getWebhookPersonality: vi.fn(),
    getTTSAudio: vi.fn().mockResolvedValue(null),
    checkHealth: vi.fn(),
    close: vi.fn(),
  },
}));

vi.mock('../utils/retentionGatewayCalls.js', () => ({
  reportPersonaDmUndeliverable: vi.fn(),
}));

const personality = {
  id: 'pid-1',
  name: 'Alice',
  displayName: 'Alice',
  slug: 'alice',
} as unknown as LoadedPersonality;

function buildSlotContext(overrides: Partial<SlotDeliveryContext> = {}): SlotDeliveryContext {
  return {
    message: {
      id: 'msg-1',
      author: { id: 'user-1' },
      reply: vi.fn().mockResolvedValue(undefined),
    } as unknown as Message,
    channel: { id: 'channel-1' } as unknown as TypingChannel,
    guildId: 'guild-1',
    clientId: 'client-1',
    personality,
    personaId: 'persona-1',
    userMessageContent: 'hello',
    userMessageTime: new Date('2026-05-15T10:00:00Z'),
    isAutoResponse: false,
    recipientUserId: 'user-1',
    ...overrides,
  };
}

function buildSuccessResult(
  overrides: Partial<LLMGenerationResult> = {}
): LLMGenerationResult & { success: true } {
  return {
    requestId: 'req-1',
    success: true,
    content: 'response content',
    metadata: { modelUsed: 'test-model' },
    ...overrides,
  } as LLMGenerationResult & { success: true };
}

describe('SlotDeliveryService', () => {
  let service: SlotDeliveryService;
  let responseSender: { sendResponse: ReturnType<typeof vi.fn> };
  let persistence: {
    updateUserMessage: ReturnType<typeof vi.fn>;
    saveAssistantMessage: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(updateDiagnosticResponseIds).mockResolvedValue(undefined);
    responseSender = {
      sendResponse: vi.fn().mockResolvedValue({ chunkMessageIds: ['chunk-1'] }),
    };
    persistence = {
      updateUserMessage: vi.fn().mockResolvedValue(undefined),
      saveAssistantMessage: vi.fn().mockResolvedValue(undefined),
    };
    service = new SlotDeliveryService({
      responseSender: responseSender as unknown as DiscordResponseSender,
      persistence: persistence as unknown as ConversationPersistence,
    });
  });

  describe('deliverSuccess', () => {
    it('sends response, persists assistant message, updates diagnostic', async () => {
      const result = buildSuccessResult();
      const slot = buildSlotContext();

      const out = await service.deliverSuccess(result, slot);

      expect(out.chunkMessageIds).toEqual(['chunk-1']);
      expect(responseSender.sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'response content',
          personality,
          channel: slot.channel,
          guildId: 'guild-1',
          recipientUserId: 'user-1',
        })
      );
      expect(persistence.saveAssistantMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'response content',
          chunkMessageIds: ['chunk-1'],
          userMessageTime: slot.userMessageTime,
        })
      );
      // Diagnostic update is fire-and-forget — let microtasks settle.
      await Promise.resolve();
      expect(vi.mocked(updateDiagnosticResponseIds)).toHaveBeenCalledWith('req-1', ['chunk-1']);
    });

    it('forwards routedModel from result metadata to the response sender', async () => {
      const result = buildSuccessResult({
        metadata: { modelUsed: 'test-model', routedModel: 'ROUTED_MODEL_SENTINEL' },
      } as Partial<LLMGenerationResult>);
      const slot = buildSlotContext();

      await service.deliverSuccess(result, slot);

      expect(responseSender.sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ routedModel: 'ROUTED_MODEL_SENTINEL' })
      );
    });

    it('forwards the reasoning trace from result metadata into the persisted row', async () => {
      const result = buildSuccessResult({
        metadata: { modelUsed: 'test-model', thinkingContent: 'SLOT_TRACE_SENTINEL' },
      } as Partial<LLMGenerationResult>);
      const slot = buildSlotContext();

      await service.deliverSuccess(result, slot);

      // The reasoning trace must reach persistence — otherwise it dies with
      // the 7d diagnostic log.
      expect(persistence.saveAssistantMessage).toHaveBeenCalledWith(
        expect.objectContaining({ thinkingContent: 'SLOT_TRACE_SENTINEL' })
      );
    });

    it('skips diagnostic update when no chunks were sent', async () => {
      responseSender.sendResponse.mockResolvedValue({ chunkMessageIds: [] });
      const result = buildSuccessResult();
      const slot = buildSlotContext();

      await service.deliverSuccess(result, slot);

      expect(vi.mocked(updateDiagnosticResponseIds)).not.toHaveBeenCalled();
    });

    it('throws on empty content (caller is expected to route through deliverError instead)', async () => {
      const result = { ...buildSuccessResult(), content: '' };
      const slot = buildSlotContext();

      await expect(
        service.deliverSuccess(result as LLMGenerationResult & { success: true }, slot)
      ).rejects.toThrow();
    });

    // The runtime guard exists as a backstop for the type system. Today's
    // callers all validate first, so the throw is unreachable from happy-path
    // flow — but it MUST exist because TypeScript can express `success: true`
    // and not "non-empty string content." These cases lock the guard so a
    // future caller skip can't introduce silent slot drops.
    it.each([
      { label: 'null content', content: null },
      { label: 'undefined content', content: undefined },
      { label: 'non-string content', content: 42 as unknown as string },
    ])('throws on $label', async ({ content }) => {
      const result = { ...buildSuccessResult(), content } as LLMGenerationResult & {
        success: true;
      };
      const slot = buildSlotContext();

      await expect(service.deliverSuccess(result, slot)).rejects.toThrow();
    });

    it('forwards isAutoResponse to the response sender', async () => {
      const result = buildSuccessResult();
      const slot = buildSlotContext({ isAutoResponse: true });

      await service.deliverSuccess(result, slot);

      expect(responseSender.sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ isAutoResponse: true })
      );
    });

    it('does NOT propagate when webhook succeeded but persistence threw', async () => {
      // Mirrors the deliverError try/catch around saveAssistantMessage:
      // once the webhook delivers, the user has the message and a
      // persistence failure must not surface as an exception to the
      // caller (the per-slot catch in multiTagDeliveryFlow would log
      // "Slot delivery threw" even though delivery succeeded). The
      // guard logs the persist failure and returns normally.
      responseSender.sendResponse.mockResolvedValue({ chunkMessageIds: ['chunk-ok-1'] });
      persistence.saveAssistantMessage.mockRejectedValue(new Error('FK constraint violation'));
      const result = buildSuccessResult();
      const slot = buildSlotContext();

      // Should NOT throw — the user got the message; conversation history
      // just isn't recorded.
      const out = await service.deliverSuccess(result, slot);

      expect(responseSender.sendResponse).toHaveBeenCalledTimes(1);
      expect(persistence.saveAssistantMessage).toHaveBeenCalledTimes(1);
      expect(out.chunkMessageIds).toEqual(['chunk-ok-1']);
    });
  });

  describe('deliverError', () => {
    it('sends error content via webhook and persists stripped version', async () => {
      const failResult = {
        requestId: 'req-1',
        success: false,
        error: 'thing broke',
        metadata: {
          modelUsed: 'glm-4.7',
          providerUsed: 'zai-coding',
          // Both-routes-failed error: the attempted fallback must reach the
          // sender so the footer renders the route chain, not just the primary.
          fallbackProviderAttempted: 'openrouter',
        },
      } as LLMGenerationResult;
      const slot = buildSlotContext();

      await service.deliverError('Error occurred', failResult, slot);

      expect(responseSender.sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Error occurred',
          providerUsed: 'zai-coding',
          fallbackProviderAttempted: 'openrouter',
        })
      );
      expect(persistence.saveAssistantMessage).toHaveBeenCalled();
    });

    it('forwards a served provider swap on the error path so the footer renders the route chain', async () => {
      const failResult = {
        requestId: 'req-1',
        success: false,
        error: 'thing broke',
        metadata: {
          modelUsed: 'glm-4.7',
          providerUsed: 'openrouter',
          fallbackFromProvider: 'zai-coding',
        },
      } as LLMGenerationResult;
      const slot = buildSlotContext();

      await service.deliverError('Error occurred', failResult, slot);

      expect(responseSender.sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ fallbackFromProvider: 'zai-coding' })
      );
    });

    it('falls back to message.reply when webhook send fails', async () => {
      responseSender.sendResponse.mockRejectedValue(new Error('webhook 500'));
      const slot = buildSlotContext();
      const failResult = {
        requestId: 'req-1',
        success: false,
        error: 'thing broke',
      } as LLMGenerationResult;

      await service.deliverError('Error occurred', failResult, slot);

      expect(slot.message.reply).toHaveBeenCalledWith('Error occurred');
      // Assistant message is NOT persisted when webhook fails (we never got chunk IDs).
      expect(persistence.saveAssistantMessage).not.toHaveBeenCalled();
    });

    it('does NOT double-deliver when webhook succeeded but persistence threw', async () => {
      // Webhook send succeeds, returns chunk IDs.
      responseSender.sendResponse.mockResolvedValue({ chunkMessageIds: ['chunk-err-1'] });
      // Persistence layer throws (e.g., DB hiccup).
      persistence.saveAssistantMessage.mockRejectedValue(new Error('db unavailable'));
      const slot = buildSlotContext();
      const failResult = {
        requestId: 'req-1',
        success: false,
        error: 'thing broke',
      } as LLMGenerationResult;

      await service.deliverError('Error occurred', failResult, slot);

      // Webhook sent the error once...
      expect(responseSender.sendResponse).toHaveBeenCalledTimes(1);
      // ...and the reply fallback MUST NOT fire, since the user already saw it.
      expect(slot.message.reply).not.toHaveBeenCalled();
    });
  });

  describe('deliverErrorNoPersist', () => {
    const failResult = {
      requestId: 'req-1',
      success: false,
      error: 'thing broke',
    } as LLMGenerationResult;

    it('sends the error via webhook in-character but does NOT persist a conversation turn', async () => {
      // The submit-failure path (multi-tag all-errored) never created a turn,
      // so persisting an assistant message would fabricate history.
      const slot = buildSlotContext();

      await service.deliverErrorNoPersist('In-character error', failResult, slot);

      expect(responseSender.sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'In-character error',
          personality: slot.personality,
          isAutoResponse: slot.isAutoResponse,
        })
      );
      // The distinguishing behavior: NO history persistence.
      expect(persistence.saveAssistantMessage).not.toHaveBeenCalled();
    });

    it('falls back to message.reply when the webhook send fails', async () => {
      responseSender.sendResponse.mockRejectedValue(new Error('webhook 500'));
      const slot = buildSlotContext();

      await service.deliverErrorNoPersist('In-character error', failResult, slot);

      expect(slot.message.reply).toHaveBeenCalledWith('In-character error');
      expect(persistence.saveAssistantMessage).not.toHaveBeenCalled();
    });
  });

  describe('deliverErrorAfterPartial', () => {
    const failResult = {
      requestId: 'req-partial',
      success: false,
      error: 'thing broke mid-stream',
    } as LLMGenerationResult;

    it('composes delivered text + stripped error text into one persisted row when the error send succeeds', async () => {
      responseSender.sendResponse.mockResolvedValue({ chunkMessageIds: ['err-1'] });
      const partial = new PartialDeliveryError({
        chunkMessageIds: ['id-1'],
        deliveredContent: 'delivered text',
        totalChunks: 2,
        cause: new Error('boom'),
      });
      const errorContentWithSpoiler = 'Oops! ||*(error: boom; reference: ref-1)*||';
      const slot = buildSlotContext();

      await service.deliverErrorAfterPartial(partial, errorContentWithSpoiler, failResult, slot);

      const strippedError = stripErrorSpoiler(errorContentWithSpoiler);
      expect(persistence.saveAssistantMessage).toHaveBeenCalledTimes(1);
      expect(persistence.saveAssistantMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'delivered text\n' + strippedError,
          chunkMessageIds: ['id-1', 'err-1'],
        })
      );
      await Promise.resolve();
      expect(vi.mocked(updateDiagnosticResponseIds)).toHaveBeenCalledWith('req-partial', [
        'id-1',
        'err-1',
      ]);
    });

    it('persists only the delivered text when the error notice send also fails', async () => {
      responseSender.sendResponse.mockRejectedValue(new Error('webhook 500 again'));
      const partial = new PartialDeliveryError({
        chunkMessageIds: ['id-1'],
        deliveredContent: 'delivered text',
        totalChunks: 2,
        cause: new Error('boom'),
      });
      const slot = buildSlotContext();

      await service.deliverErrorAfterPartial(partial, 'Error occurred', failResult, slot);

      expect(slot.message.reply).toHaveBeenCalledTimes(1);
      expect(slot.message.reply).toHaveBeenCalledWith('Error occurred');
      expect(persistence.saveAssistantMessage).toHaveBeenCalledTimes(1);
      expect(persistence.saveAssistantMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'delivered text',
          chunkMessageIds: ['id-1'],
        })
      );
    });
  });

  describe('deliverSuccess → deliverErrorAfterPartial sequencing (one persisted row per turn)', () => {
    it('persists nothing on the failed deliverSuccess call, exactly once after the error-path call', async () => {
      const partial = new PartialDeliveryError({
        chunkMessageIds: ['id-1'],
        deliveredContent: 'delivered text',
        totalChunks: 2,
        cause: new Error('boom'),
      });
      responseSender.sendResponse
        .mockRejectedValueOnce(partial)
        .mockResolvedValueOnce({ chunkMessageIds: ['err-1'] });
      const result = buildSuccessResult();
      const slot = buildSlotContext();

      const caught = await service.deliverSuccess(result, slot).catch((e: unknown) => e);

      expect(caught).toBeInstanceOf(PartialDeliveryError);
      expect(persistence.saveAssistantMessage).not.toHaveBeenCalled();

      await service.deliverErrorAfterPartial(
        caught as PartialDeliveryError,
        'Error occurred',
        result,
        slot
      );

      expect(persistence.saveAssistantMessage).toHaveBeenCalledTimes(1);
      expect(persistence.saveAssistantMessage).toHaveBeenCalledWith(
        expect.objectContaining({ chunkMessageIds: ['id-1', 'err-1'] })
      );
    });
  });

  describe('persistPartialDelivery', () => {
    it('persists the delivered chunks alone, once', async () => {
      const partial = new PartialDeliveryError({
        chunkMessageIds: ['id-1'],
        deliveredContent: 'delivered text',
        totalChunks: 2,
        cause: new Error('boom'),
      });
      const result = buildSuccessResult();
      const slot = buildSlotContext();

      await service.persistPartialDelivery(partial, result, slot);

      expect(persistence.saveAssistantMessage).toHaveBeenCalledTimes(1);
      expect(persistence.saveAssistantMessage).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'delivered text', chunkMessageIds: ['id-1'] })
      );
    });

    it('resolves (never throws) when the persist itself rejects', async () => {
      persistence.saveAssistantMessage.mockRejectedValue(new Error('db down'));
      const partial = new PartialDeliveryError({
        chunkMessageIds: ['id-1'],
        deliveredContent: 'delivered text',
        totalChunks: 2,
        cause: new Error('boom'),
      });
      const result = buildSuccessResult();
      const slot = buildSlotContext();

      await expect(service.persistPartialDelivery(partial, result, slot)).resolves.toBeUndefined();
    });
  });

  describe('wiring: real DiscordResponseSender crosses the PartialDeliveryError seam', () => {
    it('wiring: deliverSuccess + deliverErrorAfterPartial persist one row through a REAL sender', async () => {
      const mockWebhookManager = {
        sendAsPersonality: vi
          .fn()
          .mockResolvedValueOnce({ id: 'id-1' })
          .mockRejectedValueOnce(new Error('webhook 500'))
          .mockResolvedValueOnce({ id: 'err-1' }),
      };
      const realSender = new DiscordResponseSender(mockWebhookManager as unknown as WebhookManager);
      const realPersistence = { saveAssistantMessage: vi.fn().mockResolvedValue(undefined) };
      const wiringService = new SlotDeliveryService({
        responseSender: realSender,
        persistence: realPersistence as unknown as ConversationPersistence,
      });

      const channel = Object.create(TextChannel.prototype);
      channel.id = 'channel-wire-1';
      const slot = buildSlotContext({
        channel: channel as unknown as TypingChannel,
        guildId: 'guild-wire-1',
      });
      // Word-based, no punctuation: the REAL splitMessage word-wraps this into
      // exactly 2 chunks under the 2000-char cap (400 words ≈ 1999 chars, then
      // the remaining 50 words).
      const content = 'word '.repeat(450).trim();
      const result = buildSuccessResult({ content });

      const caught = (await wiringService
        .deliverSuccess(result, slot)
        .catch((e: unknown) => e)) as PartialDeliveryError;

      expect(mockWebhookManager.sendAsPersonality).toHaveBeenCalledTimes(2);
      expect(caught).toBeInstanceOf(PartialDeliveryError);

      await wiringService.deliverErrorAfterPartial(caught, 'Error occurred', result, slot);

      expect(mockWebhookManager.sendAsPersonality).toHaveBeenCalledTimes(3);
      expect(realPersistence.saveAssistantMessage).toHaveBeenCalledTimes(1);
      const persistedTurn = realPersistence.saveAssistantMessage.mock.calls[0][0] as {
        content: string;
        chunkMessageIds: string[];
      };
      expect(persistedTurn.chunkMessageIds).toEqual(['id-1', 'err-1']);
      const sentChunk1 = mockWebhookManager.sendAsPersonality.mock.calls[0][2] as string;
      expect(persistedTurn.content.startsWith(sentChunk1)).toBe(true);
    });
  });
});
