/**
 * ReferenceEnrichmentService Unit Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReferenceEnrichmentService } from './ReferenceEnrichmentService.js';
import type { ConversationMessage, ReferencedMessage } from '@tzurot/common-types';

// Mock dependencies
vi.mock('../redis.js', () => ({
  getWebhookPersonality: vi.fn(),
}));

vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    UserService: vi.fn(),
  };
});

import { getWebhookPersonality } from '../redis.js';

describe('ReferenceEnrichmentService', () => {
  let service: ReferenceEnrichmentService;
  let mockUserService: {
    getOrCreateUser: ReturnType<typeof vi.fn>;
    getPersonaForUser: ReturnType<typeof vi.fn>;
    getPersonaName: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockUserService = {
      getOrCreateUser: vi.fn(),
      getPersonaForUser: vi.fn(),
      getPersonaName: vi.fn(),
    };

    service = new ReferenceEnrichmentService(mockUserService as any);
  });

  describe('enrichWithPersonaNames', () => {
    it('should do nothing when no references provided', async () => {
      await service.enrichWithPersonaNames([], [], 'personality-123');

      expect(mockUserService.getOrCreateUser).not.toHaveBeenCalled();
    });

    it('should enrich reference with persona name from conversation history', async () => {
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-123',
          discordUserId: 'user-123',
          authorUsername: 'john_doe',
          authorDisplayName: 'John Doe',
          webhookId: null,
          content: 'Hello',
        },
      ];

      const conversationHistory: ConversationMessage[] = [
        {
          id: 'conv-1',
          role: 'user',
          content: 'Previous message',
          personaId: 'persona-123',
          personaName: 'Johnny',
          timestamp: new Date(),
        },
      ];

      (getWebhookPersonality as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      mockUserService.getOrCreateUser.mockResolvedValue('user-123');
      mockUserService.getPersonaForUser.mockResolvedValue('persona-123');

      await service.enrichWithPersonaNames(references, conversationHistory, 'personality-123');

      // Should use cached persona name from conversation history
      expect(references[0].authorDisplayName).toBe('Johnny');
      expect(mockUserService.getPersonaName).not.toHaveBeenCalled(); // Should not hit database
    });

    it('should enrich reference with persona name from database when not in history', async () => {
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-123',
          discordUserId: 'user-123',
          authorUsername: 'john_doe',
          authorDisplayName: 'John Doe',
          webhookId: null,
          content: 'Hello',
        },
      ];

      const conversationHistory: ConversationMessage[] = []; // Empty history

      (getWebhookPersonality as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      mockUserService.getOrCreateUser.mockResolvedValue('user-123');
      mockUserService.getPersonaForUser.mockResolvedValue('persona-456');
      mockUserService.getPersonaName.mockResolvedValue('Database Johnny');

      await service.enrichWithPersonaNames(references, conversationHistory, 'personality-123');

      // Should fetch from database
      expect(mockUserService.getPersonaName).toHaveBeenCalledWith('persona-456');
      expect(references[0].authorDisplayName).toBe('Database Johnny');
    });

    it('should skip webhook messages detected via Redis', async () => {
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-webhook',
          discordUserId: 'user-123',
          authorUsername: 'bot_webhook',
          authorDisplayName: 'Bot Personality',
          webhookId: null,
          content: 'AI response',
        },
      ];

      (getWebhookPersonality as ReturnType<typeof vi.fn>).mockResolvedValue({
        personalityId: 'personality-bot',
      });

      await service.enrichWithPersonaNames(references, [], 'personality-123');

      // Should not attempt to enrich
      expect(mockUserService.getOrCreateUser).not.toHaveBeenCalled();
      expect(references[0].authorDisplayName).toBe('Bot Personality'); // Unchanged
    });

    it('should skip webhook messages detected via webhookId', async () => {
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-webhook',
          discordUserId: 'user-123',
          authorUsername: 'pluralkit',
          authorDisplayName: 'PluralKit User',
          webhookId: 'webhook-456', // Discord webhookId present
          content: 'Message from PluralKit',
        },
      ];

      (getWebhookPersonality as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await service.enrichWithPersonaNames(references, [], 'personality-123');

      // Should not attempt to enrich
      expect(mockUserService.getOrCreateUser).not.toHaveBeenCalled();
      expect(references[0].authorDisplayName).toBe('PluralKit User'); // Unchanged
    });

    it('should handle multiple references in one call', async () => {
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-1',
          discordUserId: 'user-1',
          authorUsername: 'alice',
          authorDisplayName: 'Alice',
          webhookId: null,
          content: 'Message 1',
        },
        {
          referenceNumber: 2,
          discordMessageId: 'msg-2',
          discordUserId: 'user-2',
          authorUsername: 'bob',
          authorDisplayName: 'Bob',
          webhookId: null,
          content: 'Message 2',
        },
      ];

      const conversationHistory: ConversationMessage[] = [
        {
          id: 'conv-1',
          role: 'user',
          content: 'Previous',
          personaId: 'persona-1',
          personaName: 'Alicia',
          timestamp: new Date(),
        },
        {
          id: 'conv-2',
          role: 'user',
          content: 'Previous',
          personaId: 'persona-2',
          personaName: 'Bobby',
          timestamp: new Date(),
        },
      ];

      (getWebhookPersonality as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      mockUserService.getOrCreateUser
        .mockResolvedValueOnce('user-1')
        .mockResolvedValueOnce('user-2');
      mockUserService.getPersonaForUser
        .mockResolvedValueOnce('persona-1')
        .mockResolvedValueOnce('persona-2');

      await service.enrichWithPersonaNames(references, conversationHistory, 'personality-123');

      expect(references[0].authorDisplayName).toBe('Alicia');
      expect(references[1].authorDisplayName).toBe('Bobby');
    });

    it('should keep original display name when persona name is null', async () => {
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-123',
          discordUserId: 'user-123',
          authorUsername: 'john_doe',
          authorDisplayName: 'John Doe',
          webhookId: null,
          content: 'Hello',
        },
      ];

      (getWebhookPersonality as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      mockUserService.getOrCreateUser.mockResolvedValue('user-123');
      mockUserService.getPersonaForUser.mockResolvedValue('persona-123');
      mockUserService.getPersonaName.mockResolvedValue(null);

      await service.enrichWithPersonaNames(references, [], 'personality-123');

      // Should keep original display name
      expect(references[0].authorDisplayName).toBe('John Doe');
    });

    it('should handle errors gracefully and keep original display name', async () => {
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-123',
          discordUserId: 'user-123',
          authorUsername: 'john_doe',
          authorDisplayName: 'John Doe',
          webhookId: null,
          content: 'Hello',
        },
      ];

      (getWebhookPersonality as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      mockUserService.getOrCreateUser.mockRejectedValue(new Error('Database error'));

      await service.enrichWithPersonaNames(references, [], 'personality-123');

      // Should keep original display name on error
      expect(references[0].authorDisplayName).toBe('John Doe');
    });

    it('should handle Redis lookup failures gracefully', async () => {
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-123',
          discordUserId: 'user-123',
          authorUsername: 'john_doe',
          authorDisplayName: 'John Doe',
          webhookId: 'webhook-123', // Has webhookId, should still skip
          content: 'Hello',
        },
      ];

      // Redis lookup fails, but webhookId detection should still work
      (getWebhookPersonality as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Redis down')
      );

      await service.enrichWithPersonaNames(references, [], 'personality-123');

      // Should still skip due to webhookId fallback
      expect(mockUserService.getOrCreateUser).not.toHaveBeenCalled();
      expect(references[0].authorDisplayName).toBe('John Doe');
    });

    it('should pass correct Discord display name to getOrCreateUser', async () => {
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg-123',
          discordUserId: 'user-123',
          authorUsername: 'john_doe',
          authorDisplayName: 'Server Nickname',
          webhookId: null,
          content: 'Hello',
        },
      ];

      (getWebhookPersonality as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      mockUserService.getOrCreateUser.mockResolvedValue('user-123');
      mockUserService.getPersonaForUser.mockResolvedValue('persona-123');
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
        {
          referenceNumber: 1,
          discordMessageId: 'msg-123',
          discordUserId: 'user-123',
          authorUsername: 'john_doe',
          authorDisplayName: 'John Doe',
          webhookId: null,
          content: 'Hello',
        },
      ];

      const conversationHistory: ConversationMessage[] = [
        {
          id: 'conv-1',
          role: 'user',
          content: 'Has persona',
          personaId: 'persona-1',
          personaName: 'Johnny',
          timestamp: new Date(),
        },
        {
          id: 'conv-2',
          role: 'assistant',
          content: 'No persona name',
          personaId: 'persona-2',
          personaName: undefined, // Missing persona name
          timestamp: new Date(),
        },
      ];

      (getWebhookPersonality as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      mockUserService.getOrCreateUser.mockResolvedValue('user-123');
      mockUserService.getPersonaForUser.mockResolvedValue('persona-1');

      await service.enrichWithPersonaNames(references, conversationHistory, 'personality-123');

      // Should use persona-1 from cache (which has personaName)
      expect(references[0].authorDisplayName).toBe('Johnny');
      expect(mockUserService.getPersonaName).not.toHaveBeenCalled();
    });
  });
});
