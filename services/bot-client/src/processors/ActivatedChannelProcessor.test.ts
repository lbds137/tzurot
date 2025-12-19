/**
 * Activated Channel Processor Tests
 *
 * Tests auto-response handling for channels with activated personalities.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ActivatedChannelProcessor } from './ActivatedChannelProcessor.js';
import type { Message } from 'discord.js';
import type { LoadedPersonality, GetChannelActivationResponse } from '@tzurot/common-types';
import type { GatewayClient } from '../utils/GatewayClient.js';
import type { IPersonalityLoader } from '../types/IPersonalityLoader.js';
import type { PersonalityMessageHandler } from '../services/PersonalityMessageHandler.js';

// Mock VoiceMessageProcessor
vi.mock('./VoiceMessageProcessor.js', () => ({
  VoiceMessageProcessor: {
    getVoiceTranscript: vi.fn(),
  },
}));

import { VoiceMessageProcessor } from './VoiceMessageProcessor.js';

function createMockMessage(options?: { content?: string; channelId?: string }): Message {
  return {
    id: '123456789',
    content: options?.content ?? 'Hello world',
    channelId: options?.channelId ?? 'channel-123',
    author: {
      id: 'user-123',
      username: 'testuser',
      bot: false,
    },
  } as unknown as Message;
}

const mockLilithPersonality: LoadedPersonality = {
  id: 'lilith-id',
  name: 'Lilith',
  slug: 'lilith',
  displayName: 'Lilith',
  systemPrompt: 'Lilith personality',
  model: 'anthropic/claude-sonnet-4.5',
  temperature: 0.8,
  avatarUrl: 'https://example.com/lilith.png',
  requiresImageSupport: false,
  requiredCapabilities: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: 'user-123',
};

describe('ActivatedChannelProcessor', () => {
  let processor: ActivatedChannelProcessor;
  let mockGatewayClient: {
    getChannelActivation: ReturnType<typeof vi.fn>;
  };
  let mockPersonalityService: {
    loadPersonality: ReturnType<typeof vi.fn>;
  };
  let mockPersonalityHandler: {
    handleMessage: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockGatewayClient = {
      getChannelActivation: vi.fn(),
    };

    mockPersonalityService = {
      loadPersonality: vi.fn(),
    };

    mockPersonalityHandler = {
      handleMessage: vi.fn(),
    };

    processor = new ActivatedChannelProcessor(
      mockGatewayClient as unknown as GatewayClient,
      mockPersonalityService as unknown as IPersonalityLoader,
      mockPersonalityHandler as unknown as PersonalityMessageHandler
    );
  });

  describe('Channel activation check', () => {
    it('should continue processing when channel is not activated', async () => {
      const message = createMockMessage();
      mockGatewayClient.getChannelActivation.mockResolvedValue(null);

      const result = await processor.process(message);

      expect(result).toBe(false); // Should continue to next processor
      expect(mockGatewayClient.getChannelActivation).toHaveBeenCalledWith('channel-123');
      expect(mockPersonalityService.loadPersonality).not.toHaveBeenCalled();
    });

    it('should continue processing when activation response has isActivated=false', async () => {
      const message = createMockMessage();
      mockGatewayClient.getChannelActivation.mockResolvedValue({
        isActivated: false,
      } as GetChannelActivationResponse);

      const result = await processor.process(message);

      expect(result).toBe(false);
      expect(mockPersonalityService.loadPersonality).not.toHaveBeenCalled();
    });

    it('should auto-respond when channel has activated personality', async () => {
      const message = createMockMessage({ content: 'Hello there' });
      mockGatewayClient.getChannelActivation.mockResolvedValue({
        isActivated: true,
        activation: {
          id: 'activation-id',
          channelId: 'channel-123',
          personalitySlug: 'lilith',
          personalityName: 'Lilith',
          activatedBy: 'activator-uuid',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      } as GetChannelActivationResponse);
      mockPersonalityService.loadPersonality.mockResolvedValue(mockLilithPersonality);

      const result = await processor.process(message);

      expect(mockGatewayClient.getChannelActivation).toHaveBeenCalledWith('channel-123');
      expect(mockPersonalityService.loadPersonality).toHaveBeenCalledWith('lilith', 'user-123');
      expect(mockPersonalityHandler.handleMessage).toHaveBeenCalledWith(
        message,
        mockLilithPersonality,
        'Hello there',
        { isAutoResponse: true }
      );
      expect(result).toBe(true); // Should stop processing (handled)
    });

    it('should continue processing when personality is not accessible to user', async () => {
      const message = createMockMessage();
      mockGatewayClient.getChannelActivation.mockResolvedValue({
        isActivated: true,
        activation: {
          id: 'activation-id',
          channelId: 'channel-123',
          personalitySlug: 'private-personality',
          personalityName: 'Private Personality',
          activatedBy: 'other-user-uuid',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      } as GetChannelActivationResponse);
      // User doesn't have access to the private personality
      mockPersonalityService.loadPersonality.mockResolvedValue(null);

      const result = await processor.process(message);

      expect(mockPersonalityService.loadPersonality).toHaveBeenCalledWith(
        'private-personality',
        'user-123'
      );
      expect(mockPersonalityHandler.handleMessage).not.toHaveBeenCalled();
      expect(result).toBe(false); // Should continue to next processor
    });

    it('should continue processing when activated personality was deleted', async () => {
      const message = createMockMessage();
      mockGatewayClient.getChannelActivation.mockResolvedValue({
        isActivated: true,
        activation: {
          id: 'activation-id',
          channelId: 'channel-123',
          personalitySlug: 'deleted-personality',
          personalityName: 'Deleted Personality',
          activatedBy: 'user-uuid',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      } as GetChannelActivationResponse);
      // Personality was deleted
      mockPersonalityService.loadPersonality.mockResolvedValue(null);

      const result = await processor.process(message);

      expect(mockPersonalityHandler.handleMessage).not.toHaveBeenCalled();
      expect(result).toBe(false); // Should continue to next processor
    });
  });

  describe('Voice transcript integration', () => {
    it('should use voice transcript when available', async () => {
      const message = createMockMessage({ content: 'Text content' });
      mockGatewayClient.getChannelActivation.mockResolvedValue({
        isActivated: true,
        activation: {
          id: 'activation-id',
          channelId: 'channel-123',
          personalitySlug: 'lilith',
          personalityName: 'Lilith',
          activatedBy: 'user-uuid',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      } as GetChannelActivationResponse);
      mockPersonalityService.loadPersonality.mockResolvedValue(mockLilithPersonality);
      (VoiceMessageProcessor.getVoiceTranscript as ReturnType<typeof vi.fn>).mockReturnValue(
        'Voice transcript text'
      );

      await processor.process(message);

      expect(mockPersonalityHandler.handleMessage).toHaveBeenCalledWith(
        message,
        mockLilithPersonality,
        'Voice transcript text', // Voice transcript used instead of message content
        { isAutoResponse: true }
      );
    });

    it('should use message content when no voice transcript', async () => {
      const message = createMockMessage({ content: 'Text content' });
      mockGatewayClient.getChannelActivation.mockResolvedValue({
        isActivated: true,
        activation: {
          id: 'activation-id',
          channelId: 'channel-123',
          personalitySlug: 'lilith',
          personalityName: 'Lilith',
          activatedBy: 'user-uuid',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      } as GetChannelActivationResponse);
      mockPersonalityService.loadPersonality.mockResolvedValue(mockLilithPersonality);
      (VoiceMessageProcessor.getVoiceTranscript as ReturnType<typeof vi.fn>).mockReturnValue(
        undefined
      );

      await processor.process(message);

      expect(mockPersonalityHandler.handleMessage).toHaveBeenCalledWith(
        message,
        mockLilithPersonality,
        'Text content', // Message content used
        { isAutoResponse: true }
      );
    });
  });

  describe('isAutoResponse flag', () => {
    it('should always pass isAutoResponse: true when handling activated channel messages', async () => {
      const message = createMockMessage();
      mockGatewayClient.getChannelActivation.mockResolvedValue({
        isActivated: true,
        activation: {
          id: 'activation-id',
          channelId: 'channel-123',
          personalitySlug: 'lilith',
          personalityName: 'Lilith',
          activatedBy: 'user-uuid',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      } as GetChannelActivationResponse);
      mockPersonalityService.loadPersonality.mockResolvedValue(mockLilithPersonality);

      await processor.process(message);

      // Verify the fourth argument contains isAutoResponse: true
      expect(mockPersonalityHandler.handleMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        { isAutoResponse: true }
      );
    });
  });
});
