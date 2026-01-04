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
  getPersonaContentForPrompt: vi.fn(),
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

  const baseContext: ConversationContext = {
    userId: 'discord-user-123',
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
      });

      const result = await retriever.resolvePersonaForMemory('discord-123', 'personality-123');

      expect(mockPersonaResolver.resolveForMemory).toHaveBeenCalledWith(
        'discord-123',
        'personality-123'
      );
      expect(result).toEqual({
        personaId: 'persona-123',
        shareLtmAcrossPersonalities: false,
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
    it('should return empty map if no participants provided', async () => {
      const context: ConversationContext = {
        userId: 'user-123',
        participants: [],
      };

      const result = await retriever.getAllParticipantPersonas(context);

      expect(result.size).toBe(0);
    });

    it('should return empty map if participants is undefined', async () => {
      const context: ConversationContext = {
        userId: 'user-123',
      };

      const result = await retriever.getAllParticipantPersonas(context);

      expect(result.size).toBe(0);
    });

    it('should fetch content for each participant', async () => {
      mockPersonaResolver.getPersonaContentForPrompt
        .mockResolvedValueOnce('Persona 1 content')
        .mockResolvedValueOnce('Persona 2 content');

      const context: ConversationContext = {
        userId: 'user-123',
        participants: [
          { personaId: 'persona-1', personaName: 'User One', isActive: true },
          { personaId: 'persona-2', personaName: 'User Two', isActive: false },
        ],
      };

      const result = await retriever.getAllParticipantPersonas(context);

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

    it('should skip participants with no content', async () => {
      mockPersonaResolver.getPersonaContentForPrompt
        .mockResolvedValueOnce('Has content')
        .mockResolvedValueOnce(null);

      const context: ConversationContext = {
        userId: 'user-123',
        participants: [
          { personaId: 'persona-1', personaName: 'Has Content', isActive: true },
          { personaId: 'persona-2', personaName: 'No Content', isActive: false },
        ],
      };

      const result = await retriever.getAllParticipantPersonas(context);

      expect(result.size).toBe(1);
      expect(result.get('Has Content')).toEqual({
        content: 'Has content',
        isActive: true,
        personaId: 'persona-1',
      });
      expect(result.has('No Content')).toBe(false);
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

      expect(result).toEqual([]);
      expect(mockMemoryManager.queryMemories).not.toHaveBeenCalled();
    });

    it('should return empty array if memory manager not available', async () => {
      const retrieverWithoutMemory = new MemoryRetriever(
        undefined,
        mockPersonaResolver as unknown as PersonaResolver
      );

      mockPersonaResolver.resolveForMemory.mockResolvedValue({
        personaId: 'persona-123',
        shareLtmAcrossPersonalities: false,
      });

      const result = await retrieverWithoutMemory.retrieveRelevantMemories(
        mockPersonality,
        'test query',
        context
      );

      expect(result).toEqual([]);
    });

    it('should query memories with correct parameters', async () => {
      mockPersonaResolver.resolveForMemory.mockResolvedValue({
        personaId: 'persona-123',
        shareLtmAcrossPersonalities: false,
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
      mockPersonaResolver.resolveForMemory.mockResolvedValue({
        personaId: 'persona-123',
        shareLtmAcrossPersonalities: false,
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
