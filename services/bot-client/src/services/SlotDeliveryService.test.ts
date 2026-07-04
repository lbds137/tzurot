/**
 * Tests for SlotDeliveryService — verifies that the extracted send + persist
 * + diagnostic-update sequence flows through to the injected deps correctly.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Message } from 'discord.js';
import type { TypingChannel } from '@tzurot/common-types/types/discord-types';
import type { LLMGenerationResult } from '@tzurot/common-types/types/schemas/generation';
import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { SlotDeliveryService, type SlotDeliveryContext } from './SlotDeliveryService.js';
import type { DiscordResponseSender } from './DiscordResponseSender.js';
import type { ConversationPersistence } from './ConversationPersistence.js';
import { updateDiagnosticResponseIds } from '../utils/gatewayServiceCalls.js';

vi.mock('../utils/gatewayServiceCalls.js', () => ({
  updateDiagnosticResponseIds: vi.fn(),
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
});
