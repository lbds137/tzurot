/**
 * ReferenceEnrichmentService Unit Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReferenceEnrichmentService } from './ReferenceEnrichmentService.js';
import { MessageRole } from '@tzurot/common-types';
import type { ConversationMessage, ReferencedMessage } from '@tzurot/common-types';

// Helper to create a valid ReferencedMessage with all required fields
function createReferencedMessage(overrides: Partial<ReferencedMessage> = {}): ReferencedMessage {
  return {
    referenceNumber: 1,
    discordMessageId: 'msg-123',
    discordUserId: 'user-123',
    authorUsername: 'test_user',
    authorDisplayName: 'Test User',
    content: 'Test message',
    embeds: '',
    timestamp: new Date().toISOString(),
    locationContext: 'Test Server / #general',
    ...overrides,
  };
}

// Mock PersonaResolver
const mockPersonaResolver = {
  resolve: vi.fn(),
  resolveForMemory: vi.fn(),
  getPersonaContentForPrompt: vi.fn(),
  invalidateUserCache: vi.fn(),
  clearCache: vi.fn(),
  stopCleanup: vi.fn(),
};

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
    UserService: vi.fn(),
  };
});

import { redisService } from '../redis.js';

describe('ReferenceEnrichmentService', () => {
  let service: ReferenceEnrichmentService;
  let mockUserService: {
    getOrCreateUser: ReturnType<typeof vi.fn>;
    getPersonaName: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockUserService = {
      getOrCreateUser: vi.fn(),
      getPersonaName: vi.fn(),
    };

    service = new ReferenceEnrichmentService(mockUserService as any, mockPersonaResolver as any);

    // Default mock for PersonaResolver.resolve
    mockPersonaResolver.resolve.mockResolvedValue({
      config: {
        personaId: 'persona-123',
        preferredName: 'Test Persona',
        pronouns: null,
        content: '',
        shareLtmAcrossPersonalities: false,
      },
      source: 'user-default',
    });
  });

  describe('enrichWithPersonaNames', () => {
    it('should do nothing when no references provided', async () => {
      await service.enrichWithPersonaNames([], [], 'personality-123');

      expect(mockUserService.getOrCreateUser).not.toHaveBeenCalled();
    });

    it('should enrich reference with persona name from conversation history', async () => {
      const references: ReferencedMessage[] = [
        createReferencedMessage({
          discordMessageId: 'msg-123',
          discordUserId: 'user-123',
          authorUsername: 'john_doe',
          authorDisplayName: 'John Doe',
          content: 'Hello',
        }),
      ];

      const conversationHistory: ConversationMessage[] = [
        {
          id: 'conv-1',
          role: MessageRole.User,
          content: 'Previous message',
          personaId: 'persona-123',
          personaName: 'Johnny',
          createdAt: new Date(),
          discordMessageId: [],
        },
      ];

      (redisService.getWebhookPersonality as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      mockUserService.getOrCreateUser.mockResolvedValue('user-123');
      // PersonaResolver.resolve is already mocked in beforeEach with persona-123

      await service.enrichWithPersonaNames(references, conversationHistory, 'personality-123');

      // Should use cached persona name from conversation history
      expect(references[0].authorDisplayName).toBe('Johnny');
      expect(mockUserService.getPersonaName).not.toHaveBeenCalled(); // Should not hit database
    });

    it('should enrich reference with persona name from database when not in history', async () => {
      const references: ReferencedMessage[] = [
        createReferencedMessage({
          discordMessageId: 'msg-123',
          discordUserId: 'user-123',
          authorUsername: 'john_doe',
          authorDisplayName: 'John Doe',
          content: 'Hello',
        }),
      ];

      const conversationHistory: ConversationMessage[] = []; // Empty history

      (redisService.getWebhookPersonality as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      mockUserService.getOrCreateUser.mockResolvedValue('user-123');
      // Override persona resolver to return persona-456
      mockPersonaResolver.resolve.mockResolvedValue({
        config: {
          personaId: 'persona-456',
          preferredName: 'Resolved Name',
          pronouns: null,
          content: '',
          shareLtmAcrossPersonalities: false,
        },
        source: 'user-default',
      });
      mockUserService.getPersonaName.mockResolvedValue('Database Johnny');

      await service.enrichWithPersonaNames(references, conversationHistory, 'personality-123');

      // Should fetch from database since not in history
      expect(mockUserService.getPersonaName).toHaveBeenCalledWith('persona-456');
      expect(references[0].authorDisplayName).toBe('Database Johnny');
    });

    it('should skip webhook messages detected via Redis', async () => {
      const references: ReferencedMessage[] = [
        createReferencedMessage({
          discordMessageId: 'msg-webhook',
          discordUserId: 'user-123',
          authorUsername: 'bot_webhook',
          authorDisplayName: 'Bot Personality',
          content: 'AI response',
        }),
      ];

      (redisService.getWebhookPersonality as ReturnType<typeof vi.fn>).mockResolvedValue({
        personalityId: 'personality-bot',
      });

      await service.enrichWithPersonaNames(references, [], 'personality-123');

      // Should not attempt to enrich
      expect(mockUserService.getOrCreateUser).not.toHaveBeenCalled();
      expect(references[0].authorDisplayName).toBe('Bot Personality'); // Unchanged
    });

    it('should skip webhook messages detected via webhookId', async () => {
      const references: ReferencedMessage[] = [
        createReferencedMessage({
          discordMessageId: 'msg-webhook',
          discordUserId: 'user-123',
          authorUsername: 'pluralkit',
          authorDisplayName: 'PluralKit User',
          webhookId: 'webhook-456', // Discord webhookId present
          content: 'Message from PluralKit',
        }),
      ];

      (redisService.getWebhookPersonality as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await service.enrichWithPersonaNames(references, [], 'personality-123');

      // Should not attempt to enrich
      expect(mockUserService.getOrCreateUser).not.toHaveBeenCalled();
      expect(references[0].authorDisplayName).toBe('PluralKit User'); // Unchanged
    });

    it('should handle multiple references in one call', async () => {
      const references: ReferencedMessage[] = [
        createReferencedMessage({
          referenceNumber: 1,
          discordMessageId: 'msg-1',
          discordUserId: 'user-1',
          authorUsername: 'alice',
          authorDisplayName: 'Alice',
          content: 'Message 1',
        }),
        createReferencedMessage({
          referenceNumber: 2,
          discordMessageId: 'msg-2',
          discordUserId: 'user-2',
          authorUsername: 'bob',
          authorDisplayName: 'Bob',
          content: 'Message 2',
        }),
      ];

      const conversationHistory: ConversationMessage[] = [
        {
          id: 'conv-1',
          role: MessageRole.User,
          content: 'Previous',
          personaId: 'persona-1',
          personaName: 'Alicia',
          createdAt: new Date(),
          discordMessageId: [],
        },
        {
          id: 'conv-2',
          role: MessageRole.User,
          content: 'Previous',
          personaId: 'persona-2',
          personaName: 'Bobby',
          createdAt: new Date(),
          discordMessageId: [],
        },
      ];

      (redisService.getWebhookPersonality as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      mockUserService.getOrCreateUser
        .mockResolvedValueOnce('user-1')
        .mockResolvedValueOnce('user-2');
      // Override persona resolver to return different personas for each user
      mockPersonaResolver.resolve
        .mockResolvedValueOnce({
          config: {
            personaId: 'persona-1',
            preferredName: 'Alicia',
            pronouns: null,
            content: '',
            shareLtmAcrossPersonalities: false,
          },
          source: 'user-default',
        })
        .mockResolvedValueOnce({
          config: {
            personaId: 'persona-2',
            preferredName: 'Bobby',
            pronouns: null,
            content: '',
            shareLtmAcrossPersonalities: false,
          },
          source: 'user-default',
        });

      await service.enrichWithPersonaNames(references, conversationHistory, 'personality-123');

      expect(references[0].authorDisplayName).toBe('Alicia');
      expect(references[1].authorDisplayName).toBe('Bobby');
    });

    it('should keep original display name when persona name is null', async () => {
      const references: ReferencedMessage[] = [
        createReferencedMessage({
          discordMessageId: 'msg-123',
          discordUserId: 'user-123',
          authorUsername: 'john_doe',
          authorDisplayName: 'John Doe',
          content: 'Hello',
        }),
      ];

      (redisService.getWebhookPersonality as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      mockUserService.getOrCreateUser.mockResolvedValue('user-123');
      // PersonaResolver.resolve returns persona-123 by default (from beforeEach)
      mockUserService.getPersonaName.mockResolvedValue(null);

      await service.enrichWithPersonaNames(references, [], 'personality-123');

      // Should keep original display name
      expect(references[0].authorDisplayName).toBe('John Doe');
    });

    it('should handle errors gracefully and keep original display name', async () => {
      const references: ReferencedMessage[] = [
        createReferencedMessage({
          discordMessageId: 'msg-123',
          discordUserId: 'user-123',
          authorUsername: 'john_doe',
          authorDisplayName: 'John Doe',
          content: 'Hello',
        }),
      ];

      (redisService.getWebhookPersonality as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      mockUserService.getOrCreateUser.mockRejectedValue(new Error('Database error'));

      await service.enrichWithPersonaNames(references, [], 'personality-123');

      // Should keep original display name on error
      expect(references[0].authorDisplayName).toBe('John Doe');
    });

    it('should handle Redis lookup failures gracefully', async () => {
      const references: ReferencedMessage[] = [
        createReferencedMessage({
          discordMessageId: 'msg-123',
          discordUserId: 'user-123',
          authorUsername: 'john_doe',
          authorDisplayName: 'John Doe',
          webhookId: 'webhook-123', // Has webhookId, should still skip
          content: 'Hello',
        }),
      ];

      // Redis lookup fails, but webhookId detection should still work
      (redisService.getWebhookPersonality as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Redis down')
      );

      await service.enrichWithPersonaNames(references, [], 'personality-123');

      // Should still skip due to webhookId fallback
      expect(mockUserService.getOrCreateUser).not.toHaveBeenCalled();
      expect(references[0].authorDisplayName).toBe('John Doe');
    });

    it('should pass correct Discord display name to getOrCreateUser', async () => {
      const references: ReferencedMessage[] = [
        createReferencedMessage({
          discordMessageId: 'msg-123',
          discordUserId: 'user-123',
          authorUsername: 'john_doe',
          authorDisplayName: 'Server Nickname',
          content: 'Hello',
        }),
      ];

      (redisService.getWebhookPersonality as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      mockUserService.getOrCreateUser.mockResolvedValue('user-123');
      // PersonaResolver.resolve returns persona-123 by default (from beforeEach)
      mockUserService.getPersonaName.mockResolvedValue('Johnny');

      await service.enrichWithPersonaNames(references, [], 'personality-123');

      // Should pass the actual Discord display name (server nickname)
      expect(mockUserService.getOrCreateUser).toHaveBeenCalledWith(
        'user-123',
        'john_doe',
        'Server Nickname'
      );
    });

    it('should build persona name map only from messages with personaName', async () => {
      const references: ReferencedMessage[] = [
        createReferencedMessage({
          discordMessageId: 'msg-123',
          discordUserId: 'user-123',
          authorUsername: 'john_doe',
          authorDisplayName: 'John Doe',
          content: 'Hello',
        }),
      ];

      const conversationHistory: ConversationMessage[] = [
        {
          id: 'conv-1',
          role: MessageRole.User,
          content: 'Has persona',
          personaId: 'persona-1',
          personaName: 'Johnny',
          createdAt: new Date(),
          discordMessageId: [],
        },
        {
          id: 'conv-2',
          role: MessageRole.Assistant,
          content: 'No persona name',
          personaId: 'persona-2',
          personaName: undefined, // Missing persona name
          createdAt: new Date(),
          discordMessageId: [],
        },
      ];

      (redisService.getWebhookPersonality as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      mockUserService.getOrCreateUser.mockResolvedValue('user-123');
      // Override persona resolver to return persona-1 which is in the conversation history
      mockPersonaResolver.resolve.mockResolvedValue({
        config: {
          personaId: 'persona-1',
          preferredName: 'Johnny',
          pronouns: null,
          content: '',
          shareLtmAcrossPersonalities: false,
        },
        source: 'user-default',
      });

      await service.enrichWithPersonaNames(references, conversationHistory, 'personality-123');

      // Should use persona-1 from cache (which has personaName)
      expect(references[0].authorDisplayName).toBe('Johnny');
      expect(mockUserService.getPersonaName).not.toHaveBeenCalled();
    });
  });
});
