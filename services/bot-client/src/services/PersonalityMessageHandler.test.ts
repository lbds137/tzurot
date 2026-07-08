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

    handler = new PersonalityMessageHandler({
      manager: mockManager as any,
      jobTracker: mockJobTracker as any,
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

    it('replies a classified catalog line (not the raw error) and does not track when the manager throws', async () => {
      const message = createMockMessage();
      mockManager.submitChatJob.mockRejectedValueOnce(new Error('boom'));

      await handler.handleMessage(message, createMockPersonality(), 'Hi');

      // The classified catalog line — never the raw error.message (the old
      // `Error: ${message}` shape leaked internals to users).
      expect(message.reply).toHaveBeenCalledWith(
        '❌ Failed to process your message. Please try again.'
      );
      expect(message.reply).not.toHaveBeenCalledWith(expect.stringContaining('boom'));
      expect(mockJobTracker.trackJob).not.toHaveBeenCalled();
    });

    it('replies the generic catalog line for non-Error throws too (no raw leak)', async () => {
      const message = createMockMessage();
      mockManager.submitChatJob.mockRejectedValueOnce('string-failure');

      await handler.handleMessage(message, createMockPersonality(), 'Hi');

      expect(message.reply).toHaveBeenCalledWith(
        '❌ Failed to process your message. Please try again.'
      );
      expect(message.reply).not.toHaveBeenCalledWith(expect.stringContaining('string-failure'));
    });

    it('does not throw if the error reply itself fails', async () => {
      const message = createMockMessage();
      mockManager.submitChatJob.mockRejectedValueOnce(new Error('boom'));
      (message.reply as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('channel gone'));

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
