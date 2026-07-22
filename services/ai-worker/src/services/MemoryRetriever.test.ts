/**
 * Tests for Memory Retriever
 *
 * Note: MemoryRetriever now delegates persona resolution to PersonaResolver.
 * These tests mock PersonaResolver to test MemoryRetriever's own logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRetriever } from './MemoryRetriever.js';
import type { PgvectorMemoryAdapter } from './PgvectorMemoryAdapter.js';
import type { ResolvedConfigOverrides } from '@tzurot/common-types/schemas/api/configOverrides';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import type { ConversationContext } from './ConversationalRAGTypes.js';
import type { PersonaResolver } from '@tzurot/identity';

// Mock PersonaResolver
const mockPersonaResolver = {
  resolveForMemory: vi.fn(),
  getPersonaForPrompt: vi.fn(),
  getPersonaContentForPrompt: vi.fn(),
  resolveToUuid: vi.fn(),
};

// Injected via the constructor. PersonaResolver is mocked separately (below),
// so this is only the placeholder the constructor stores — its methods are
// never called through this object.
const mockPrismaClient = {} as unknown as PrismaClient;

// Mock PersonaResolver constructor (now imported directly from @tzurot/identity)
vi.mock('@tzurot/identity', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/identity')>();
  return {
    ...actual,
    PersonaResolver: vi.fn().mockImplementation(() => mockPersonaResolver),
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
    ownerId: 'owner-uuid-test',
    systemPrompt: 'You are a test bot',
    model: 'test-model',
    provider: 'openrouter',
    temperature: 0.7,
    maxTokens: 4096,
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
    voiceEnabled: false,
  };

  beforeEach(() => {
    mockMemoryManager = {
      queryMemories: vi.fn().mockResolvedValue([]),
      queryMemoriesWithChannelScoping: vi.fn().mockResolvedValue([]),
      addMemory: vi.fn().mockResolvedValue(undefined),
    } as any;

    // Inject mock PersonaResolver via constructor
    retriever = new MemoryRetriever(
      mockPrismaClient,
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
      });

      const result = await retriever.resolvePersonaForMemory('discord-123', 'personality-123');

      expect(mockPersonaResolver.resolveForMemory).toHaveBeenCalledWith(
        'discord-123',
        'personality-123'
      );
      expect(result).toEqual({
        personaId: 'persona-123',
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

    it('should include participant with empty persona content (identity-only)', async () => {
      // Regression guard: a user whose persona has no bio text (e.g., created
      // via api-gateway shell path before their first Discord interaction)
      // must still appear in the participants map — identity (name, pronouns,
      // guild info) is valuable to the LLM even without a bio. Silently
      // dropping them caused a production incident where a new user was
      // absent from <participants> and the AI confused them with another user.
      mockPersonaResolver.resolveToUuid.mockResolvedValueOnce('persona-empty');
      mockPersonaResolver.getPersonaForPrompt.mockResolvedValueOnce({
        preferredName: null,
        pronouns: null,
        content: '', // empty content — the bug shape
      });

      const context: ConversationContext = {
        userId: 'user-123',
        participants: [{ personaId: 'persona-empty', personaName: 'New User', isActive: true }],
      };

      const result = await retriever.getAllParticipantPersonas(context, testPersonalityId);

      expect(result.size).toBe(1);
      expect(result.get('New User')).toEqual(
        expect.objectContaining({
          content: '',
          isActive: true,
          personaId: 'persona-empty',
        })
      );
    });

    it('should drop participant only when persona record is truly missing', async () => {
      mockPersonaResolver.resolveToUuid.mockResolvedValueOnce('persona-missing');
      mockPersonaResolver.getPersonaForPrompt.mockResolvedValueOnce(null);

      const context: ConversationContext = {
        userId: 'user-123',
        participants: [
          { personaId: 'persona-missing', personaName: 'Ghost User', isActive: false },
        ],
      };

      const result = await retriever.getAllParticipantPersonas(context, testPersonalityId);

      expect(result.size).toBe(0);
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

      expect(result).toEqual({ memories: [], freshModeEnabled: false });
      expect(mockMemoryManager.queryMemories).not.toHaveBeenCalled();
    });

    it('should return empty memories for an incognito summon', async () => {
      const incognitoContext: ConversationContext = {
        userId: 'discord-user-123',
        summonAnonymity: { kind: 'incognito' },
      };

      const result = await retriever.retrieveRelevantMemories(
        mockPersonality,
        'test query',
        incognitoContext
      );

      expect(result).toEqual({ memories: [], freshModeEnabled: false });
      // Should NOT even resolve persona or query memories
      expect(mockPersonaResolver.resolveForMemory).not.toHaveBeenCalled();
      expect(mockMemoryManager.queryMemories).not.toHaveBeenCalled();
    });

    it('retrieves LTM for a personal summon (even with weigh-in framing)', async () => {
      mockPersonaResolver.resolveForMemory.mockResolvedValue({
        personaId: 'persona-123',
      });
      const mockMemories = [{ pageContent: 'Memory content', metadata: { id: 'mem-1' } }];
      (mockMemoryManager.queryMemories as any).mockResolvedValue(mockMemories);

      // The summon is personal, so LTM retrieval proceeds. isWeighIn is framing
      // only and does not force anonymity — the persona-presence union decides.
      const personalWeighIn: ConversationContext = {
        userId: 'discord-user-123',
        isWeighIn: true,
        summonAnonymity: {
          kind: 'personal',
          activePersonaId: 'persona-123',
          activePersonaName: 'Vee',
        },
      };

      const result = await retriever.retrieveRelevantMemories(
        mockPersonality,
        'test query',
        personalWeighIn
      );

      expect(result.memories).toEqual(mockMemories);
      expect(mockPersonaResolver.resolveForMemory).toHaveBeenCalled();
      expect(mockMemoryManager.queryMemories).toHaveBeenCalled();
    });

    it('should return empty array when fresh mode is enabled', async () => {
      const isFreshActive = vi.fn().mockResolvedValue(true);
      const freshRetriever = new MemoryRetriever(
        mockPrismaClient,
        mockMemoryManager as unknown as PgvectorMemoryAdapter,
        mockPersonaResolver as unknown as PersonaResolver,
        { isFreshActive }
      );

      const result = await freshRetriever.retrieveRelevantMemories(
        mockPersonality,
        'test query',
        context
      );

      expect(result).toEqual({ memories: [], freshModeEnabled: true });
      // The checker is consulted with the interacting user + personality
      expect(isFreshActive).toHaveBeenCalledWith('discord-user-123', 'personality-123');
      // Should NOT query memories (or even resolve the persona) when fresh mode is on
      expect(mockPersonaResolver.resolveForMemory).not.toHaveBeenCalled();
      expect(mockMemoryManager.queryMemories).not.toHaveBeenCalled();
    });

    it('should query memories normally when fresh mode is inactive', async () => {
      mockPersonaResolver.resolveForMemory.mockResolvedValue({
        personaId: 'persona-123',
      });

      const mockMemories = [{ pageContent: 'Memory content', metadata: { id: 'mem-1' } }];
      (mockMemoryManager.queryMemories as any).mockResolvedValue(mockMemories);

      const result = await retriever.retrieveRelevantMemories(
        mockPersonality,
        'test query',
        context
      );

      expect(result).toEqual({
        memories: mockMemories,
        freshModeEnabled: false,
        personaId: 'persona-123',
      });
      // Should query memories when fresh mode is off (no checker = inactive)
      expect(mockMemoryManager.queryMemories).toHaveBeenCalled();
    });

    it('should return empty array if memory manager not available', async () => {
      const retrieverWithoutMemory = new MemoryRetriever(
        mockPrismaClient,
        undefined,
        mockPersonaResolver as unknown as PersonaResolver
      );

      mockPersonaResolver.resolveForMemory.mockResolvedValue({
        personaId: 'persona-123',
      });

      const result = await retrieverWithoutMemory.retrieveRelevantMemories(
        mockPersonality,
        'test query',
        context
      );

      // No memory manager → no episodes, but the persona still resolves (facts
      // path in ConversationalRAGService inherits this personaId).
      expect(result).toEqual({ memories: [], freshModeEnabled: false, personaId: 'persona-123' });
    });

    it('should query memories with correct parameters', async () => {
      mockPersonaResolver.resolveForMemory.mockResolvedValue({
        personaId: 'persona-123',
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

      expect(result).toEqual({
        memories: mockMemories,
        freshModeEnabled: false,
        personaId: 'persona-123',
      });
      // No configOverrides passed → retrieval params fall back to AI_DEFAULTS
      // (MEMORY_LIMIT=20, MEMORY_SCORE_THRESHOLD=0.5). The old per-personality
      // LlmConfig-column tier was retired; cascade + AI_DEFAULTS are the only sources.
      expect(mockMemoryManager.queryMemories).toHaveBeenCalledWith('What food do I like?', {
        personaId: 'persona-123',
        personalityId: 'personality-123',
        sessionId: undefined,
        limit: 20,
        scoreThreshold: 0.5,
        excludeNewerThan: undefined,
      });
    });

    it('should apply STM/LTM deduplication buffer', async () => {
      mockPersonaResolver.resolveForMemory.mockResolvedValue({
        personaId: 'persona-123',
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

    it('exact mode: cutoff = oldest SHIPPED message PLUS buffer (over-retrieve past the boundary)', async () => {
      mockPersonaResolver.resolveForMemory.mockResolvedValue({
        personaId: 'persona-123',
      });

      const oldestShipped = Date.now() - 3600000;
      const contextExact: ConversationContext = {
        ...context,
        // Legacy field present too — exact mode must take precedence over it.
        oldestHistoryTimestamp: oldestShipped - 999999,
        stmLtmCutoffInputs: { oldestSelectedTs: oldestShipped },
      };

      await retriever.retrieveRelevantMemories(mockPersonality, 'test', contextExact);

      expect(mockMemoryManager.queryMemories).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ excludeNewerThan: oldestShipped + 10000 })
      );
    });

    it('exact mode: refs/cross-channel keep the pessimistic MINUS-buffer bound when older', async () => {
      mockPersonaResolver.resolveForMemory.mockResolvedValue({
        personaId: 'persona-123',
      });

      const oldestShipped = Date.now() - 3600000;
      const oldCrossChannel = oldestShipped - 500000; // older → binding
      const contextExact: ConversationContext = {
        ...context,
        nonHistoryOldestTimestamp: oldCrossChannel,
        stmLtmCutoffInputs: { oldestSelectedTs: oldestShipped },
      };

      await retriever.retrieveRelevantMemories(mockPersonality, 'test', contextExact);

      expect(mockMemoryManager.queryMemories).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ excludeNewerThan: oldCrossChannel - 10000 })
      );
    });

    it('exact mode: nothing shipped and no refs → NO cutoff (everything-truncated turns keep full LTM coverage)', async () => {
      mockPersonaResolver.resolveForMemory.mockResolvedValue({
        personaId: 'persona-123',
      });

      const contextExact: ConversationContext = {
        ...context,
        // Legacy field present (fetched history existed) but nothing SHIPPED.
        oldestHistoryTimestamp: Date.now() - 3600000,
        stmLtmCutoffInputs: {},
      };

      await retriever.retrieveRelevantMemories(mockPersonality, 'test', contextExact);

      expect(mockMemoryManager.queryMemories).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ excludeNewerThan: undefined })
      );
    });

    it('should use session context if provided', async () => {
      mockPersonaResolver.resolveForMemory.mockResolvedValue({
        personaId: 'persona-123',
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

    describe('with configOverrides', () => {
      const cascadeOverrides: ResolvedConfigOverrides = {
        maxMessages: 30,
        maxAge: null,
        maxImages: 5,
        memoryScoreThreshold: 0.8,
        memoryLimit: 10,
        crossChannelHistoryEnabled: false,
        shareLtmAcrossPersonalities: false,
        showModelFooter: true,
        voiceResponseMode: 'always' as const,
        voiceTranscriptionEnabled: true,
        sources: {
          maxMessages: 'user-personality',
          maxAge: 'hardcoded',
          maxImages: 'personality',
          memoryScoreThreshold: 'admin',
          memoryLimit: 'user-default',
          crossChannelHistoryEnabled: 'hardcoded' as const,
          shareLtmAcrossPersonalities: 'hardcoded' as const,
          showModelFooter: 'hardcoded' as const,
          voiceResponseMode: 'hardcoded' as const,
          voiceTranscriptionEnabled: 'hardcoded' as const,
        },
      };

      it('should exclude personalityId when shareLtmAcrossPersonalities is true in configOverrides', async () => {
        mockPersonaResolver.resolveForMemory.mockResolvedValue({
          personaId: 'persona-123',
        });

        const shareLtmOverrides: ResolvedConfigOverrides = {
          ...cascadeOverrides,
          shareLtmAcrossPersonalities: true,
        };

        await retriever.retrieveRelevantMemories(
          mockPersonality,
          'test',
          context,
          shareLtmOverrides
        );

        expect(mockMemoryManager.queryMemories).toHaveBeenCalledWith(
          'test',
          expect.objectContaining({
            personaId: 'persona-123',
            personalityId: undefined, // Not filtered by personality when sharing
          })
        );
      });

      it('should use cascade memoryLimit and memoryScoreThreshold over AI_DEFAULTS', async () => {
        mockPersonaResolver.resolveForMemory.mockResolvedValue({
          personaId: 'persona-123',
        });

        await retriever.retrieveRelevantMemories(
          mockPersonality,
          'test query',
          context,
          cascadeOverrides
        );

        expect(mockMemoryManager.queryMemories).toHaveBeenCalledWith(
          'test query',
          expect.objectContaining({
            limit: 10, // From cascade, not AI_DEFAULTS' 20
            scoreThreshold: 0.8, // From cascade, not AI_DEFAULTS' 0.5
          })
        );
      });

      it('skips retrieval entirely when cascade memoryLimit is 0 (disabled)', async () => {
        mockPersonaResolver.resolveForMemory.mockResolvedValue({
          personaId: 'persona-123',
        });

        const disabledOverrides: ResolvedConfigOverrides = {
          ...cascadeOverrides,
          memoryLimit: 0,
        };

        const result = await retriever.retrieveRelevantMemories(
          mockPersonality,
          'test query',
          context,
          disabledOverrides
        );

        // 0 must mean "no memories", not "fall through to a downstream
        // default" — the query builder treats a non-positive limit as
        // "use the default", so the skip has to happen here. personaId must
        // be ABSENT like every other skip branch: the fact-retrieval path
        // gates on it, so its omission is what keeps facts (distilled
        // memories) suppressed together with the memories.
        expect(result).toEqual({
          memories: [],
          freshModeEnabled: false,
        });
        expect(result.personaId).toBeUndefined();
        expect(mockMemoryManager.queryMemories).not.toHaveBeenCalled();
      });

      it('should fall back to AI_DEFAULTS when configOverrides is undefined', async () => {
        mockPersonaResolver.resolveForMemory.mockResolvedValue({
          personaId: 'persona-123',
        });

        await retriever.retrieveRelevantMemories(
          mockPersonality,
          'test query',
          context,
          undefined // No cascade overrides
        );

        expect(mockMemoryManager.queryMemories).toHaveBeenCalledWith(
          'test query',
          expect.objectContaining({
            limit: 20, // AI_DEFAULTS.MEMORY_LIMIT (no cascade, retired column tier)
            scoreThreshold: 0.5, // AI_DEFAULTS.MEMORY_SCORE_THRESHOLD
          })
        );
      });
    });

    it('should use channel-scoped retrieval when channels are referenced', async () => {
      mockPersonaResolver.resolveForMemory.mockResolvedValue({
        personaId: 'persona-123',
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
