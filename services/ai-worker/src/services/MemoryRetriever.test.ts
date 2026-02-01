/**
 * Tests for Memory Retriever
 *
 * Note: MemoryRetriever now delegates persona resolution to PersonaResolver.
 * These tests mock PersonaResolver to test MemoryRetriever's own logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRetriever } from './MemoryRetriever.js';
import type { PgvectorMemoryAdapter } from './PgvectorMemoryAdapter.js';
import type { LoadedPersonality } from '@tzurot/common-types';
import type { ConversationContext } from './ConversationalRAGService.js';
import type { PersonaResolver } from './resolvers/index.js';

// Mock PersonaResolver
const mockPersonaResolver = {
  resolveForMemory: vi.fn(),
  getPersonaForPrompt: vi.fn(),
  getPersonaContentForPrompt: vi.fn(),
  resolveToUuid: vi.fn(),
};

// Mock getPrismaClient (still needed for PersonaResolver's default construction)
const mockPrismaClient = {};

vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    getPrismaClient: vi.fn(() => mockPrismaClient),
  };
});

// Mock PersonaResolver constructor
vi.mock('./resolvers/index.js', () => ({
  PersonaResolver: vi.fn().mockImplementation(() => mockPersonaResolver),
}));

describe('MemoryRetriever', () => {
  let retriever: MemoryRetriever;
  let mockMemoryManager: PgvectorMemoryAdapter;

  const mockPersonality: LoadedPersonality = {
    id: 'personality-123',
    name: 'TestBot',
    displayName: 'Test Bot',
    slug: 'testbot',
    systemPrompt: 'You are a test bot',
    model: 'test-model',
    temperature: 0.7,
    maxTokens: 4096,
    memoryLimit: 15,
    memoryScoreThreshold: 0.7,
    contextWindowTokens: 131072,
    characterInfo: '',
    personalityTraits: '',
    personalityTone: undefined,
    personalityAge: undefined,
    personalityAppearance: undefined,
    personalityLikes: undefined,
    personalityDislikes: undefined,
    conversationalGoals: undefined,
    conversationalExamples: undefined,
  };

  beforeEach(() => {
    mockMemoryManager = {
      queryMemories: vi.fn().mockResolvedValue([]),
      queryMemoriesWithChannelScoping: vi.fn().mockResolvedValue([]),
      addMemory: vi.fn().mockResolvedValue(undefined),
    } as any;

    // Inject mock PersonaResolver via constructor
    retriever = new MemoryRetriever(
      mockMemoryManager,
      mockPersonaResolver as unknown as PersonaResolver
    );
    vi.clearAllMocks();
  });

  describe('resolvePersonaForMemory', () => {
    // Tests that delegation to PersonaResolver works correctly

    it('should delegate to PersonaResolver.resolveForMemory', async () => {
      mockPersonaResolver.resolveForMemory.mockResolvedValue({
        personaId: 'persona-123',
        shareLtmAcrossPersonalities: false,
        focusModeEnabled: false,
      });

      const result = await retriever.resolvePersonaForMemory('discord-123', 'personality-123');

      expect(mockPersonaResolver.resolveForMemory).toHaveBeenCalledWith(
        'discord-123',
        'personality-123'
      );
      expect(result).toEqual({
        personaId: 'persona-123',
        shareLtmAcrossPersonalities: false,
        focusModeEnabled: false,
      });
    });

    it('should return null when PersonaResolver returns null', async () => {
      mockPersonaResolver.resolveForMemory.mockResolvedValue(null);

      const result = await retriever.resolvePersonaForMemory('discord-123', 'personality-123');

      expect(result).toBeNull();
    });
  });

  describe('getPersonaContent', () => {
    it('should delegate to PersonaResolver.getPersonaContentForPrompt', async () => {
      mockPersonaResolver.getPersonaContentForPrompt.mockResolvedValue(
        'Name: Alice\nPronouns: she/her\nA friendly person who loves coding'
      );

      const result = await retriever.getPersonaContent('persona-123');

      expect(mockPersonaResolver.getPersonaContentForPrompt).toHaveBeenCalledWith('persona-123');
      expect(result).toBe('Name: Alice\nPronouns: she/her\nA friendly person who loves coding');
    });

    it('should return null when PersonaResolver returns null', async () => {
      mockPersonaResolver.getPersonaContentForPrompt.mockResolvedValue(null);

      const result = await retriever.getPersonaContent('persona-123');

      expect(result).toBeNull();
    });
  });

  describe('getAllParticipantPersonas', () => {
    const testPersonalityId = 'personality-123';

    beforeEach(() => {
      // Default: resolveToUuid returns the input for UUIDs, null for unknown formats
      mockPersonaResolver.resolveToUuid.mockImplementation((personaId: string) => {
        // UUID pattern
        if (/^[0-9a-f-]{36}$/i.test(personaId) || personaId.startsWith('persona-')) {
          return Promise.resolve(personaId);
        }
        return Promise.resolve(null);
      });
    });

    it('should return empty map if no participants provided', async () => {
      const context: ConversationContext = {
        userId: 'user-123',
        participants: [],
      };

      const result = await retriever.getAllParticipantPersonas(context, testPersonalityId);

      expect(result.size).toBe(0);
    });

    it('should return empty map if participants is undefined', async () => {
      const context: ConversationContext = {
        userId: 'user-123',
      };

      const result = await retriever.getAllParticipantPersonas(context, testPersonalityId);

      expect(result.size).toBe(0);
    });

    it('should fetch content for each participant with UUID personaIds', async () => {
      mockPersonaResolver.resolveToUuid
        .mockResolvedValueOnce('persona-1')
        .mockResolvedValueOnce('persona-2');
      mockPersonaResolver.getPersonaForPrompt
        .mockResolvedValueOnce({
          preferredName: null,
          pronouns: null,
          content: 'Persona 1 content',
        })
        .mockResolvedValueOnce({
          preferredName: null,
          pronouns: null,
          content: 'Persona 2 content',
        });

      const context: ConversationContext = {
        userId: 'user-123',
        participants: [
          { personaId: 'persona-1', personaName: 'User One', isActive: true },
          { personaId: 'persona-2', personaName: 'User Two', isActive: false },
        ],
      };

      const result = await retriever.getAllParticipantPersonas(context, testPersonalityId);

      expect(result.size).toBe(2);
      expect(result.get('User One')).toEqual({
        content: 'Persona 1 content',
        isActive: true,
        personaId: 'persona-1',
      });
      expect(result.get('User Two')).toEqual({
        content: 'Persona 2 content',
        isActive: false,
        personaId: 'persona-2',
      });
    });

    it('should resolve discord: format personaIds to UUIDs', async () => {
      // Simulate resolving discord:123456789 to actual persona UUID
      mockPersonaResolver.resolveToUuid
        .mockResolvedValueOnce('resolved-uuid-1')
        .mockResolvedValueOnce('resolved-uuid-2');
      mockPersonaResolver.getPersonaForPrompt
        .mockResolvedValueOnce({ preferredName: null, pronouns: null, content: 'Grace content' })
        .mockResolvedValueOnce({
          preferredName: null,
          pronouns: null,
          content: 'Other user content',
        });

      const context: ConversationContext = {
        userId: 'user-123',
        participants: [
          { personaId: 'discord:123456789', personaName: 'Grace', isActive: true },
          { personaId: 'discord:987654321', personaName: 'Other User', isActive: false },
        ],
        participantGuildInfo: {
          'discord:987654321': { roles: ['Member'] },
        },
      };

      const result = await retriever.getAllParticipantPersonas(context, testPersonalityId);

      expect(mockPersonaResolver.resolveToUuid).toHaveBeenCalledWith(
        'discord:123456789',
        testPersonalityId
      );
      expect(mockPersonaResolver.resolveToUuid).toHaveBeenCalledWith(
        'discord:987654321',
        testPersonalityId
      );
      expect(result.size).toBe(2);
      // PersonaId should be the resolved UUID, not the discord: format
      expect(result.get('Grace')?.personaId).toBe('resolved-uuid-1');
      expect(result.get('Other User')?.personaId).toBe('resolved-uuid-2');
      // participantGuildInfo is keyed by original personaId
      expect(result.get('Other User')?.guildInfo).toEqual({ roles: ['Member'] });
    });

    it('should skip participants with unresolvable discord: IDs (not registered)', async () => {
      mockPersonaResolver.resolveToUuid
        .mockResolvedValueOnce('resolved-uuid') // First user is registered
        .mockResolvedValueOnce(null); // Second user is NOT registered
      mockPersonaResolver.getPersonaForPrompt.mockResolvedValueOnce({
        preferredName: null,
        pronouns: null,
        content: 'Registered user content',
      });

      const context: ConversationContext = {
        userId: 'user-123',
        participants: [
          { personaId: 'discord:111111111', personaName: 'Registered User', isActive: true },
          { personaId: 'discord:222222222', personaName: 'Unregistered User', isActive: false },
        ],
      };

      const result = await retriever.getAllParticipantPersonas(context, testPersonalityId);

      expect(result.size).toBe(1);
      expect(result.has('Registered User')).toBe(true);
      expect(result.has('Unregistered User')).toBe(false);
    });

    it('should skip participants with no content', async () => {
      mockPersonaResolver.resolveToUuid
        .mockResolvedValueOnce('persona-1')
        .mockResolvedValueOnce('persona-2');
      mockPersonaResolver.getPersonaForPrompt
        .mockResolvedValueOnce({ preferredName: null, pronouns: null, content: 'Has content' })
        .mockResolvedValueOnce(null);

      const context: ConversationContext = {
        userId: 'user-123',
        participants: [
          { personaId: 'persona-1', personaName: 'Has Content', isActive: true },
          { personaId: 'persona-2', personaName: 'No Content', isActive: false },
        ],
      };

      const result = await retriever.getAllParticipantPersonas(context, testPersonalityId);

      expect(result.size).toBe(1);
      expect(result.get('Has Content')).toEqual({
        content: 'Has content',
        isActive: true,
        personaId: 'persona-1',
      });
      expect(result.has('No Content')).toBe(false);
    });

    it('should apply activePersonaGuildInfo to active participant', async () => {
      mockPersonaResolver.resolveToUuid.mockResolvedValueOnce('persona-1');
      mockPersonaResolver.getPersonaForPrompt.mockResolvedValueOnce({
        preferredName: 'User',
        pronouns: 'they/them',
        content: 'Persona content',
      });

      const context: ConversationContext = {
        userId: 'user-123',
        participants: [{ personaId: 'persona-1', personaName: 'User One', isActive: true }],
        activePersonaGuildInfo: {
          roles: ['Admin', 'Moderator'],
          displayColor: '#FF0000',
          joinedAt: '2023-06-15T10:00:00.000Z',
        },
      };

      const result = await retriever.getAllParticipantPersonas(context, testPersonalityId);

      expect(result.size).toBe(1);
      expect(result.get('User One')).toEqual({
        preferredName: 'User',
        pronouns: 'they/them',
        content: 'Persona content',
        isActive: true,
        personaId: 'persona-1',
        guildInfo: {
          roles: ['Admin', 'Moderator'],
          displayColor: '#FF0000',
          joinedAt: '2023-06-15T10:00:00.000Z',
        },
      });
    });

    it('should apply participantGuildInfo to non-active participants', async () => {
      mockPersonaResolver.resolveToUuid
        .mockResolvedValueOnce('resolved-uuid-1')
        .mockResolvedValueOnce('resolved-uuid-2');
      mockPersonaResolver.getPersonaForPrompt
        .mockResolvedValueOnce({
          preferredName: null,
          pronouns: null,
          content: 'Active user content',
        })
        .mockResolvedValueOnce({
          preferredName: null,
          pronouns: null,
          content: 'Inactive user content',
        });

      const context: ConversationContext = {
        userId: 'user-123',
        participants: [
          { personaId: 'discord:user1', personaName: 'Active User', isActive: true },
          { personaId: 'discord:user2', personaName: 'Inactive User', isActive: false },
        ],
        activePersonaGuildInfo: {
          roles: ['Admin'],
          displayColor: '#FF0000',
        },
        participantGuildInfo: {
          'discord:user2': {
            roles: ['Member'],
            displayColor: '#00FF00',
          },
        },
      };

      const result = await retriever.getAllParticipantPersonas(context, testPersonalityId);

      expect(result.size).toBe(2);
      // Active user gets activePersonaGuildInfo
      expect(result.get('Active User')?.guildInfo).toEqual({
        roles: ['Admin'],
        displayColor: '#FF0000',
      });
      // Inactive user gets info from participantGuildInfo (keyed by original personaId)
      expect(result.get('Inactive User')?.guildInfo).toEqual({
        roles: ['Member'],
        displayColor: '#00FF00',
      });
    });

    it('should return undefined guildInfo for inactive participants not in participantGuildInfo', async () => {
      mockPersonaResolver.resolveToUuid
        .mockResolvedValueOnce('resolved-uuid-1')
        .mockResolvedValueOnce('db-persona-uuid');
      mockPersonaResolver.getPersonaForPrompt
        .mockResolvedValueOnce({
          preferredName: null,
          pronouns: null,
          content: 'Active user content',
        })
        .mockResolvedValueOnce({
          preferredName: null,
          pronouns: null,
          content: 'Inactive user content',
        });

      const context: ConversationContext = {
        userId: 'user-123',
        participants: [
          { personaId: 'discord:user1', personaName: 'Active User', isActive: true },
          { personaId: 'db-persona-uuid', personaName: 'DB History User', isActive: false },
        ],
        activePersonaGuildInfo: {
          roles: ['Admin'],
        },
        participantGuildInfo: {
          // Only discord:user3 has info, not db-persona-uuid
          'discord:user3': { roles: ['VIP'] },
        },
      };

      const result = await retriever.getAllParticipantPersonas(context, testPersonalityId);

      expect(result.size).toBe(2);
      expect(result.get('Active User')?.guildInfo).toBeDefined();
      // DB history user has no guild info (not from extended context)
      expect(result.get('DB History User')?.guildInfo).toBeUndefined();
    });

    it('should handle missing participantGuildInfo gracefully', async () => {
      mockPersonaResolver.resolveToUuid
        .mockResolvedValueOnce('resolved-uuid-1')
        .mockResolvedValueOnce('resolved-uuid-2');
      mockPersonaResolver.getPersonaForPrompt
        .mockResolvedValueOnce({
          preferredName: null,
          pronouns: null,
          content: 'Active user content',
        })
        .mockResolvedValueOnce({
          preferredName: null,
          pronouns: null,
          content: 'Inactive user content',
        });

      const context: ConversationContext = {
        userId: 'user-123',
        participants: [
          { personaId: 'discord:user1', personaName: 'Active User', isActive: true },
          { personaId: 'discord:user2', personaName: 'Inactive User', isActive: false },
        ],
        activePersonaGuildInfo: { roles: ['Admin'] },
        // No participantGuildInfo provided
      };

      const result = await retriever.getAllParticipantPersonas(context, testPersonalityId);

      expect(result.size).toBe(2);
      expect(result.get('Active User')?.guildInfo).toEqual({ roles: ['Admin'] });
      expect(result.get('Inactive User')?.guildInfo).toBeUndefined();
    });
  });

  describe('retrieveRelevantMemories', () => {
    const context: ConversationContext = {
      userId: 'discord-user-123',
    };

    it('should return empty array if persona not found', async () => {
      mockPersonaResolver.resolveForMemory.mockResolvedValue(null);

      const result = await retriever.retrieveRelevantMemories(
        mockPersonality,
        'test query',
        context
      );

      expect(result).toEqual({ memories: [], focusModeEnabled: false });
      expect(mockMemoryManager.queryMemories).not.toHaveBeenCalled();
    });

    it('should return empty array when focus mode is enabled', async () => {
      mockPersonaResolver.resolveForMemory.mockResolvedValue({
        personaId: 'persona-123',
        shareLtmAcrossPersonalities: false,
        focusModeEnabled: true, // Focus mode enabled!
      });

      const result = await retriever.retrieveRelevantMemories(
        mockPersonality,
        'test query',
        context
      );

      expect(result).toEqual({ memories: [], focusModeEnabled: true });
      // Should NOT query memories when focus mode is on
      expect(mockMemoryManager.queryMemories).not.toHaveBeenCalled();
    });

    it('should query memories normally when focus mode is disabled', async () => {
      mockPersonaResolver.resolveForMemory.mockResolvedValue({
        personaId: 'persona-123',
        shareLtmAcrossPersonalities: false,
        focusModeEnabled: false, // Focus mode disabled
      });

      const mockMemories = [{ pageContent: 'Memory content', metadata: { id: 'mem-1' } }];
      (mockMemoryManager.queryMemories as any).mockResolvedValue(mockMemories);

      const result = await retriever.retrieveRelevantMemories(
        mockPersonality,
        'test query',
        context
      );

      expect(result).toEqual({ memories: mockMemories, focusModeEnabled: false });
      // Should query memories when focus mode is off
      expect(mockMemoryManager.queryMemories).toHaveBeenCalled();
    });

    it('should return empty array if memory manager not available', async () => {
      const retrieverWithoutMemory = new MemoryRetriever(
        undefined,
        mockPersonaResolver as unknown as PersonaResolver
      );

      mockPersonaResolver.resolveForMemory.mockResolvedValue({
        personaId: 'persona-123',
        shareLtmAcrossPersonalities: false,
        focusModeEnabled: false,
      });

      const result = await retrieverWithoutMemory.retrieveRelevantMemories(
        mockPersonality,
        'test query',
        context
      );

      expect(result).toEqual({ memories: [], focusModeEnabled: false });
    });

    it('should query memories with correct parameters', async () => {
      mockPersonaResolver.resolveForMemory.mockResolvedValue({
        personaId: 'persona-123',
        shareLtmAcrossPersonalities: false,
        focusModeEnabled: false,
      });

      const mockMemories = [
        {
          pageContent: 'User likes pizza',
          metadata: {
            id: 'mem-1',
            createdAt: Date.now() - 86400000,
            score: 0.85,
          },
        },
        {
          pageContent: 'User prefers tea over coffee',
          metadata: {
            id: 'mem-2',
            createdAt: Date.now() - 172800000,
            score: 0.75,
          },
        },
      ];

      (mockMemoryManager.queryMemories as any).mockResolvedValue(mockMemories);

      const result = await retriever.retrieveRelevantMemories(
        mockPersonality,
        'What food do I like?',
        context
      );

      expect(result).toEqual({ memories: mockMemories, focusModeEnabled: false });
      expect(mockMemoryManager.queryMemories).toHaveBeenCalledWith('What food do I like?', {
        personaId: 'persona-123',
        personalityId: 'personality-123',
        sessionId: undefined,
        limit: 15,
        scoreThreshold: 0.7,
        excludeNewerThan: undefined,
      });
    });

    it('should apply STM/LTM deduplication buffer', async () => {
      mockPersonaResolver.resolveForMemory.mockResolvedValue({
        personaId: 'persona-123',
        shareLtmAcrossPersonalities: false,
        focusModeEnabled: false,
      });

      const oldestTimestamp = Date.now() - 3600000; // 1 hour ago
      const contextWithHistory: ConversationContext = {
        ...context,
        oldestHistoryTimestamp: oldestTimestamp,
      };

      await retriever.retrieveRelevantMemories(mockPersonality, 'test', contextWithHistory);

      // Should exclude memories newer than (oldestTimestamp - buffer)
      // Buffer is 10000ms (10 seconds) based on AI_DEFAULTS.STM_LTM_BUFFER_MS
      expect(mockMemoryManager.queryMemories).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({
          excludeNewerThan: oldestTimestamp - 10000,
        })
      );
    });

    it('should use session context if provided', async () => {
      mockPersonaResolver.resolveForMemory.mockResolvedValue({
        personaId: 'persona-123',
        shareLtmAcrossPersonalities: false,
        focusModeEnabled: false,
      });

      const contextWithSession: ConversationContext = {
        ...context,
        sessionId: 'session-789',
      };

      await retriever.retrieveRelevantMemories(mockPersonality, 'test', contextWithSession);

      expect(mockMemoryManager.queryMemories).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({
          sessionId: 'session-789',
        })
      );
    });

    it('should exclude personalityId when shareLtmAcrossPersonalities is true', async () => {
      mockPersonaResolver.resolveForMemory.mockResolvedValue({
        personaId: 'persona-123',
        shareLtmAcrossPersonalities: true,
        focusModeEnabled: false,
      });

      await retriever.retrieveRelevantMemories(mockPersonality, 'test', context);

      expect(mockMemoryManager.queryMemories).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({
          personaId: 'persona-123',
          personalityId: undefined, // Not filtered by personality when sharing
        })
      );
    });

    it('should use channel-scoped retrieval when channels are referenced', async () => {
      mockPersonaResolver.resolveForMemory.mockResolvedValue({
        personaId: 'persona-123',
        shareLtmAcrossPersonalities: false,
        focusModeEnabled: false,
      });

      const contextWithChannels: ConversationContext = {
        ...context,
        referencedChannels: [
          { channelId: 'channel-1', channelName: '#general' },
          { channelId: 'channel-2', channelName: '#random' },
        ],
      };

      await retriever.retrieveRelevantMemories(mockPersonality, 'test', contextWithChannels);

      expect(mockMemoryManager.queryMemoriesWithChannelScoping).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({
          channelIds: ['channel-1', 'channel-2'],
        })
      );
      expect(mockMemoryManager.queryMemories).not.toHaveBeenCalled();
    });
  });
});
