/**
 * DiscordResponseSender Unit Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DiscordResponseSender } from './DiscordResponseSender.js';
import type { LoadedPersonality } from '@tzurot/common-types';
import { TextChannel, ThreadChannel } from 'discord.js';

// Mock dependencies
vi.mock('../redis.js', () => ({
  storeWebhookMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    preserveCodeBlocks: vi.fn((content: string) => {
      // Simple mock: split on 2000 char boundaries
      const chunks: string[] = [];
      for (let i = 0; i < content.length; i += 2000) {
        chunks.push(content.slice(i, i + 2000));
      }
      return chunks.length > 0 ? chunks : [content];
    }),
  };
});

describe('DiscordResponseSender', () => {
  let sender: DiscordResponseSender;
  let mockWebhookManager: {
    sendAsPersonality: ReturnType<typeof vi.fn>;
  };
  let mockPersonality: LoadedPersonality;

  beforeEach(() => {
    mockWebhookManager = {
      sendAsPersonality: vi.fn().mockResolvedValue({ id: 'msg-123' }),
    };

    mockPersonality = {
      id: 'personality-123',
      name: 'TestBot',
      displayName: 'Test Bot',
      systemPrompt: 'You are a test bot',
      llmConfig: {
        model: 'test-model',
        temperature: 0.7,
        maxTokens: 1000,
      },
    } as LoadedPersonality;

    sender = new DiscordResponseSender(mockWebhookManager);
  });

  describe('sendResponse - Webhook Channel', () => {
    it('should send response via webhook in guild channel', async () => {
      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      const result = await sender.sendResponse({
        content: 'Hello from bot!',
        personality: mockPersonality,
        message: mockMessage,
      });

      expect(mockWebhookManager.sendAsPersonality).toHaveBeenCalledWith(
        mockChannel,
        mockPersonality,
        'Hello from bot!'
      );
      expect(result.chunkMessageIds).toEqual(['msg-123']);
      expect(result.chunkCount).toBe(1);
    });

    it('should add model indicator when modelUsed is provided', async () => {
      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      await sender.sendResponse({
        content: 'Response content',
        personality: mockPersonality,
        message: mockMessage,
        modelUsed: 'anthropic/claude-sonnet-4.5',
      });

      const calledContent = mockWebhookManager.sendAsPersonality.mock.calls[0][2];
      expect(calledContent).toContain('Response content');

      // Verify exact format: Model: [model-name](<url>) without backticks
      expect(calledContent).toMatch(
        /\n-# Model: \[anthropic\/claude-sonnet-4\.5\]\(<https:\/\/openrouter\.ai\/[^>]+>\)$/
      );
    });

    it('should handle chunked messages', async () => {
      const mockChannel = createMockTextChannel('channel-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      // Create long content that will be chunked
      const longContent = 'x'.repeat(3000);

      mockWebhookManager.sendAsPersonality
        .mockResolvedValueOnce({ id: 'msg-1' })
        .mockResolvedValueOnce({ id: 'msg-2' });

      const result = await sender.sendResponse({
        content: longContent,
        personality: mockPersonality,
        message: mockMessage,
      });

      expect(mockWebhookManager.sendAsPersonality).toHaveBeenCalledTimes(2);
      expect(result.chunkMessageIds).toEqual(['msg-1', 'msg-2']);
      expect(result.chunkCount).toBe(2);
    });
  });

  describe('sendResponse - DM Channel', () => {
    it('should send response as bot reply in DM', async () => {
      const mockChannel = createMockTextChannel('dm-123');
      const mockMessage = createMockMessage(mockChannel, null); // DM has no guild
      (mockMessage.reply as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'reply-123' });

      const result = await sender.sendResponse({
        content: 'Hello in DM!',
        personality: mockPersonality,
        message: mockMessage,
      });

      expect(mockMessage.reply).toHaveBeenCalledWith(expect.stringContaining('Test Bot:'));
      expect(mockMessage.reply).toHaveBeenCalledWith(expect.stringContaining('Hello in DM!'));
      expect(result.chunkMessageIds).toEqual(['reply-123']);
    });

    it('should add personality prefix before chunking in DMs', async () => {
      const mockChannel = createMockTextChannel('dm-123');
      const mockMessage = createMockMessage(mockChannel, null);
      (mockMessage.reply as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ id: 'reply-1' })
        .mockResolvedValueOnce({ id: 'reply-2' });

      // Long content for chunking
      const longContent = 'x'.repeat(3000);

      const result = await sender.sendResponse({
        content: longContent,
        personality: mockPersonality,
        message: mockMessage,
      });

      // Should have added prefix before chunking
      const firstCallContent = mockMessage.reply.mock.calls[0][0];
      expect(firstCallContent).toContain('**Test Bot:**');

      expect(result.chunkMessageIds).toEqual(['reply-1', 'reply-2']);
      expect(result.chunkCount).toBe(2);
    });
  });

  describe('sendResponse - Thread Channel', () => {
    it('should send via webhook in thread (guild context)', async () => {
      const mockChannel = createMockThreadChannel('thread-123');
      const mockMessage = createMockMessage(mockChannel, { id: 'guild-123' });

      await sender.sendResponse({
        content: 'Thread message',
        personality: mockPersonality,
        message: mockMessage,
      });

      expect(mockWebhookManager.sendAsPersonality).toHaveBeenCalledWith(
        mockChannel,
        mockPersonality,
        'Thread message'
      );
    });
  });
});

// Helper functions for creating type-safe mocks
function createMockTextChannel(id: string) {
  const mockChannel = Object.create(TextChannel.prototype);
  mockChannel.id = id;
  return mockChannel;
}

function createMockThreadChannel(id: string) {
  const mockChannel = Object.create(ThreadChannel.prototype);
  mockChannel.id = id;
  return mockChannel;
}

function createMockMessage(channel: any, guild: { id: string } | null) {
  return {
    channel,
    guild,
    reply: vi.fn(),
  };
}
