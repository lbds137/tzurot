/**
 * DM Session Processor Tests
 *
 * Tests sticky DM personality sessions.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ChannelType, Collection } from 'discord.js';
import { DMSessionProcessor } from './DMSessionProcessor.js';
import type { Message, DMChannel, Client } from 'discord.js';
import type { LoadedPersonality } from '@tzurot/common-types';
import type { GatewayClient } from '../utils/GatewayClient.js';
import type { IPersonalityLoader } from '../types/IPersonalityLoader.js';
import type { PersonalityMessageHandler } from '../services/PersonalityMessageHandler.js';

// Mock VoiceMessageProcessor
vi.mock('./VoiceMessageProcessor.js', () => ({
  VoiceMessageProcessor: {
    getVoiceTranscript: vi.fn(),
  },
}));

// Mock nsfwVerification
vi.mock('../utils/nsfwVerification.js', () => ({
  isDMChannel: vi.fn(),
  checkNsfwVerification: vi.fn(),
  sendNsfwVerificationMessage: vi.fn().mockResolvedValue(undefined),
  trackPendingVerificationMessage: vi.fn(),
  NSFW_VERIFICATION_MESSAGE: '**Age Verification Required**\n\nMocked message',
}));

// Mock personalityMentionParser
vi.mock('../utils/personalityMentionParser.js', () => ({
  findPersonalityMention: vi.fn(),
}));

import { VoiceMessageProcessor } from './VoiceMessageProcessor.js';
import {
  isDMChannel,
  checkNsfwVerification,
  sendNsfwVerificationMessage,
  trackPendingVerificationMessage,
} from '../utils/nsfwVerification.js';
import { findPersonalityMention } from '../utils/personalityMentionParser.js';

function createMockDMChannel(overrides: Partial<DMChannel> = {}): DMChannel {
  const messagesCollection = new Collection<string, Message>();
  return {
    id: 'dm-channel-123',
    type: ChannelType.DM,
    messages: {
      fetch: vi.fn().mockResolvedValue(messagesCollection),
    },
    ...overrides,
  } as unknown as DMChannel;
}

function createMockBotMessage(options: { id: string; content: string; botId: string }): Message {
  return {
    id: options.id,
    content: options.content,
    author: {
      id: options.botId,
      bot: true,
    },
  } as unknown as Message;
}

function createMockMessage(options?: {
  content?: string;
  channelId?: string;
  userId?: string;
  channel?: DMChannel;
  botId?: string;
}): Message {
  const channel = options?.channel ?? createMockDMChannel();
  return {
    id: '123456789',
    content: options?.content ?? 'Hello world',
    channelId: options?.channelId ?? channel.id,
    channel,
    author: {
      id: options?.userId ?? 'user-123',
      username: 'testuser',
      bot: false,
    },
    client: {
      user: {
        id: options?.botId ?? 'bot-123',
      },
    } as Client,
    reply: vi.fn().mockResolvedValue({
      id: 'help-msg-123',
      delete: vi.fn().mockResolvedValue(undefined),
    }),
  } as unknown as Message;
}

const mockLilithPersonality = {
  id: 'lilith-id',
  name: 'Lilith',
  slug: 'lilith',
  displayName: 'Lilith',
  systemPrompt: 'Lilith personality',
  model: 'anthropic/claude-sonnet-4.5',
  temperature: 0.8,
  avatarUrl: 'https://example.com/lilith.png',
} as unknown as LoadedPersonality;

describe('DMSessionProcessor', () => {
  let processor: DMSessionProcessor;
  let mockGatewayClient: {
    lookupPersonalityFromConversation: ReturnType<typeof vi.fn>;
  };
  let mockPersonalityService: {
    loadPersonality: ReturnType<typeof vi.fn>;
  };
  let mockPersonalityHandler: {
    handleMessage: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    // Default: isDMChannel returns false (override in specific tests)
    vi.mocked(isDMChannel).mockReturnValue(false);
    vi.mocked(VoiceMessageProcessor.getVoiceTranscript).mockReturnValue(undefined);
    // Default: user is NSFW verified (override in specific tests)
    vi.mocked(checkNsfwVerification).mockResolvedValue({
      nsfwVerified: true,
      nsfwVerifiedAt: new Date().toISOString(),
    });
    vi.mocked(trackPendingVerificationMessage).mockResolvedValue(undefined);
    // Default: no explicit personality mention (override in specific tests)
    vi.mocked(findPersonalityMention).mockResolvedValue(null);

    mockGatewayClient = {
      lookupPersonalityFromConversation: vi.fn(),
    };

    mockPersonalityService = {
      loadPersonality: vi.fn(),
    };

    mockPersonalityHandler = {
      handleMessage: vi.fn(),
    };

    processor = new DMSessionProcessor(
      mockGatewayClient as unknown as GatewayClient,
      mockPersonalityService as unknown as IPersonalityLoader,
      mockPersonalityHandler as unknown as PersonalityMessageHandler
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Channel type filtering', () => {
    it('should return false for non-DM channels', async () => {
      const message = createMockMessage();
      vi.mocked(isDMChannel).mockReturnValue(false);

      const result = await processor.process(message);

      expect(result).toBe(false);
      expect(mockGatewayClient.lookupPersonalityFromConversation).not.toHaveBeenCalled();
    });

    it('should process DM channels', async () => {
      const channel = createMockDMChannel();
      const message = createMockMessage({ channel });
      vi.mocked(isDMChannel).mockReturnValue(true);

      // No active session
      const result = await processor.process(message);

      expect(result).toBe(true); // Handled (sent help message)
    });
  });

  describe('Active session detection', () => {
    it('should find active personality from recent bot message with prefix', async () => {
      const botId = 'bot-123';
      const botMessage = createMockBotMessage({
        id: 'bot-msg-123',
        content: '**Lilith:** Hello there!',
        botId,
      });

      const messagesCollection = new Collection<string, Message>();
      messagesCollection.set(botMessage.id, botMessage);

      const channel = createMockDMChannel();
      (channel.messages.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(messagesCollection);

      const message = createMockMessage({ channel, botId });
      vi.mocked(isDMChannel).mockReturnValue(true);

      mockGatewayClient.lookupPersonalityFromConversation.mockResolvedValue({
        personalityId: 'lilith-id',
      });
      mockPersonalityService.loadPersonality.mockResolvedValue(mockLilithPersonality);

      const result = await processor.process(message);

      expect(result).toBe(true);
      expect(mockGatewayClient.lookupPersonalityFromConversation).toHaveBeenCalledWith(
        'bot-msg-123'
      );
      expect(mockPersonalityService.loadPersonality).toHaveBeenCalledWith('lilith-id', 'user-123');
      expect(mockPersonalityHandler.handleMessage).toHaveBeenCalledWith(
        message,
        mockLilithPersonality,
        'Hello world',
        { isAutoResponse: true }
      );
    });

    it('should skip bot messages without personality prefix', async () => {
      const botId = 'bot-123';

      // Ephemeral message without prefix (like NSFW verification)
      const ephemeralMessage = createMockBotMessage({
        id: 'ephemeral-msg',
        content: '**Age Verification Required**\n\nTo chat with me...',
        botId,
      });

      // Personality message with prefix
      const personalityMessage = createMockBotMessage({
        id: 'personality-msg',
        content: '**Lilith:** Older message here',
        botId,
      });

      const messagesCollection = new Collection<string, Message>();
      // Ephemeral is more recent (first in collection)
      messagesCollection.set(ephemeralMessage.id, ephemeralMessage);
      messagesCollection.set(personalityMessage.id, personalityMessage);

      const channel = createMockDMChannel();
      (channel.messages.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(messagesCollection);

      const message = createMockMessage({ channel, botId });
      vi.mocked(isDMChannel).mockReturnValue(true);

      mockGatewayClient.lookupPersonalityFromConversation.mockResolvedValue({
        personalityId: 'lilith-id',
      });
      mockPersonalityService.loadPersonality.mockResolvedValue(mockLilithPersonality);

      await processor.process(message);

      // Should have skipped ephemeral message and found personality message
      expect(mockGatewayClient.lookupPersonalityFromConversation).toHaveBeenCalledWith(
        'personality-msg'
      );
      expect(mockPersonalityHandler.handleMessage).toHaveBeenCalled();
    });

    it('should skip non-bot messages when scanning', async () => {
      const botId = 'bot-123';

      // User message (not from bot)
      const userMessage = {
        id: 'user-msg',
        content: '**Lilith:** Fake prefix from user',
        author: { id: 'user-123', bot: false },
      } as unknown as Message;

      // Bot message
      const botMessage = createMockBotMessage({
        id: 'bot-msg',
        content: '**Lilith:** Real bot message',
        botId,
      });

      const messagesCollection = new Collection<string, Message>();
      messagesCollection.set(userMessage.id, userMessage);
      messagesCollection.set(botMessage.id, botMessage);

      const channel = createMockDMChannel();
      (channel.messages.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(messagesCollection);

      const message = createMockMessage({ channel, botId });
      vi.mocked(isDMChannel).mockReturnValue(true);

      mockGatewayClient.lookupPersonalityFromConversation.mockResolvedValue({
        personalityId: 'lilith-id',
      });
      mockPersonalityService.loadPersonality.mockResolvedValue(mockLilithPersonality);

      await processor.process(message);

      // Should only look up bot message, not user message
      expect(mockGatewayClient.lookupPersonalityFromConversation).toHaveBeenCalledWith('bot-msg');
      expect(mockGatewayClient.lookupPersonalityFromConversation).not.toHaveBeenCalledWith(
        'user-msg'
      );
    });

    it('should try next message if conversation lookup returns null', async () => {
      const botId = 'bot-123';

      const oldMessage = createMockBotMessage({
        id: 'old-msg',
        content: '**OldPersonality:** Very old message',
        botId,
      });

      const recentMessage = createMockBotMessage({
        id: 'recent-msg',
        content: '**Lilith:** Recent message',
        botId,
      });

      const messagesCollection = new Collection<string, Message>();
      // Recent first (Discord returns newest first)
      messagesCollection.set(recentMessage.id, recentMessage);
      messagesCollection.set(oldMessage.id, oldMessage);

      const channel = createMockDMChannel();
      (channel.messages.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(messagesCollection);

      const message = createMockMessage({ channel, botId });
      vi.mocked(isDMChannel).mockReturnValue(true);

      // First lookup (recent) returns null, second (old) returns personality
      mockGatewayClient.lookupPersonalityFromConversation
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ personalityId: 'old-personality-id' });

      const oldPersonality = {
        ...mockLilithPersonality,
        id: 'old-personality-id',
        displayName: 'OldPersonality',
      };
      mockPersonalityService.loadPersonality.mockResolvedValue(oldPersonality);

      await processor.process(message);

      expect(mockGatewayClient.lookupPersonalityFromConversation).toHaveBeenCalledTimes(2);
      expect(mockPersonalityService.loadPersonality).toHaveBeenCalledWith(
        'old-personality-id',
        'user-123'
      );
    });
  });

  describe('Help message', () => {
    it('should send help message when no active session', async () => {
      const channel = createMockDMChannel();
      const message = createMockMessage({ channel });
      vi.mocked(isDMChannel).mockReturnValue(true);

      // Empty messages collection (no previous conversations)
      const result = await processor.process(message);

      expect(result).toBe(true);
      expect(message.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('No active conversation'),
      });
      expect(message.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('@character_name'),
      });
    });

    it('should send help message when personality not accessible', async () => {
      const botId = 'bot-123';
      const botMessage = createMockBotMessage({
        id: 'bot-msg-123',
        content: '**PrivateBot:** Hello',
        botId,
      });

      const messagesCollection = new Collection<string, Message>();
      messagesCollection.set(botMessage.id, botMessage);

      const channel = createMockDMChannel();
      (channel.messages.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(messagesCollection);

      const message = createMockMessage({ channel, botId });
      vi.mocked(isDMChannel).mockReturnValue(true);

      mockGatewayClient.lookupPersonalityFromConversation.mockResolvedValue({
        personalityId: 'private-id',
      });
      // User doesn't have access
      mockPersonalityService.loadPersonality.mockResolvedValue(null);

      const result = await processor.process(message);

      expect(result).toBe(true);
      expect(message.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('No active conversation'),
      });
      expect(mockPersonalityHandler.handleMessage).not.toHaveBeenCalled();
    });

    it('should delete help message after 30 seconds', async () => {
      const channel = createMockDMChannel();
      const mockDelete = vi.fn().mockResolvedValue(undefined);
      const message = createMockMessage({ channel });
      (message.reply as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'help-msg-123',
        delete: mockDelete,
      });
      vi.mocked(isDMChannel).mockReturnValue(true);

      await processor.process(message);

      // Help message sent but not deleted yet
      expect(message.reply).toHaveBeenCalled();
      expect(mockDelete).not.toHaveBeenCalled();

      // Advance time by 30 seconds
      await vi.advanceTimersByTimeAsync(30_000);

      expect(mockDelete).toHaveBeenCalledTimes(1);
    });

    it('should handle help message deletion failure gracefully', async () => {
      const channel = createMockDMChannel();
      const mockDelete = vi.fn().mockRejectedValue(new Error('Message not found'));
      const message = createMockMessage({ channel });
      (message.reply as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'help-msg-123',
        delete: mockDelete,
      });
      vi.mocked(isDMChannel).mockReturnValue(true);

      await processor.process(message);

      // Should not throw when deletion fails
      await vi.advanceTimersByTimeAsync(30_000);
      expect(mockDelete).toHaveBeenCalled();
    });

    it('should handle help message send failure gracefully', async () => {
      const channel = createMockDMChannel();
      const message = createMockMessage({ channel });
      (message.reply as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Cannot send messages to this user')
      );
      vi.mocked(isDMChannel).mockReturnValue(true);

      // Should not throw
      const result = await processor.process(message);
      expect(result).toBe(true);
    });
  });

  describe('Voice transcript integration', () => {
    it('should use voice transcript when available', async () => {
      const botId = 'bot-123';
      const botMessage = createMockBotMessage({
        id: 'bot-msg-123',
        content: '**Lilith:** Hello',
        botId,
      });

      const messagesCollection = new Collection<string, Message>();
      messagesCollection.set(botMessage.id, botMessage);

      const channel = createMockDMChannel();
      (channel.messages.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(messagesCollection);

      const message = createMockMessage({ channel, botId, content: 'Text content' });
      vi.mocked(isDMChannel).mockReturnValue(true);
      vi.mocked(VoiceMessageProcessor.getVoiceTranscript).mockReturnValue('Voice transcript text');

      mockGatewayClient.lookupPersonalityFromConversation.mockResolvedValue({
        personalityId: 'lilith-id',
      });
      mockPersonalityService.loadPersonality.mockResolvedValue(mockLilithPersonality);

      await processor.process(message);

      expect(mockPersonalityHandler.handleMessage).toHaveBeenCalledWith(
        message,
        mockLilithPersonality,
        'Voice transcript text', // Voice transcript used
        { isAutoResponse: true }
      );
    });
  });

  describe('Error handling', () => {
    it('should handle message fetch errors gracefully', async () => {
      const channel = createMockDMChannel();
      (channel.messages.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Discord API error')
      );

      const message = createMockMessage({ channel });
      vi.mocked(isDMChannel).mockReturnValue(true);

      // Should not throw, should send help message instead
      const result = await processor.process(message);

      expect(result).toBe(true);
      expect(message.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('No active conversation'),
      });
    });

    it('should handle missing bot ID gracefully', async () => {
      const channel = createMockDMChannel();
      const message = createMockMessage({ channel });
      // Override client to have no user
      (message.client as unknown as { user: null }).user = null;
      vi.mocked(isDMChannel).mockReturnValue(true);

      const result = await processor.process(message);

      expect(result).toBe(true);
      expect(message.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('No active conversation'),
      });
    });
  });

  describe('isAutoResponse flag', () => {
    it('should always pass isAutoResponse: true when handling DM session messages', async () => {
      const botId = 'bot-123';
      const botMessage = createMockBotMessage({
        id: 'bot-msg-123',
        content: '**Lilith:** Hello',
        botId,
      });

      const messagesCollection = new Collection<string, Message>();
      messagesCollection.set(botMessage.id, botMessage);

      const channel = createMockDMChannel();
      (channel.messages.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(messagesCollection);

      const message = createMockMessage({ channel, botId });
      vi.mocked(isDMChannel).mockReturnValue(true);

      mockGatewayClient.lookupPersonalityFromConversation.mockResolvedValue({
        personalityId: 'lilith-id',
      });
      mockPersonalityService.loadPersonality.mockResolvedValue(mockLilithPersonality);

      await processor.process(message);

      expect(mockPersonalityHandler.handleMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        { isAutoResponse: true }
      );
    });
  });

  describe('Explicit mention handling', () => {
    it('should defer to PersonalityMentionProcessor when explicit mention found', async () => {
      const botId = 'bot-123';
      const botMessage = createMockBotMessage({
        id: 'bot-msg-123',
        content: '**COLD:** Hello',
        botId,
      });

      const messagesCollection = new Collection<string, Message>();
      messagesCollection.set(botMessage.id, botMessage);

      const channel = createMockDMChannel();
      (channel.messages.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(messagesCollection);

      const message = createMockMessage({ channel, botId, content: '&Selah hi' });
      vi.mocked(isDMChannel).mockReturnValue(true);

      // Setup: COLD is active, but user mentioned Selah
      mockGatewayClient.lookupPersonalityFromConversation.mockResolvedValue({
        personalityId: 'cold-id',
      });
      vi.mocked(findPersonalityMention).mockResolvedValue({
        personalityName: 'Selah',
        cleanContent: 'hi',
      });

      const result = await processor.process(message);

      // Should return false to let PersonalityMentionProcessor handle it
      expect(result).toBe(false);
      // Should NOT route to COLD
      expect(mockPersonalityHandler.handleMessage).not.toHaveBeenCalled();
      // Should NOT show help message
      expect(message.reply).not.toHaveBeenCalled();
    });

    it('should process normally when no explicit mention', async () => {
      const botId = 'bot-123';
      const botMessage = createMockBotMessage({
        id: 'bot-msg-123',
        content: '**Lilith:** Hello',
        botId,
      });

      const messagesCollection = new Collection<string, Message>();
      messagesCollection.set(botMessage.id, botMessage);

      const channel = createMockDMChannel();
      (channel.messages.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(messagesCollection);

      const message = createMockMessage({ channel, botId, content: 'just a normal message' });
      vi.mocked(isDMChannel).mockReturnValue(true);

      // No explicit mention
      vi.mocked(findPersonalityMention).mockResolvedValue(null);

      mockGatewayClient.lookupPersonalityFromConversation.mockResolvedValue({
        personalityId: 'lilith-id',
      });
      mockPersonalityService.loadPersonality.mockResolvedValue(mockLilithPersonality);

      const result = await processor.process(message);

      // Should process via active session
      expect(result).toBe(true);
      expect(mockPersonalityHandler.handleMessage).toHaveBeenCalledWith(
        message,
        mockLilithPersonality,
        'just a normal message',
        { isAutoResponse: true }
      );
    });
  });

  describe('NSFW verification', () => {
    it('should block unverified users and send verification message', async () => {
      const channel = createMockDMChannel();
      const message = createMockMessage({ channel });
      vi.mocked(isDMChannel).mockReturnValue(true);
      vi.mocked(checkNsfwVerification).mockResolvedValue({
        nsfwVerified: false,
        nsfwVerifiedAt: null,
      });

      const result = await processor.process(message);

      expect(result).toBe(true); // Consumed message
      expect(sendNsfwVerificationMessage).toHaveBeenCalledWith(message, 'DMSessionProcessor');
      // Should NOT check for active session or send help message
      expect(mockGatewayClient.lookupPersonalityFromConversation).not.toHaveBeenCalled();
    });

    it('should allow verified users to continue', async () => {
      const channel = createMockDMChannel();
      const message = createMockMessage({ channel });
      vi.mocked(isDMChannel).mockReturnValue(true);
      vi.mocked(checkNsfwVerification).mockResolvedValue({
        nsfwVerified: true,
        nsfwVerifiedAt: new Date().toISOString(),
      });

      // No active session - should get help message (not verification message)
      const result = await processor.process(message);

      expect(result).toBe(true);
      expect(message.reply).toHaveBeenCalledWith({
        content: expect.stringContaining('No active conversation'),
      });
      expect(sendNsfwVerificationMessage).not.toHaveBeenCalled();
    });

    it('should check NSFW verification before checking for active personality', async () => {
      const botId = 'bot-123';
      const botMessage = createMockBotMessage({
        id: 'bot-msg-123',
        content: '**Lilith:** Hello',
        botId,
      });

      const messagesCollection = new Collection<string, Message>();
      messagesCollection.set(botMessage.id, botMessage);

      const channel = createMockDMChannel();
      (channel.messages.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(messagesCollection);

      const message = createMockMessage({ channel, botId });
      vi.mocked(isDMChannel).mockReturnValue(true);
      vi.mocked(checkNsfwVerification).mockResolvedValue({
        nsfwVerified: false,
        nsfwVerifiedAt: null,
      });

      mockGatewayClient.lookupPersonalityFromConversation.mockResolvedValue({
        personalityId: 'lilith-id',
      });
      mockPersonalityService.loadPersonality.mockResolvedValue(mockLilithPersonality);

      const result = await processor.process(message);

      // Even though there's an active personality, should block for verification
      expect(result).toBe(true);
      expect(sendNsfwVerificationMessage).toHaveBeenCalledWith(message, 'DMSessionProcessor');
      expect(mockPersonalityHandler.handleMessage).not.toHaveBeenCalled();
    });
  });
});
