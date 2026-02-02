/**
 * ReplyResolutionService Unit Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChannelType } from 'discord.js';
import { ReplyResolutionService } from './ReplyResolutionService.js';
import type { Message, MessageReference } from 'discord.js';
import type { LoadedPersonality } from '@tzurot/common-types';
import type { GatewayClient } from '../utils/GatewayClient.js';

// Mock dependencies
vi.mock('../redis.js', () => ({
  redisService: {
    getWebhookPersonality: vi.fn(),
    storeWebhookMessage: vi.fn(),
    checkHealth: vi.fn(),
    close: vi.fn(),
  },
}));

vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    PersonalityService: vi.fn(),
  };
});

import { redisService } from '../redis.js';

describe('ReplyResolutionService', () => {
  let service: ReplyResolutionService;
  let mockPersonalityService: {
    loadPersonality: ReturnType<typeof vi.fn>;
  };
  let mockGatewayClient: {
    lookupPersonalityFromConversation: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockPersonalityService = {
      loadPersonality: vi.fn(),
    };

    mockGatewayClient = {
      lookupPersonalityFromConversation: vi.fn(),
    };

    service = new ReplyResolutionService(
      mockPersonalityService as any,
      mockGatewayClient as unknown as GatewayClient
    );
  });

  describe('resolvePersonality', () => {
    it('should return null when message has no reference', async () => {
      const message = createMockMessage({ reference: null });

      const result = await service.resolvePersonality(message, 'user-123');

      expect(result).toBeNull();
    });

    it('should return null when message reference has no messageId', async () => {
      const message = createMockMessage({
        reference: { messageId: null } as any,
      });

      const result = await service.resolvePersonality(message, 'user-123');

      expect(result).toBeNull();
    });

    it('should return null when referenced message is not from webhook', async () => {
      const referencedMessage = {
        id: 'ref-123',
        webhookId: null,
        author: { id: 'other-user', username: 'regular_user' },
      };

      const message = createMockMessage({
        reference: { messageId: 'ref-123' } as MessageReference,
        fetchedReferencedMessage: referencedMessage,
        channelType: ChannelType.GuildText,
      });

      const result = await service.resolvePersonality(message, 'user-123');

      expect(result).toBeNull();
    });

    it('should return null when webhook is from different bot instance', async () => {
      const referencedMessage = {
        id: 'ref-123',
        webhookId: 'webhook-123',
        applicationId: 'other-bot-456',
        author: { id: 'webhook-user', username: 'Lilith | Tzurot' },
      };

      const message = createMockMessage({
        reference: { messageId: 'ref-123' } as MessageReference,
        fetchedReferencedMessage: referencedMessage,
        clientUserId: 'current-bot-789',
        channelType: ChannelType.GuildText,
      });

      const result = await service.resolvePersonality(message, 'user-123');

      expect(result).toBeNull();
    });

    it('should resolve personality from Redis cache', async () => {
      const mockPersonality: LoadedPersonality = {
        id: 'pers-123',
        name: 'lilith',
        displayName: 'Lilith',
        systemPrompt: 'Test prompt',
        llmConfig: {
          model: 'test-model',
          temperature: 0.7,
          maxTokens: 1000,
        },
      } as unknown as LoadedPersonality;

      const referencedMessage = {
        id: 'ref-123',
        webhookId: 'webhook-123',
        applicationId: 'current-bot-789',
        author: { id: 'webhook-user', username: 'Lilith | Tzurot' },
      };

      const message = createMockMessage({
        reference: { messageId: 'ref-123' } as MessageReference,
        fetchedReferencedMessage: referencedMessage,
        clientUserId: 'current-bot-789',
        channelType: ChannelType.GuildText,
      });

      (redisService.getWebhookPersonality as ReturnType<typeof vi.fn>).mockResolvedValue('lilith');
      mockPersonalityService.loadPersonality.mockResolvedValue(mockPersonality);

      const result = await service.resolvePersonality(message, 'user-123');

      expect(redisService.getWebhookPersonality).toHaveBeenCalledWith('ref-123');
      // Access control: loadPersonality is called with userId
      expect(mockPersonalityService.loadPersonality).toHaveBeenCalledWith('lilith', 'user-123');
      expect(result).toBe(mockPersonality);
    });

    it('should fallback to parsing webhook username when Redis fails', async () => {
      const mockPersonality: LoadedPersonality = {
        id: 'pers-123',
        name: 'sarcastic',
        displayName: 'Sarcastic Bot',
        systemPrompt: 'Test prompt',
        llmConfig: {
          model: 'test-model',
          temperature: 0.7,
          maxTokens: 1000,
        },
      } as unknown as LoadedPersonality;

      const referencedMessage = {
        id: 'ref-123',
        webhookId: 'webhook-123',
        applicationId: null, // Same instance (no applicationId check needed)
        author: { id: 'webhook-user', username: 'Sarcastic Bot | Tzurot' },
      };

      const message = createMockMessage({
        reference: { messageId: 'ref-123' } as MessageReference,
        fetchedReferencedMessage: referencedMessage,
        clientUserId: 'current-bot-789',
        channelType: ChannelType.GuildText,
      });

      (redisService.getWebhookPersonality as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      mockPersonalityService.loadPersonality.mockResolvedValue(mockPersonality);

      const result = await service.resolvePersonality(message, 'user-123');

      // Should extract "Sarcastic Bot" from "Sarcastic Bot | Tzurot"
      // Access control: loadPersonality is called with userId
      expect(mockPersonalityService.loadPersonality).toHaveBeenCalledWith(
        'Sarcastic Bot',
        'user-123'
      );
      expect(result).toBe(mockPersonality);
    });

    it('should return null when personality not found in database', async () => {
      const referencedMessage = {
        id: 'ref-123',
        webhookId: 'webhook-123',
        applicationId: null,
        author: { id: 'webhook-user', username: 'Unknown | Tzurot' },
      };

      const message = createMockMessage({
        reference: { messageId: 'ref-123' } as MessageReference,
        fetchedReferencedMessage: referencedMessage,
        channelType: ChannelType.GuildText,
      });

      (redisService.getWebhookPersonality as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      mockPersonalityService.loadPersonality.mockResolvedValue(null);

      const result = await service.resolvePersonality(message, 'user-123');

      expect(result).toBeNull();
    });

    it('should return null when webhook username has no pipe separator', async () => {
      const referencedMessage = {
        id: 'ref-123',
        webhookId: 'webhook-123',
        applicationId: null,
        author: { id: 'webhook-user', username: 'NoSeparatorUsername' },
      };

      const message = createMockMessage({
        reference: { messageId: 'ref-123' } as MessageReference,
        fetchedReferencedMessage: referencedMessage,
        channelType: ChannelType.GuildText,
      });

      (redisService.getWebhookPersonality as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await service.resolvePersonality(message, 'user-123');

      expect(mockPersonalityService.loadPersonality).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('should handle fetch errors gracefully', async () => {
      const message = createMockMessage({
        reference: { messageId: 'deleted-message' } as MessageReference,
        fetchWillFail: true,
      });

      const result = await service.resolvePersonality(message, 'user-123');

      expect(result).toBeNull();
    });

    it('should allow webhook from same instance when applicationId matches', async () => {
      const mockPersonality: LoadedPersonality = {
        id: 'pers-123',
        name: 'default',
        displayName: 'Default',
        systemPrompt: 'Test prompt',
        llmConfig: {
          model: 'test-model',
          temperature: 0.7,
          maxTokens: 1000,
        },
      } as unknown as LoadedPersonality;

      const referencedMessage = {
        id: 'ref-123',
        webhookId: 'webhook-123',
        applicationId: 'current-bot-789', // Same as client
        author: { id: 'webhook-user', username: 'Default | Tzurot' },
      };

      const message = createMockMessage({
        reference: { messageId: 'ref-123' } as MessageReference,
        fetchedReferencedMessage: referencedMessage,
        clientUserId: 'current-bot-789',
        channelType: ChannelType.GuildText,
      });

      (redisService.getWebhookPersonality as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      mockPersonalityService.loadPersonality.mockResolvedValue(mockPersonality);

      const result = await service.resolvePersonality(message, 'user-123');

      expect(result).toBe(mockPersonality);
    });

    it('should allow webhook when applicationId is null', async () => {
      // Older webhooks may not have applicationId
      const mockPersonality: LoadedPersonality = {
        id: 'pers-123',
        name: 'cold',
        displayName: 'Cold',
        systemPrompt: 'Test prompt',
        llmConfig: {
          model: 'test-model',
          temperature: 0.7,
          maxTokens: 1000,
        },
      } as unknown as LoadedPersonality;

      const referencedMessage = {
        id: 'ref-123',
        webhookId: 'webhook-123',
        applicationId: null, // Older webhook
        author: { id: 'webhook-user', username: 'Cold | Tzurot' },
      };

      const message = createMockMessage({
        reference: { messageId: 'ref-123' } as MessageReference,
        fetchedReferencedMessage: referencedMessage,
        clientUserId: 'current-bot-789',
        channelType: ChannelType.GuildText,
      });

      (redisService.getWebhookPersonality as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      mockPersonalityService.loadPersonality.mockResolvedValue(mockPersonality);

      const result = await service.resolvePersonality(message, 'user-123');

      expect(result).toBe(mockPersonality);
    });
  });

  describe('DM reply resolution', () => {
    it('should resolve personality from Redis in DM reply to bot message', async () => {
      const mockPersonality: LoadedPersonality = {
        id: 'pers-uuid-123',
        name: 'lilith',
        displayName: 'Lilith',
        systemPrompt: 'Test prompt',
        llmConfig: {
          model: 'test-model',
          temperature: 0.7,
          maxTokens: 1000,
        },
      } as unknown as LoadedPersonality;

      const referencedMessage = {
        id: 'ref-123',
        webhookId: null, // DMs don't have webhooks
        content: '**Lilith:** Hello there!',
        author: { id: 'current-bot-789', username: 'Tzurot' }, // Bot's own message
      };

      const message = createMockMessage({
        reference: { messageId: 'ref-123' } as MessageReference,
        fetchedReferencedMessage: referencedMessage,
        clientUserId: 'current-bot-789',
        channelType: ChannelType.DM,
      });

      // Redis has the personality ID (tier 1)
      (redisService.getWebhookPersonality as ReturnType<typeof vi.fn>).mockResolvedValue(
        'pers-uuid-123'
      );
      mockPersonalityService.loadPersonality.mockResolvedValue(mockPersonality);

      const result = await service.resolvePersonality(message, 'user-123');

      expect(redisService.getWebhookPersonality).toHaveBeenCalledWith('ref-123');
      expect(mockGatewayClient.lookupPersonalityFromConversation).not.toHaveBeenCalled();
      expect(mockPersonalityService.loadPersonality).toHaveBeenCalledWith(
        'pers-uuid-123',
        'user-123'
      );
      expect(result).toBe(mockPersonality);
    });

    it('should fallback to database lookup when Redis misses in DM', async () => {
      const mockPersonality: LoadedPersonality = {
        id: 'pers-uuid-456',
        name: 'lilith',
        displayName: 'Lilith',
        systemPrompt: 'Test prompt',
        llmConfig: {
          model: 'test-model',
          temperature: 0.7,
          maxTokens: 1000,
        },
      } as unknown as LoadedPersonality;

      const referencedMessage = {
        id: 'ref-123',
        webhookId: null,
        content: '**Lilith:** Hello there!',
        author: { id: 'current-bot-789', username: 'Tzurot' },
      };

      const message = createMockMessage({
        reference: { messageId: 'ref-123' } as MessageReference,
        fetchedReferencedMessage: referencedMessage,
        clientUserId: 'current-bot-789',
        channelType: ChannelType.DM,
      });

      // Redis miss (tier 1)
      (redisService.getWebhookPersonality as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      // Database lookup succeeds (tier 2)
      mockGatewayClient.lookupPersonalityFromConversation.mockResolvedValue({
        personalityId: 'pers-uuid-456',
        personalityName: 'Lilith',
      });
      mockPersonalityService.loadPersonality.mockResolvedValue(mockPersonality);

      const result = await service.resolvePersonality(message, 'user-123');

      expect(redisService.getWebhookPersonality).toHaveBeenCalledWith('ref-123');
      expect(mockGatewayClient.lookupPersonalityFromConversation).toHaveBeenCalledWith('ref-123');
      expect(mockPersonalityService.loadPersonality).toHaveBeenCalledWith(
        'pers-uuid-456',
        'user-123'
      );
      expect(result).toBe(mockPersonality);
    });

    it('should fallback to display name parsing when Redis and DB miss in DM', async () => {
      const mockPersonality: LoadedPersonality = {
        id: 'pers-uuid-789',
        name: 'lilith',
        displayName: 'Lilith',
        systemPrompt: 'Test prompt',
        llmConfig: {
          model: 'test-model',
          temperature: 0.7,
          maxTokens: 1000,
        },
      } as unknown as LoadedPersonality;

      const referencedMessage = {
        id: 'ref-123',
        webhookId: null,
        content: '**Lilith:** Hello there!',
        author: { id: 'current-bot-789', username: 'Tzurot' },
      };

      const message = createMockMessage({
        reference: { messageId: 'ref-123' } as MessageReference,
        fetchedReferencedMessage: referencedMessage,
        clientUserId: 'current-bot-789',
        channelType: ChannelType.DM,
      });

      // Redis miss (tier 1)
      (redisService.getWebhookPersonality as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      // Database miss (tier 2)
      mockGatewayClient.lookupPersonalityFromConversation.mockResolvedValue(null);
      // Display name parsing succeeds (tier 3)
      mockPersonalityService.loadPersonality.mockResolvedValue(mockPersonality);

      const result = await service.resolvePersonality(message, 'user-123');

      expect(redisService.getWebhookPersonality).toHaveBeenCalledWith('ref-123');
      expect(mockGatewayClient.lookupPersonalityFromConversation).toHaveBeenCalledWith('ref-123');
      // Should extract "Lilith" from "**Lilith:** Hello there!"
      expect(mockPersonalityService.loadPersonality).toHaveBeenCalledWith('Lilith', 'user-123');
      expect(result).toBe(mockPersonality);
    });

    it('should return null for DM reply to non-bot message', async () => {
      const referencedMessage = {
        id: 'ref-123',
        webhookId: null,
        content: 'Hello!',
        author: { id: 'other-user-456', username: 'SomeUser' }, // Not the bot
      };

      const message = createMockMessage({
        reference: { messageId: 'ref-123' } as MessageReference,
        fetchedReferencedMessage: referencedMessage,
        clientUserId: 'current-bot-789',
        channelType: ChannelType.DM,
      });

      const result = await service.resolvePersonality(message, 'user-123');

      expect(redisService.getWebhookPersonality).not.toHaveBeenCalled();
      expect(mockGatewayClient.lookupPersonalityFromConversation).not.toHaveBeenCalled();
      expect(mockPersonalityService.loadPersonality).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('should return null when DM message content has no personality prefix', async () => {
      const referencedMessage = {
        id: 'ref-123',
        webhookId: null,
        content: 'Some message without prefix', // No **Name:** prefix
        author: { id: 'current-bot-789', username: 'Tzurot' },
      };

      const message = createMockMessage({
        reference: { messageId: 'ref-123' } as MessageReference,
        fetchedReferencedMessage: referencedMessage,
        clientUserId: 'current-bot-789',
        channelType: ChannelType.DM,
      });

      // All tiers miss
      (redisService.getWebhookPersonality as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      mockGatewayClient.lookupPersonalityFromConversation.mockResolvedValue(null);

      const result = await service.resolvePersonality(message, 'user-123');

      expect(mockPersonalityService.loadPersonality).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('should work without gatewayClient (tier 2 skipped)', async () => {
      // Create service without gateway client
      const serviceWithoutGateway = new ReplyResolutionService(mockPersonalityService as any);

      const mockPersonality: LoadedPersonality = {
        id: 'pers-uuid-123',
        name: 'lilith',
        displayName: 'Lilith',
        systemPrompt: 'Test prompt',
        llmConfig: {
          model: 'test-model',
          temperature: 0.7,
          maxTokens: 1000,
        },
      } as unknown as LoadedPersonality;

      const referencedMessage = {
        id: 'ref-123',
        webhookId: null,
        content: '**Lilith:** Hello there!',
        author: { id: 'current-bot-789', username: 'Tzurot' },
      };

      const message = createMockMessage({
        reference: { messageId: 'ref-123' } as MessageReference,
        fetchedReferencedMessage: referencedMessage,
        clientUserId: 'current-bot-789',
        channelType: ChannelType.DM,
      });

      // Redis miss - should skip tier 2 and go to tier 3
      (redisService.getWebhookPersonality as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      mockPersonalityService.loadPersonality.mockResolvedValue(mockPersonality);

      const result = await serviceWithoutGateway.resolvePersonality(message, 'user-123');

      // Tier 2 (database) should be skipped
      expect(mockGatewayClient.lookupPersonalityFromConversation).not.toHaveBeenCalled();
      // Should fall through to tier 3 (display name parsing)
      expect(mockPersonalityService.loadPersonality).toHaveBeenCalledWith('Lilith', 'user-123');
      expect(result).toBe(mockPersonality);
    });
  });
});

// Helper function to create mock Discord message
interface MockMessageOptions {
  reference?: MessageReference | null;
  fetchedReferencedMessage?: any;
  clientUserId?: string;
  fetchWillFail?: boolean;
  channelType?: ChannelType;
}

function createMockMessage(options: MockMessageOptions = {}): Message {
  const fetchedMessage = options.fetchedReferencedMessage;

  const channel: any = {
    type: options.channelType ?? ChannelType.GuildText,
    messages: {
      fetch: vi.fn().mockImplementation((_messageId: string) => {
        if (options.fetchWillFail) {
          return Promise.reject(new Error('Message not found'));
        }
        return Promise.resolve(fetchedMessage);
      }),
    },
  };

  return {
    reference: options.reference ?? null,
    channel,
    client: {
      user: {
        id: options.clientUserId || 'current-bot-789',
      },
    },
  } as unknown as Message;
}
