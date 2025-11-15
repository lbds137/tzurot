/**
 * ReplyResolutionService Unit Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReplyResolutionService } from '../../services/ReplyResolutionService.js';
import type { Message, MessageReference } from 'discord.js';
import type { LoadedPersonality } from '@tzurot/common-types';

// Mock dependencies
vi.mock('../../redis.js', () => ({
  getWebhookPersonality: vi.fn(),
}));

vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    PersonalityService: vi.fn(),
  };
});

import { getWebhookPersonality } from '../../redis.js';

describe('ReplyResolutionService', () => {
  let service: ReplyResolutionService;
  let mockPersonalityService: {
    loadPersonality: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockPersonalityService = {
      loadPersonality: vi.fn(),
    };

    service = new ReplyResolutionService(mockPersonalityService as any);
  });

  describe('resolvePersonality', () => {
    it('should return null when message has no reference', async () => {
      const message = createMockMessage({ reference: null });

      const result = await service.resolvePersonality(message);

      expect(result).toBeNull();
    });

    it('should return null when message reference has no messageId', async () => {
      const message = createMockMessage({
        reference: { messageId: null } as any,
      });

      const result = await service.resolvePersonality(message);

      expect(result).toBeNull();
    });

    it('should return null when referenced message is not from webhook', async () => {
      const referencedMessage = {
        id: 'ref-123',
        webhookId: null,
        author: { username: 'regular_user' },
      };

      const message = createMockMessage({
        reference: { messageId: 'ref-123' } as MessageReference,
        fetchedReferencedMessage: referencedMessage,
      });

      const result = await service.resolvePersonality(message);

      expect(result).toBeNull();
    });

    it('should return null when webhook is from different bot instance', async () => {
      const referencedMessage = {
        id: 'ref-123',
        webhookId: 'webhook-123',
        applicationId: 'other-bot-456',
        author: { username: 'Lilith | Tzurot' },
      };

      const message = createMockMessage({
        reference: { messageId: 'ref-123' } as MessageReference,
        fetchedReferencedMessage: referencedMessage,
        clientUserId: 'current-bot-789',
      });

      const result = await service.resolvePersonality(message);

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
      } as LoadedPersonality;

      const referencedMessage = {
        id: 'ref-123',
        webhookId: 'webhook-123',
        applicationId: 'current-bot-789',
        author: { username: 'Lilith | Tzurot' },
      };

      const message = createMockMessage({
        reference: { messageId: 'ref-123' } as MessageReference,
        fetchedReferencedMessage: referencedMessage,
        clientUserId: 'current-bot-789',
      });

      (getWebhookPersonality as ReturnType<typeof vi.fn>).mockResolvedValue('lilith');
      mockPersonalityService.loadPersonality.mockResolvedValue(mockPersonality);

      const result = await service.resolvePersonality(message);

      expect(getWebhookPersonality).toHaveBeenCalledWith('ref-123');
      expect(mockPersonalityService.loadPersonality).toHaveBeenCalledWith('lilith');
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
      } as LoadedPersonality;

      const referencedMessage = {
        id: 'ref-123',
        webhookId: 'webhook-123',
        applicationId: null, // Same instance (no applicationId check needed)
        author: { username: 'Sarcastic Bot | Tzurot' },
      };

      const message = createMockMessage({
        reference: { messageId: 'ref-123' } as MessageReference,
        fetchedReferencedMessage: referencedMessage,
        clientUserId: 'current-bot-789',
      });

      (getWebhookPersonality as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      mockPersonalityService.loadPersonality.mockResolvedValue(mockPersonality);

      const result = await service.resolvePersonality(message);

      // Should extract "Sarcastic Bot" from "Sarcastic Bot | Tzurot"
      expect(mockPersonalityService.loadPersonality).toHaveBeenCalledWith('Sarcastic Bot');
      expect(result).toBe(mockPersonality);
    });

    it('should return null when personality not found in database', async () => {
      const referencedMessage = {
        id: 'ref-123',
        webhookId: 'webhook-123',
        applicationId: null,
        author: { username: 'Unknown | Tzurot' },
      };

      const message = createMockMessage({
        reference: { messageId: 'ref-123' } as MessageReference,
        fetchedReferencedMessage: referencedMessage,
      });

      (getWebhookPersonality as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      mockPersonalityService.loadPersonality.mockResolvedValue(null);

      const result = await service.resolvePersonality(message);

      expect(result).toBeNull();
    });

    it('should return null when webhook username has no pipe separator', async () => {
      const referencedMessage = {
        id: 'ref-123',
        webhookId: 'webhook-123',
        applicationId: null,
        author: { username: 'NoSeparatorUsername' },
      };

      const message = createMockMessage({
        reference: { messageId: 'ref-123' } as MessageReference,
        fetchedReferencedMessage: referencedMessage,
      });

      (getWebhookPersonality as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await service.resolvePersonality(message);

      expect(mockPersonalityService.loadPersonality).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('should handle fetch errors gracefully', async () => {
      const message = createMockMessage({
        reference: { messageId: 'deleted-message' } as MessageReference,
        fetchWillFail: true,
      });

      const result = await service.resolvePersonality(message);

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
      } as LoadedPersonality;

      const referencedMessage = {
        id: 'ref-123',
        webhookId: 'webhook-123',
        applicationId: 'current-bot-789', // Same as client
        author: { username: 'Default | Tzurot' },
      };

      const message = createMockMessage({
        reference: { messageId: 'ref-123' } as MessageReference,
        fetchedReferencedMessage: referencedMessage,
        clientUserId: 'current-bot-789',
      });

      (getWebhookPersonality as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      mockPersonalityService.loadPersonality.mockResolvedValue(mockPersonality);

      const result = await service.resolvePersonality(message);

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
      } as LoadedPersonality;

      const referencedMessage = {
        id: 'ref-123',
        webhookId: 'webhook-123',
        applicationId: null, // Older webhook
        author: { username: 'Cold | Tzurot' },
      };

      const message = createMockMessage({
        reference: { messageId: 'ref-123' } as MessageReference,
        fetchedReferencedMessage: referencedMessage,
        clientUserId: 'current-bot-789',
      });

      (getWebhookPersonality as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      mockPersonalityService.loadPersonality.mockResolvedValue(mockPersonality);

      const result = await service.resolvePersonality(message);

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
}

function createMockMessage(options: MockMessageOptions = {}): Message {
  const fetchedMessage = options.fetchedReferencedMessage;

  const channel: any = {
    messages: {
      fetch: vi.fn().mockImplementation((messageId: string) => {
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
