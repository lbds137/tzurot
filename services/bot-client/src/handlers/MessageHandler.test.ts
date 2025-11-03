/**
 * Tests for MessageHandler
 *
 * Tests the persona name enrichment for referenced messages
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageHandler } from './MessageHandler.js';
import type { ReferencedMessage, ConversationMessage } from '@tzurot/common-types';

// Mock dependencies
vi.mock('../gateway/GatewayClient.js');
vi.mock('../webhooks/WebhookManager.js');
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    ConversationHistoryService: vi.fn(),
    PersonalityService: vi.fn(),
    UserService: vi.fn(),
  };
});

describe('MessageHandler - enrichReferencesWithPersonaNames', () => {
  let messageHandler: MessageHandler;
  let mockUserService: any;
  let mockGatewayClient: any;
  let mockWebhookManager: any;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Create mock services
    mockUserService = {
      getOrCreateUser: vi.fn(),
      getPersonaForUser: vi.fn(),
      getPersonaName: vi.fn(),
    };

    mockGatewayClient = {};
    mockWebhookManager = {};

    // Create MessageHandler instance
    messageHandler = new MessageHandler(mockGatewayClient, mockWebhookManager);

    // Override the userService with our mock
    (messageHandler as any).userService = mockUserService;
  });

  describe('persona name lookup from conversation history', () => {
    it('should use persona names from conversation history when available', async () => {
      // Setup: Create referenced messages
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordUserId: 'user-123',
          authorUsername: 'testuser',
          authorDisplayName: 'Test User Discord Name',
          content: 'Hello world',
          embeds: '',
          timestamp: new Date().toISOString(),
          guildName: 'Test Guild',
          channelName: '#general',
        },
      ];

      // Setup: Create conversation history with persona info
      const history: ConversationMessage[] = [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Previous message',
          createdAt: new Date(),
          personaId: 'persona-123',
          personaName: 'Test Persona Name',
        },
      ];

      // Mock: UserService returns the persona ID that matches history
      mockUserService.getOrCreateUser.mockResolvedValue('user-uuid-123');
      mockUserService.getPersonaForUser.mockResolvedValue('persona-123');

      // Execute
      await (messageHandler as any).enrichReferencesWithPersonaNames(
        references,
        history,
        'personality-id'
      );

      // Verify: Should use persona name from history (no DB fetch needed)
      expect(references[0].authorDisplayName).toBe('Test Persona Name');
      expect(mockUserService.getPersonaName).not.toHaveBeenCalled();
    });

    it('should fetch from database when persona not in history', async () => {
      // Setup: Create referenced messages
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordUserId: 'user-456',
          authorUsername: 'otheruser',
          authorDisplayName: 'Other User Discord Name',
          content: 'Test message',
          embeds: '',
          timestamp: new Date().toISOString(),
          guildName: 'Test Guild',
          channelName: '#random',
        },
      ];

      // Setup: Conversation history with different persona
      const history: ConversationMessage[] = [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Previous message',
          createdAt: new Date(),
          personaId: 'persona-999',
          personaName: 'Different Persona',
        },
      ];

      // Mock: UserService returns persona not in history
      mockUserService.getOrCreateUser.mockResolvedValue('user-uuid-456');
      mockUserService.getPersonaForUser.mockResolvedValue('persona-456');
      mockUserService.getPersonaName.mockResolvedValue('Fetched Persona Name');

      // Execute
      await (messageHandler as any).enrichReferencesWithPersonaNames(
        references,
        history,
        'personality-id'
      );

      // Verify: Should fetch from database
      expect(references[0].authorDisplayName).toBe('Fetched Persona Name');
      expect(mockUserService.getPersonaName).toHaveBeenCalledWith('persona-456');
    });
  });

  describe('error handling', () => {
    it('should handle missing persona gracefully', async () => {
      // Setup: Create referenced messages
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordUserId: 'user-789',
          authorUsername: 'missinguser',
          authorDisplayName: 'Original Discord Name',
          content: 'Test',
          embeds: '',
          timestamp: new Date().toISOString(),
          guildName: 'Test Guild',
          channelName: '#test',
        },
      ];

      const history: ConversationMessage[] = [];

      // Mock: UserService returns null (persona doesn't exist)
      mockUserService.getOrCreateUser.mockResolvedValue('user-uuid-789');
      mockUserService.getPersonaForUser.mockResolvedValue('persona-789');
      mockUserService.getPersonaName.mockResolvedValue(null);

      // Execute
      await (messageHandler as any).enrichReferencesWithPersonaNames(
        references,
        history,
        'personality-id'
      );

      // Verify: Should keep original Discord display name
      expect(references[0].authorDisplayName).toBe('Original Discord Name');
    });

    it('should handle userService errors without throwing', async () => {
      // Setup: Create referenced messages
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordUserId: 'user-error',
          authorUsername: 'erroruser',
          authorDisplayName: 'Fallback Name',
          content: 'Test',
          embeds: '',
          timestamp: new Date().toISOString(),
          guildName: 'Test Guild',
          channelName: '#test',
        },
      ];

      const history: ConversationMessage[] = [];

      // Mock: UserService throws error
      mockUserService.getOrCreateUser.mockRejectedValue(new Error('Database error'));

      // Execute - should not throw
      await expect(
        (messageHandler as any).enrichReferencesWithPersonaNames(
          references,
          history,
          'personality-id'
        )
      ).resolves.not.toThrow();

      // Verify: Should preserve original display name on error
      expect(references[0].authorDisplayName).toBe('Fallback Name');
    });

    it('should preserve original display name on error', async () => {
      // Setup: Create referenced messages with specific display name
      const originalDisplayName = 'Important Display Name';
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordUserId: 'user-123',
          authorUsername: 'testuser',
          authorDisplayName: originalDisplayName,
          content: 'Test',
          embeds: '',
          timestamp: new Date().toISOString(),
          guildName: 'Test Guild',
          channelName: '#test',
        },
      ];

      const history: ConversationMessage[] = [];

      // Mock: Simulate error during persona lookup
      mockUserService.getOrCreateUser.mockResolvedValue('user-uuid-123');
      mockUserService.getPersonaForUser.mockRejectedValue(new Error('Lookup failed'));

      // Execute
      await (messageHandler as any).enrichReferencesWithPersonaNames(
        references,
        history,
        'personality-id'
      );

      // Verify: Original display name is preserved
      expect(references[0].authorDisplayName).toBe(originalDisplayName);
    });
  });

  describe('edge cases', () => {
    it('should handle empty referenced messages array', async () => {
      const references: ReferencedMessage[] = [];
      const history: ConversationMessage[] = [];

      // Execute - should not throw or make any service calls
      await expect(
        (messageHandler as any).enrichReferencesWithPersonaNames(
          references,
          history,
          'personality-id'
        )
      ).resolves.not.toThrow();

      expect(mockUserService.getOrCreateUser).not.toHaveBeenCalled();
    });

    it('should handle multiple references with different personas', async () => {
      // Setup: Create multiple referenced messages
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordUserId: 'user-1',
          authorUsername: 'user1',
          authorDisplayName: 'User 1 Discord',
          content: 'First message',
          embeds: '',
          timestamp: new Date().toISOString(),
          guildName: 'Test Guild',
          channelName: '#general',
        },
        {
          referenceNumber: 2,
          discordUserId: 'user-2',
          authorUsername: 'user2',
          authorDisplayName: 'User 2 Discord',
          content: 'Second message',
          embeds: '',
          timestamp: new Date().toISOString(),
          guildName: 'Test Guild',
          channelName: '#general',
        },
      ];

      // Setup: History with one persona
      const history: ConversationMessage[] = [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Previous',
          createdAt: new Date(),
          personaId: 'persona-1',
          personaName: 'Persona One',
        },
      ];

      // Mock: Different personas for each user
      mockUserService.getOrCreateUser
        .mockResolvedValueOnce('user-uuid-1')
        .mockResolvedValueOnce('user-uuid-2');

      mockUserService.getPersonaForUser
        .mockResolvedValueOnce('persona-1')  // First user - in history
        .mockResolvedValueOnce('persona-2'); // Second user - not in history

      mockUserService.getPersonaName.mockResolvedValueOnce('Persona Two');

      // Execute
      await (messageHandler as any).enrichReferencesWithPersonaNames(
        references,
        history,
        'personality-id'
      );

      // Verify: First uses history, second fetches from DB
      expect(references[0].authorDisplayName).toBe('Persona One');
      expect(references[1].authorDisplayName).toBe('Persona Two');
      expect(mockUserService.getPersonaName).toHaveBeenCalledTimes(1);
    });

    it('should handle conversation history without persona names', async () => {
      // Setup: Referenced message
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordUserId: 'user-123',
          authorUsername: 'testuser',
          authorDisplayName: 'Discord Name',
          content: 'Test',
          embeds: '',
          timestamp: new Date().toISOString(),
          guildName: 'Test Guild',
          channelName: '#test',
        },
      ];

      // Setup: History entry without personaName
      const history: ConversationMessage[] = [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Previous',
          createdAt: new Date(),
          personaId: 'persona-123',
          // personaName is undefined
        },
      ];

      // Mock
      mockUserService.getOrCreateUser.mockResolvedValue('user-uuid-123');
      mockUserService.getPersonaForUser.mockResolvedValue('persona-123');
      mockUserService.getPersonaName.mockResolvedValue('DB Persona Name');

      // Execute
      await (messageHandler as any).enrichReferencesWithPersonaNames(
        references,
        history,
        'personality-id'
      );

      // Verify: Should fetch from DB since history entry has no name
      expect(references[0].authorDisplayName).toBe('DB Persona Name');
      expect(mockUserService.getPersonaName).toHaveBeenCalledWith('persona-123');
    });
  });

  describe('UserService integration', () => {
    it('should call getOrCreateUser with correct parameters', async () => {
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordUserId: 'discord-123',
          authorUsername: 'testuser',
          authorDisplayName: 'Test Display',
          content: 'Test',
          embeds: '',
          timestamp: new Date().toISOString(),
          guildName: 'Guild',
          channelName: '#channel',
        },
      ];

      mockUserService.getOrCreateUser.mockResolvedValue('user-uuid');
      mockUserService.getPersonaForUser.mockResolvedValue('persona-id');
      mockUserService.getPersonaName.mockResolvedValue('Persona Name');

      await (messageHandler as any).enrichReferencesWithPersonaNames(
        references,
        [],
        'personality-123'
      );

      // Verify: getOrCreateUser called with discordUserId and username
      expect(mockUserService.getOrCreateUser).toHaveBeenCalledWith(
        'discord-123',
        'testuser',
        'testuser' // Falls back to username for display name
      );
    });

    it('should call getPersonaForUser with userId and personalityId', async () => {
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordUserId: 'discord-456',
          authorUsername: 'user',
          authorDisplayName: 'Display',
          content: 'Test',
          embeds: '',
          timestamp: new Date().toISOString(),
          guildName: 'Guild',
          channelName: '#channel',
        },
      ];

      mockUserService.getOrCreateUser.mockResolvedValue('user-uuid-456');
      mockUserService.getPersonaForUser.mockResolvedValue('persona-456');
      mockUserService.getPersonaName.mockResolvedValue('Persona');

      await (messageHandler as any).enrichReferencesWithPersonaNames(
        references,
        [],
        'personality-xyz'
      );

      // Verify: getPersonaForUser called with correct IDs
      expect(mockUserService.getPersonaForUser).toHaveBeenCalledWith(
        'user-uuid-456',
        'personality-xyz'
      );
    });
  });
});
