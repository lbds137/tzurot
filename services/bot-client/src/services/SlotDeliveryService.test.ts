/**
 * Tests for SlotDeliveryService — verifies that the extracted send + persist
 * + diagnostic-update sequence flows through to the injected deps correctly.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Message } from 'discord.js';
import type { LLMGenerationResult, LoadedPersonality, TypingChannel } from '@tzurot/common-types';
import { SlotDeliveryService, type SlotDeliveryContext } from './SlotDeliveryService.js';
import type { DiscordResponseSender } from './DiscordResponseSender.js';
import type { ConversationPersistence } from './ConversationPersistence.js';
import type { GatewayClient } from '../utils/GatewayClient.js';

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
  let gatewayClient: { updateDiagnosticResponseIds: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    responseSender = {
      sendResponse: vi.fn().mockResolvedValue({ chunkMessageIds: ['chunk-1'] }),
    };
    persistence = {
      updateUserMessage: vi.fn().mockResolvedValue(undefined),
      saveAssistantMessage: vi.fn().mockResolvedValue(undefined),
    };
    gatewayClient = {
      updateDiagnosticResponseIds: vi.fn().mockResolvedValue(undefined),
    };
    service = new SlotDeliveryService({
      responseSender: responseSender as unknown as DiscordResponseSender,
      persistence: persistence as unknown as ConversationPersistence,
      gatewayClient: gatewayClient as unknown as GatewayClient,
    });
  });

  describe('deliverSuccess', () => {
    it('updates user message, sends response, persists assistant message, updates diagnostic', async () => {
      const result = buildSuccessResult();
      const slot = buildSlotContext();

      const out = await service.deliverSuccess(result, slot);

      expect(out.chunkMessageIds).toEqual(['chunk-1']);
      expect(persistence.updateUserMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: slot.message,
          personality,
          personaId: 'persona-1',
          messageContent: 'hello',
        })
      );
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
      expect(gatewayClient.updateDiagnosticResponseIds).toHaveBeenCalledWith('req-1', ['chunk-1']);
    });

    it('skips diagnostic update when no chunks were sent', async () => {
      responseSender.sendResponse.mockResolvedValue({ chunkMessageIds: [] });
      const result = buildSuccessResult();
      const slot = buildSlotContext();

      await service.deliverSuccess(result, slot);

      expect(gatewayClient.updateDiagnosticResponseIds).not.toHaveBeenCalled();
    });

    it('throws on empty content (caller is expected to route through deliverError instead)', async () => {
      const result = { ...buildSuccessResult(), content: '' };
      const slot = buildSlotContext();

      await expect(
        service.deliverSuccess(result as LLMGenerationResult & { success: true }, slot)
      ).rejects.toThrow();
    });

    it('forwards isAutoResponse to the response sender', async () => {
      const result = buildSuccessResult();
      const slot = buildSlotContext({ isAutoResponse: true });

      await service.deliverSuccess(result, slot);

      expect(responseSender.sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ isAutoResponse: true })
      );
    });
  });

  describe('deliverError', () => {
    it('sends error content via webhook and persists stripped version', async () => {
      const failResult = {
        requestId: 'req-1',
        success: false,
        error: 'thing broke',
      } as LLMGenerationResult;
      const slot = buildSlotContext();

      await service.deliverError('Error occurred', failResult, slot);

      expect(responseSender.sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'Error occurred' })
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
  });
});
