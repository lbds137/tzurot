/**
 * PersonalityMessageHandler Unit Tests
 *
 * Adapter-level tests only — domain pipeline behavior is covered by
 * PersonalityChatManager.test.ts. These verify the handler correctly
 * routes the manager's result into JobTracker (or skips, on denial)
 * and replies on exception.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PersonalityMessageHandler } from './PersonalityMessageHandler.js';
import type { Message } from 'discord.js';
import { ChannelType } from 'discord.js';
import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';

describe('PersonalityMessageHandler', () => {
  let handler: PersonalityMessageHandler;
  let mockManager: { submitChatJob: ReturnType<typeof vi.fn> };
  let mockJobTracker: { trackJob: ReturnType<typeof vi.fn> };
  let mockSlotDelivery: { deliverErrorNoPersist: ReturnType<typeof vi.fn> };

  const mockChannel = { id: 'channel-123', type: ChannelType.GuildText } as any;
  const baseTrackingContext = {
    kind: 'message' as const,
    channel: mockChannel,
    guildId: 'guild-123',
    clientId: 'bot-123',
    userMessageTime: new Date(),
    personality: { id: 'pers-1' } as LoadedPersonality,
    personaId: 'persona-1',
    userMessageContent: 'Hi',
    message: { id: 'msg-1' } as Message,
    isAutoResponse: undefined,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockManager = { submitChatJob: vi.fn() };
    mockJobTracker = { trackJob: vi.fn() };
    mockSlotDelivery = { deliverErrorNoPersist: vi.fn().mockResolvedValue(undefined) };

    handler = new PersonalityMessageHandler({
      manager: mockManager as any,
      jobTracker: mockJobTracker as any,
      slotDelivery: mockSlotDelivery as any,
    });
  });

  describe('handleMessage', () => {
    it('routes a submitted job to JobTracker', async () => {
      mockManager.submitChatJob.mockResolvedValueOnce({
        kind: 'submitted',
        jobId: 'job-1',
        trackingContext: baseTrackingContext,
      });

      await handler.handleMessage(createMockMessage(), createMockPersonality(), 'Hi');

      expect(mockManager.submitChatJob).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'Hi', isAutoResponse: undefined })
      );
      expect(mockJobTracker.trackJob).toHaveBeenCalledWith('job-1', baseTrackingContext);
    });

    it('passes isAutoResponse through to the manager', async () => {
      mockManager.submitChatJob.mockResolvedValueOnce({
        kind: 'submitted',
        jobId: 'job-2',
        trackingContext: { ...baseTrackingContext, isAutoResponse: true },
      });

      await handler.handleMessage(createMockMessage(), createMockPersonality(), 'Hi', {
        isAutoResponse: true,
      });

      expect(mockManager.submitChatJob).toHaveBeenCalledWith(
        expect.objectContaining({ isAutoResponse: true })
      );
    });

    it('does not track a job when the manager denies the request', async () => {
      mockManager.submitChatJob.mockResolvedValueOnce({
        kind: 'denied',
        reason: 'denylisted',
      });

      await handler.handleMessage(createMockMessage(), createMockPersonality(), 'Hi');

      expect(mockJobTracker.trackJob).not.toHaveBeenCalled();
    });

    it('delivers the error IN CHARACTER via the webhook (not a plain reply) when the manager throws', async () => {
      const message = createMockMessage();
      mockManager.submitChatJob.mockRejectedValueOnce(new Error('boom'));

      await handler.handleMessage(message, createMockPersonality(), 'Hi', { isAutoResponse: true });

      // Delivered through the webhook path with the failed personality — NOT a
      // plain bot-voice message.reply, and never the raw error.message.
      expect(mockSlotDelivery.deliverErrorNoPersist).toHaveBeenCalledTimes(1);
      const [content, spec, context] = mockSlotDelivery.deliverErrorNoPersist.mock.calls[0];
      expect(content).not.toContain('boom');
      expect(spec.success).toBe(false);
      expect(context).toMatchObject({
        personality: expect.objectContaining({ id: 'personality-123' }),
        channel: message.channel,
        guildId: message.guildId,
        clientId: 'bot-123',
        isAutoResponse: true,
      });
      expect(message.reply).not.toHaveBeenCalled();
      expect(mockJobTracker.trackJob).not.toHaveBeenCalled();
    });

    it('delivers in-character for non-Error throws too (no raw leak)', async () => {
      const message = createMockMessage();
      mockManager.submitChatJob.mockRejectedValueOnce('string-failure');

      await handler.handleMessage(message, createMockPersonality(), 'Hi');

      expect(mockSlotDelivery.deliverErrorNoPersist).toHaveBeenCalledTimes(1);
      const [content] = mockSlotDelivery.deliverErrorNoPersist.mock.calls[0];
      expect(content).not.toContain('string-failure');
    });

    it('does not throw if the in-character delivery itself fails', async () => {
      const message = createMockMessage();
      mockManager.submitChatJob.mockRejectedValueOnce(new Error('boom'));
      mockSlotDelivery.deliverErrorNoPersist.mockRejectedValueOnce(new Error('webhook gone'));

      await expect(
        handler.handleMessage(message, createMockPersonality(), 'Hi')
      ).resolves.toBeUndefined();
    });
  });
});

function createMockMessage(): Message {
  return {
    id: 'message-123',
    guildId: 'test-guild',
    author: { id: 'user-123', username: 'testuser', bot: false },
    channel: { id: 'channel-123', type: ChannelType.GuildText },
    client: { user: { id: 'bot-123' } },
    reply: vi.fn().mockResolvedValue({ id: 'reply-123' }),
  } as unknown as Message;
}

function createMockPersonality(): LoadedPersonality {
  return {
    id: 'personality-123',
    name: 'test-bot',
    displayName: 'Test Bot',
    slug: 'test-bot',
  } as unknown as LoadedPersonality;
}
