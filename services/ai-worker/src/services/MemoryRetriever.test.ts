/**
 * Tests for Memory Retriever
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRetriever } from './MemoryRetriever.js';
import type { PgvectorMemoryAdapter } from './PgvectorMemoryAdapter.js';
import type { LoadedPersonality } from '@tzurot/common-types';
import type { ConversationContext } from './ConversationalRAGService.js';

// Mock getPrismaClient
const mockPrismaClient = {
  persona: {
    findUnique: vi.fn(),
  },
  userPersonalityConfig: {
    findFirst: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
  },
};

vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    getPrismaClient: vi.fn(() => mockPrismaClient),
  };
});

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
      addMemory: vi.fn().mockResolvedValue(undefined),
    } as any;

    retriever = new MemoryRetriever(mockMemoryManager);
    vi.clearAllMocks();
  });

  describe('getUserPersonaForPersonality', () => {
    // Note: The function receives Discord ID (snowflake) and must first look up
    // the internal user UUID before querying userPersonalityConfig

    it('should return personality-specific persona override if exists', async () => {
      // First lookup returns user with internal UUID
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'internal-uuid-123',
        defaultPersonaLink: null,
      });
      mockPrismaClient.userPersonalityConfig.findFirst.mockResolvedValue({
        personaId: 'override-persona-123',
      });

      const result = await retriever.getUserPersonaForPersonality(
        'discord-id-123',
        'personality-123'
      );

      expect(result).toBe('override-persona-123');
      // Verify user lookup by Discord ID
      expect(mockPrismaClient.user.findUnique).toHaveBeenCalledWith({
        where: { discordId: 'discord-id-123' },
        select: {
          id: true,
          defaultPersonaLink: {
            select: { personaId: true },
          },
        },
      });
      // Verify config lookup uses internal UUID, not Discord ID
      expect(mockPrismaClient.userPersonalityConfig.findFirst).toHaveBeenCalledWith({
        where: {
          userId: 'internal-uuid-123', // Internal UUID, not Discord ID
          personalityId: 'personality-123',
          personaId: { not: null },
        },
        select: { personaId: true },
      });
    });

    it('should fall back to default persona if no override exists', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'internal-uuid-123',
        defaultPersonaLink: {
          personaId: 'default-persona-456',
        },
      });
      mockPrismaClient.userPersonalityConfig.findFirst.mockResolvedValue(null);

      const result = await retriever.getUserPersonaForPersonality(
        'discord-id-123',
        'personality-123'
      );

      expect(result).toBe('default-persona-456');
    });

    it('should return null if user not found by Discord ID', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue(null);

      const result = await retriever.getUserPersonaForPersonality(
        'unknown-discord-id',
        'personality-123'
      );

      expect(result).toBeNull();
      // Should not attempt to query userPersonalityConfig if user not found
      expect(mockPrismaClient.userPersonalityConfig.findFirst).not.toHaveBeenCalled();
    });

    it('should return null if no persona found', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'internal-uuid-123',
        defaultPersonaLink: null,
      });
      mockPrismaClient.userPersonalityConfig.findFirst.mockResolvedValue(null);

      const result = await retriever.getUserPersonaForPersonality(
        'discord-id-123',
        'personality-123'
      );

      expect(result).toBeNull();
    });

    it('should return null on database error', async () => {
      mockPrismaClient.user.findUnique.mockRejectedValue(
        new Error('Database connection failed')
      );

      const result = await retriever.getUserPersonaForPersonality(
        'discord-id-123',
        'personality-123'
      );

      expect(result).toBeNull();
    });
  });

  describe('getPersonaContent', () => {
    it('should return formatted persona content with all fields', async () => {
      mockPrismaClient.persona.findUnique.mockResolvedValue({
        preferredName: 'Alice',
        pronouns: 'she/her',
        content: 'A friendly person who loves coding',
      });

      const result = await retriever.getPersonaContent('persona-123');

      expect(result).toBe('Name: Alice\nPronouns: she/her\nA friendly person who loves coding');
    });

    it('should return content without optional fields', async () => {
      mockPrismaClient.persona.findUnique.mockResolvedValue({
        preferredName: null,
        pronouns: null,
        content: 'Just a person',
      });

      const result = await retriever.getPersonaContent('persona-123');

      expect(result).toBe('Just a person');
    });

    it('should return null if persona not found', async () => {
      mockPrismaClient.persona.findUnique.mockResolvedValue(null);

      const result = await retriever.getPersonaContent('persona-123');

      expect(result).toBeNull();
    });

    it('should return null if all fields are empty', async () => {
      mockPrismaClient.persona.findUnique.mockResolvedValue({
        preferredName: null,
        pronouns: null,
        content: null,
      });

      const result = await retriever.getPersonaContent('persona-123');

      expect(result).toBeNull();
    });

    it('should return null on database error', async () => {
      mockPrismaClient.persona.findUnique.mockRejectedValue(new Error('DB error'));

      const result = await retriever.getPersonaContent('persona-123');

      expect(result).toBeNull();
    });
  });

  describe('getAllParticipantPersonas', () => {
    it('should return empty map if no participants provided', async () => {
      const context: ConversationContext = {
        userId: 'user-123',
        participants: [],
      };

      const result = await retriever.getAllParticipantPersonas(context);

      expect(result.size).toBe(0);
    });

    it('should fetch content for all participants', async () => {
      mockPrismaClient.persona.findUnique
        .mockResolvedValueOnce({
          preferredName: 'Alice',
          pronouns: 'she/her',
          content: 'Person 1',
        })
        .mockResolvedValueOnce({
          preferredName: 'Bob',
          pronouns: 'he/him',
          content: 'Person 2',
        });

      const context: ConversationContext = {
        userId: 'user-123',
        participants: [
          {
            personaId: 'persona-1',
            personaName: 'Alice',
            isActive: true,
          },
          {
            personaId: 'persona-2',
            personaName: 'Bob',
            isActive: false,
          },
        ],
      };

      const result = await retriever.getAllParticipantPersonas(context);

      expect(result.size).toBe(2);
      expect(result.get('Alice')).toEqual({
        content: 'Name: Alice\nPronouns: she/her\nPerson 1',
        isActive: true,
      });
      expect(result.get('Bob')).toEqual({
        content: 'Name: Bob\nPronouns: he/him\nPerson 2',
        isActive: false,
      });
    });

    it('should skip participants with no content', async () => {
      mockPrismaClient.persona.findUnique
        .mockResolvedValueOnce({
          preferredName: 'Alice',
          pronouns: 'she/her',
          content: 'Person 1',
        })
        .mockResolvedValueOnce(null); // No content for second persona

      const context: ConversationContext = {
        userId: 'user-123',
        participants: [
          {
            personaId: 'persona-1',
            personaName: 'Alice',
            isActive: true,
          },
          {
            personaId: 'persona-2',
            personaName: 'Bob',
            isActive: false,
          },
        ],
      };

      const result = await retriever.getAllParticipantPersonas(context);

      expect(result.size).toBe(1);
      expect(result.has('Alice')).toBe(true);
      expect(result.has('Bob')).toBe(false);
    });
  });

  describe('retrieveRelevantMemories', () => {
    const context: ConversationContext = {
      userId: 'user-123',
      channelId: 'channel-456',
    };

    it('should return empty array if no persona found', async () => {
      mockPrismaClient.userPersonalityConfig.findFirst.mockResolvedValue(null);
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'user-123',
        defaultPersonaLink: null,
      });

      const result = await retriever.retrieveRelevantMemories(
        mockPersonality,
        'test query',
        context
      );

      expect(result).toEqual([]);
      expect(mockMemoryManager.queryMemories).not.toHaveBeenCalled();
    });

    it('should return empty array if memory manager not available', async () => {
      const retrieverWithoutMemory = new MemoryRetriever(undefined);

      mockPrismaClient.userPersonalityConfig.findFirst.mockResolvedValue(null);
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'user-123',
        defaultPersonaLink: {
          personaId: 'persona-123',
        },
      });

      const result = await retrieverWithoutMemory.retrieveRelevantMemories(
        mockPersonality,
        'test query',
        context
      );

      expect(result).toEqual([]);
    });

    it('should query memories with correct parameters', async () => {
      mockPrismaClient.userPersonalityConfig.findFirst.mockResolvedValue(null);
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'user-123',
        defaultPersonaLink: {
          personaId: 'persona-123',
        },
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

      expect(result).toEqual(mockMemories);
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
      mockPrismaClient.userPersonalityConfig.findFirst.mockResolvedValue(null);
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'user-123',
        defaultPersonaLink: {
          personaId: 'persona-123',
        },
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
      mockPrismaClient.userPersonalityConfig.findFirst.mockResolvedValue(null);
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'user-123',
        defaultPersonaLink: {
          personaId: 'persona-123',
        },
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
  });
});
