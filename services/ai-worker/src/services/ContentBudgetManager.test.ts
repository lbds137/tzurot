/**
 * Tests for ContentBudgetManager
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { ContentBudgetManager, type PreselectedHistory } from './ContentBudgetManager.js';
import { ContextWindowManager as RealContextWindowManager } from './context/ContextWindowManager.js';
import type { PromptBuilder } from './PromptBuilder.js';
import type { ContextWindowManager } from './context/ContextWindowManager.js';
import type { BudgetAllocationOptions, MemoryDocument } from './ConversationalRAGTypes.js';
import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';

describe('ContentBudgetManager', () => {
  let mockPromptBuilder: PromptBuilder;
  let mockContextWindowManager: ContextWindowManager;
  let budgetManager: ContentBudgetManager;

  const mockPersonality: LoadedPersonality = {
    id: 'test-personality-id',
    name: 'TestBot',
    displayName: 'Test Bot',
    slug: 'testbot',
    ownerId: 'owner-uuid-test',
    systemPrompt: 'You are a helpful assistant',
    model: 'gpt-4',
    provider: 'openrouter',
    temperature: 0.7,
    maxTokens: 2000,
    contextWindowTokens: 8000,
    characterInfo: 'A test personality',
    personalityTraits: 'Helpful',
    voiceEnabled: false,
  };

  const mockSystemPrompt = new SystemMessage('Test system prompt');

  beforeEach(() => {
    mockPromptBuilder = {
      buildHumanMessage: vi.fn().mockReturnValue({
        message: { content: 'User message content' },
        contentForStorage: 'User message for storage',
      }),
      buildFullSystemPrompt: vi.fn().mockReturnValue(mockSystemPrompt),
      countTokens: vi.fn().mockReturnValue(100),
      countMemoryTokens: vi.fn().mockReturnValue(50),
    } as unknown as PromptBuilder;

    mockContextWindowManager = {
      countHistoryTokens: vi.fn().mockReturnValue(200),
      calculateMemoryBudget: vi.fn().mockReturnValue(1000),
      selectMemoriesWithinBudget: vi.fn().mockReturnValue({
        selectedMemories: [],
        tokensUsed: 0,
        memoriesDropped: 0,
        droppedDueToSize: 0,
      }),
      selectAndSerializeHistory: vi.fn().mockReturnValue({
        serializedHistory: '',
        historyTokensUsed: 0,
        messagesIncluded: 0,
        messagesDropped: 0,
        crossChannelMessagesIncluded: 0,
        selectedEntries: [],
      }),
    } as unknown as ContextWindowManager;

    budgetManager = new ContentBudgetManager(mockPromptBuilder, mockContextWindowManager);
  });

  describe('allocate', () => {
    const createBaseOptions = (): BudgetAllocationOptions => ({
      personality: mockPersonality,
      processedPersonality: mockPersonality,
      participantPersonas: new Map(),
      retrievedMemories: [],
      context: {
        userId: 'user-123',
        channelId: 'channel-123',
      },
      userMessage: 'Hello, how are you?',
      processedAttachments: [],
      referencedMessagesDescriptions: undefined,
      effectiveContextWindowTokens: 8000,
    });

    it('should return budget allocation result with all required fields', () => {
      const options = createBaseOptions();

      const result = budgetManager.allocate(options, budgetManager.preselectHistory(options));

      expect(result).toHaveProperty('relevantMemories');
      expect(result).toHaveProperty('serializedHistory');
      expect(result).toHaveProperty('systemPrompt');
      expect(result).toHaveProperty('memoryTokensUsed');
      expect(result).toHaveProperty('historyTokensUsed');
      expect(result).toHaveProperty('memoriesDroppedCount');
      expect(result).toHaveProperty('messagesDropped');
      expect(result).toHaveProperty('contentForStorage');
    });

    it('should build human message from prompt builder', () => {
      const options = createBaseOptions();

      budgetManager.allocate(options, budgetManager.preselectHistory(options));

      // Uses expect.objectContaining to focus on key parameters without being brittle
      // to implementation details (e.g., referencedMessagesDescriptions can be undefined)
      expect(mockPromptBuilder.buildHumanMessage).toHaveBeenCalledWith(
        'Hello, how are you?',
        [],
        expect.objectContaining({
          activePersonaName: undefined,
          activePersonaId: undefined,
          discordUsername: undefined,
          personalityName: 'TestBot',
        })
      );
    });

    it('should budget against the effective context window, not the personality setting', () => {
      const options = createBaseOptions();
      // Personality says 8000 but the caller-resolved effective window (e.g.,
      // clamped to the model's real limit) is what must drive the budget
      options.effectiveContextWindowTokens = 6000;

      budgetManager.allocate(options, budgetManager.preselectHistory(options));

      expect(mockContextWindowManager.calculateMemoryBudget).toHaveBeenCalledWith(
        6000,
        expect.any(Number),
        expect.any(Number),
        expect.any(Number)
      );
    });

    it('should select memories within budget', () => {
      const memories: MemoryDocument[] = [
        { pageContent: 'Memory 1', metadata: { id: 'mem-1' } },
        { pageContent: 'Memory 2', metadata: { id: 'mem-2' } },
      ];
      const options = createBaseOptions();
      options.retrievedMemories = memories;

      vi.mocked(mockContextWindowManager.selectMemoriesWithinBudget).mockReturnValue({
        selectedMemories: [memories[0]],
        tokensUsed: 50,
        memoriesDropped: 1,
        droppedDueToSize: 0,
      });

      const result = budgetManager.allocate(options, budgetManager.preselectHistory(options));

      expect(mockContextWindowManager.selectMemoriesWithinBudget).toHaveBeenCalledWith(
        memories,
        1000,
        undefined
      );
      expect(result.relevantMemories).toHaveLength(1);
      expect(result.memoryTokensUsed).toBe(50);
      expect(result.memoriesDroppedCount).toBe(1);
    });

    it('should select and serialize history', () => {
      const options = createBaseOptions();
      options.context.rawConversationHistory = [
        { role: 'user', content: 'Previous message' },
        { role: 'assistant', content: 'Previous response' },
      ];

      vi.mocked(mockContextWindowManager.selectAndSerializeHistory).mockReturnValue({
        serializedHistory: 'Serialized history content',
        historyTokensUsed: 150,
        messagesIncluded: 2,
        messagesDropped: 0,
        crossChannelMessagesIncluded: 0,
        selectedEntries: [],
      });

      const result = budgetManager.allocate(options, budgetManager.preselectHistory(options));

      expect(mockContextWindowManager.selectAndSerializeHistory).toHaveBeenCalled();
      expect(result.serializedHistory).toBe('Serialized history content');
      expect(result.historyTokensUsed).toBe(150);
      expect(result.messagesDropped).toBe(0);
    });

    it('should build final system prompt with memories and history', () => {
      const options = createBaseOptions();

      budgetManager.allocate(options, budgetManager.preselectHistory(options));

      // buildFullSystemPrompt is called exactly twice:
      // 1. Base system prompt (pre-pass, for token counting)
      // 2. Final with memories AND history
      // The old middle build (prompt-with-memories to size the history
      // budget) is gone by design: the history budget uses the memory
      // RESERVE so it is computable BEFORE retrieval — that ordering is what
      // closes the STM/LTM coverage hole.
      expect(mockPromptBuilder.buildFullSystemPrompt).toHaveBeenCalledTimes(2);
    });

    it('should pass participant personas to system prompt builder', () => {
      const options = createBaseOptions();
      options.participantPersonas = new Map([
        ['Alice', { content: 'User persona', isActive: true, personaId: 'persona-alice' }],
      ]);

      budgetManager.allocate(options, budgetManager.preselectHistory(options));

      expect(mockPromptBuilder.buildFullSystemPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          participantPersonas: options.participantPersonas,
        })
      );
    });

    it('should pass referenced messages to system prompt builder', () => {
      const options = createBaseOptions();
      options.referencedMessagesDescriptions = 'Referenced: Some quoted message';

      budgetManager.allocate(options, budgetManager.preselectHistory(options));

      expect(mockPromptBuilder.buildFullSystemPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          referencedMessagesFormatted: 'Referenced: Some quoted message',
        })
      );
    });

    it('should pass user timezone for memory selection', () => {
      const options = createBaseOptions();
      options.context.userTimezone = 'America/New_York';

      budgetManager.allocate(options, budgetManager.preselectHistory(options));

      expect(mockContextWindowManager.selectMemoriesWithinBudget).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'America/New_York'
      );
    });

    it('should return content for storage from prompt builder', () => {
      vi.mocked(mockPromptBuilder.buildHumanMessage).mockReturnValue({
        message: new HumanMessage('Message content'),
        contentForStorage: 'Clean content for LTM storage',
      });

      const options = createBaseOptions();

      const result = budgetManager.allocate(options, budgetManager.preselectHistory(options));

      expect(result.contentForStorage).toBe('Clean content for LTM storage');
    });

    it('should handle memories being dropped due to budget', () => {
      const memories: MemoryDocument[] = [
        { pageContent: 'Memory 1', metadata: { id: 'mem-1' } },
        { pageContent: 'Memory 2', metadata: { id: 'mem-2' } },
        { pageContent: 'Memory 3', metadata: { id: 'mem-3' } },
      ];
      const options = createBaseOptions();
      options.retrievedMemories = memories;

      vi.mocked(mockContextWindowManager.selectMemoriesWithinBudget).mockReturnValue({
        selectedMemories: [memories[0]],
        tokensUsed: 100,
        memoriesDropped: 2,
        droppedDueToSize: 1,
      });

      const result = budgetManager.allocate(options, budgetManager.preselectHistory(options));

      expect(result.relevantMemories).toHaveLength(1);
      expect(result.memoriesDroppedCount).toBe(2);
    });

    it('should handle history messages being dropped', () => {
      const options = createBaseOptions();
      options.context.rawConversationHistory = [
        { role: 'user', content: 'Old message 1' },
        { role: 'assistant', content: 'Old response 1' },
        { role: 'user', content: 'Recent message' },
        { role: 'assistant', content: 'Recent response' },
      ];

      vi.mocked(mockContextWindowManager.selectAndSerializeHistory).mockReturnValue({
        serializedHistory: 'Recent messages only',
        historyTokensUsed: 100,
        messagesIncluded: 2,
        messagesDropped: 2,
        crossChannelMessagesIncluded: 0,
        selectedEntries: [],
      });

      const result = budgetManager.allocate(options, budgetManager.preselectHistory(options));

      expect(result.messagesDropped).toBe(2);
    });

    it('should pass cross-channel history to selectAndSerializeHistory', () => {
      const options = createBaseOptions();
      (options.context as unknown as Record<string, unknown>).crossChannelHistory = [
        {
          channelEnvironment: {
            type: 'guild' as const,
            guild: { id: 'g-1', name: 'Server' },
            channel: { id: 'ch-1', name: 'general', type: 'text' },
          },
          messages: [
            {
              id: 'msg-1',
              role: 'user',
              content: 'Cross-channel msg',
              createdAt: '2026-02-26T10:00:00Z',
              tokenCount: 10,
              personaName: 'Alice',
            },
          ],
        },
      ];

      budgetManager.allocate(options, budgetManager.preselectHistory(options));

      // Verify cross-channel groups were passed as 4th arg
      const call = vi.mocked(mockContextWindowManager.selectAndSerializeHistory).mock.calls[0];
      expect(call).toBeDefined();
      expect(call[3]).toBeDefined(); // 4th arg = crossChannelGroups
      expect(call[3]).toHaveLength(1);
      expect(call[3]![0].channelEnvironment.type).toBe('guild');
      expect(call[3]![0].messages[0].content).toBe('Cross-channel msg');
    });

    it('should pass environment to selectAndSerializeHistory as 5th arg', () => {
      const options = createBaseOptions();
      const environment = {
        type: 'guild' as const,
        guild: { id: 'g-1', name: 'Server' },
        channel: { id: 'ch-1', name: 'chat', type: 'text' },
      };
      options.context.environment = environment;

      budgetManager.allocate(options, budgetManager.preselectHistory(options));

      const call = vi.mocked(mockContextWindowManager.selectAndSerializeHistory).mock.calls[0];
      expect(call).toBeDefined();
      expect(call[4]).toBeDefined(); // 5th arg = currentEnvironment
      expect(call[4]).toEqual(environment);
    });

    it('should pass undefined environment when not available in context', () => {
      const options = createBaseOptions();
      // No environment set in context

      budgetManager.allocate(options, budgetManager.preselectHistory(options));

      const call = vi.mocked(mockContextWindowManager.selectAndSerializeHistory).mock.calls[0];
      expect(call).toBeDefined();
      expect(call[4]).toBeUndefined(); // 5th arg = undefined when no environment
    });
  });

  // Fixed mocks: calculateMemoryBudget → 1000, countTokens → 100 for every
  // string. So the fact sub-budget = min(600, floor(1000*0.3)) = 300; wrapper
  // (100) + fact (100) each → exactly 2 facts fit (100+100+100=300), episodes
  // get 1000-300 = 700.
  describe('reserved fact sub-budget (Phase 2 slice 4a)', () => {
    const withFacts = (n: number): BudgetAllocationOptions => ({
      personality: mockPersonality,
      processedPersonality: mockPersonality,
      participantPersonas: new Map(),
      retrievedMemories: [],
      facts: Array.from({ length: n }, (_, i) => ({ statement: `fact ${i}` })),
      context: { userId: 'u', channelId: 'c' },
      userMessage: 'hi',
      processedAttachments: [],
      referencedMessagesDescriptions: undefined,
      effectiveContextWindowTokens: 8000,
    });

    it('selects facts within the reserved slice and reduces the episode budget by exactly that cost', () => {
      const result = (() => {
        const o = withFacts(3);
        return budgetManager.allocate(o, budgetManager.preselectHistory(o));
      })();

      // 2 of 3 facts fit the 300-token slice; factTokensUsed = 300.
      expect(result.selectedFacts).toHaveLength(2);
      expect(result.factTokensUsed).toBe(300);
      // Episodes got the remainder (1000 - 300 = 700), NOT the full 1000 —
      // facts don't come for free but also don't starve episodes.
      const episodeBudget = vi.mocked(mockContextWindowManager.selectMemoriesWithinBudget).mock
        .calls[0][1];
      expect(episodeBudget).toBe(700);
      // The selected facts cross the seam into the prompt build.
      const promptFacts = vi
        .mocked(mockPromptBuilder.buildFullSystemPrompt)
        .mock.calls.at(-1)?.[0].facts;
      expect(promptFacts).toHaveLength(2);
    });

    it('no facts → episodes keep the full memory budget, factTokensUsed 0', () => {
      const result = (() => {
        const o = withFacts(0);
        return budgetManager.allocate(o, budgetManager.preselectHistory(o));
      })();

      expect(result.selectedFacts).toEqual([]);
      expect(result.factTokensUsed).toBe(0);
      const episodeBudget = vi.mocked(mockContextWindowManager.selectMemoriesWithinBudget).mock
        .calls[0][1];
      expect(episodeBudget).toBe(1000); // untouched
    });

    it('wrapper overhead alone exceeding the fact slice selects nothing (zero facts, zero tokens)', () => {
      // Tiny memory budget → factBudget = min(600, floor(300 * 0.3)) = 90, which is
      // below the 100-token wrapper overhead. The FIRST fact can never fit, so the
      // block collapses to empty rather than emitting a wrapper with no facts inside.
      vi.mocked(mockContextWindowManager.calculateMemoryBudget).mockReturnValue(300);
      const result = (() => {
        const o = withFacts(3);
        return budgetManager.allocate(o, budgetManager.preselectHistory(o));
      })();

      expect(result.selectedFacts).toEqual([]);
      expect(result.factTokensUsed).toBe(0);
      // Episodes keep the whole (small) budget — facts took nothing.
      const episodeBudget = vi.mocked(mockContextWindowManager.selectMemoriesWithinBudget).mock
        .calls[0][1];
      expect(episodeBudget).toBe(300);
      // Nothing crosses the seam into the prompt build.
      const promptFacts = vi
        .mocked(mockPromptBuilder.buildFullSystemPrompt)
        .mock.calls.at(-1)?.[0].facts;
      expect(promptFacts).toEqual([]);
    });
  });

  describe('STM/LTM selection filter (dedup-hole fix)', () => {
    const mem = (
      id: string,
      createdAt: number,
      messageIds: string[] | undefined,
      channelId = 'channel-123'
    ): MemoryDocument => ({
      pageContent: `memory ${id}`,
      metadata: { id, createdAt, score: 0.9, messageIds, channelId },
    });

    const preselectedWith = (overrides: Partial<PreselectedHistory>): PreselectedHistory => ({
      currentMessage: new HumanMessage('hi'),
      contentForStorage: 'hi',
      systemPromptBaseTokens: 100,
      currentMessageTokens: 10,
      memoryReserve: 1000,
      historyBudget: 500,
      serializedHistory: '<chat_log/>',
      historyTokensUsed: 50,
      messagesDropped: 0,
      crossChannelMessagesIncluded: 0,
      shippedMessageIds: new Set<string>(),
      ...overrides,
    });

    const allocateAndCaptureFiltered = (
      memories: MemoryDocument[],
      preselected: PreselectedHistory
    ): MemoryDocument[] => {
      const options = { ...createFilterOptions(), retrievedMemories: memories };
      budgetManager.allocate(options, preselected);
      // Seam assertion target: whatever survived the filter is what memory
      // selection receives.
      const calls = vi.mocked(mockContextWindowManager.selectMemoriesWithinBudget).mock.calls;
      return calls[calls.length - 1][0] as MemoryDocument[];
    };

    const createFilterOptions = (): BudgetAllocationOptions => ({
      personality: mockPersonality,
      processedPersonality: mockPersonality,
      participantPersonas: new Map(),
      retrievedMemories: [],
      context: { userId: 'user-123', channelId: 'channel-123' },
      userMessage: 'hello',
      processedAttachments: [],
      referencedMessagesDescriptions: undefined,
      effectiveContextWindowTokens: 8000,
    });

    const CUTOFF = 1_000_000;

    it('keeps memories older than the oldest SHIPPED message (exact time baseline)', () => {
      const kept = allocateAndCaptureFiltered(
        [mem('old', CUTOFF - 1, ['m-old'])],
        preselectedWith({ oldestSelectedTs: CUTOFF, shippedMessageIds: new Set(['s1']) })
      );
      expect(kept.map(m => m.metadata?.id)).toEqual(['old']);
    });

    it('drops a memory whose source message SHIPPED (ID-authoritative dedup)', () => {
      const kept = allocateAndCaptureFiltered(
        [mem('shipped', CUTOFF + 50, ['s1'])],
        preselectedWith({ oldestSelectedTs: CUTOFF, shippedMessageIds: new Set(['s1']) })
      );
      expect(kept).toEqual([]);
    });

    it('RESCUES a dropped-range memory: newer than the cutoff (persistence lag) but its source never shipped', () => {
      const kept = allocateAndCaptureFiltered(
        [mem('dropped-range', CUTOFF + 50, ['m-dropped'])],
        preselectedWith({ oldestSelectedTs: CUTOFF, shippedMessageIds: new Set(['s1']) })
      );
      expect(kept.map(m => m.metadata?.id)).toEqual(['dropped-range']);
    });

    it('does NOT rescue across channels — shipped cross-channel content must not re-enter as duplication', () => {
      const kept = allocateAndCaptureFiltered(
        [mem('other-channel', CUTOFF + 50, ['x1'], 'other-channel-id')],
        preselectedWith({ oldestSelectedTs: CUTOFF, shippedMessageIds: new Set(['s1']) })
      );
      expect(kept).toEqual([]);
    });

    it('legacy id-less rows get only the time baseline (no rescue)', () => {
      const kept = allocateAndCaptureFiltered(
        [mem('legacy-band', CUTOFF + 50, undefined), mem('legacy-old', CUTOFF - 1, undefined)],
        preselectedWith({ oldestSelectedTs: CUTOFF, shippedMessageIds: new Set(['s1']) })
      );
      expect(kept.map(m => m.metadata?.id)).toEqual(['legacy-old']);
    });

    it('normalizes a STRING createdAt — a predating memory is kept, not silently dropped', () => {
      // channelId mismatched + ids unshipped: the time baseline is the ONLY
      // path that can keep this memory, isolating the normalization.
      const kept = allocateAndCaptureFiltered(
        [
          {
            pageContent: 'string-stamped memory',
            metadata: {
              id: 'str-ts',
              createdAt: new Date(CUTOFF - 1).toISOString(),
              score: 0.9,
              messageIds: ['m-x'],
              channelId: 'some-other-channel',
            },
          },
        ],
        preselectedWith({ oldestSelectedTs: CUTOFF, shippedMessageIds: new Set(['s1']) })
      );
      expect(kept.map(m => m.metadata?.id)).toEqual(['str-ts']);
    });

    it('applies no filter when nothing shipped (everything-truncated turns keep full LTM coverage)', () => {
      const kept = allocateAndCaptureFiltered(
        [mem('any', CUTOFF + 50, ['m1'])],
        preselectedWith({ oldestSelectedTs: undefined })
      );
      expect(kept.map(m => m.metadata?.id)).toEqual(['any']);
    });
  });

  describe('invariant: a budget-dropped message stays LTM-reachable (real history selection)', () => {
    it('preselect with a REAL ContextWindowManager exposes the exact shipped boundary and ids', () => {
      // Four entries, newest-first selection under a budget that fits only
      // the newest two — E1/E2 drop, E3/E4 ship.
      const entry = (n: number): Record<string, unknown> => ({
        id: `uuid-${n}`,
        discordMessageId: [`snowflake-${n}`],
        role: n % 2 === 0 ? 'assistant' : 'user',
        content: `message ${n}`,
        createdAt: new Date(1_000_000 + n * 60_000).toISOString(),
        // Sized so the REAL budget math (window 1450 − base 100 − msg 100 −
        // real memory hardCap) fits exactly TWO entries: E1/E2 drop, E3/E4 ship.
        tokenCount: 400,
      });
      const realManager = new RealContextWindowManager();
      const manager = new ContentBudgetManager(mockPromptBuilder, realManager);
      const options = {
        personality: mockPersonality,
        processedPersonality: mockPersonality,
        participantPersonas: new Map(),
        context: {
          userId: 'user-123',
          channelId: 'channel-123',
          rawConversationHistory: [entry(1), entry(2), entry(3), entry(4)],
        },
        userMessage: 'hello',
        processedAttachments: [],
        referencedMessagesDescriptions: undefined,
        // base(100 via countTokens mock) + msg(100) + reserve leaves a history
        // budget that fits ~2 entries of 100 tokens + wrapper.
        effectiveContextWindowTokens: 100 + 100 + 1000 + 250,
      } as unknown as BudgetAllocationOptions;
      vi.mocked(mockPromptBuilder.countTokens).mockReturnValue(100);

      const preselected = manager.preselectHistory(options);

      // The exact boundary: E3 is the oldest SHIPPED entry.
      expect(preselected.messagesDropped).toBe(2);
      expect(preselected.oldestSelectedTs).toBe(1_000_000 + 3 * 60_000);
      expect([...preselected.shippedMessageIds].sort()).toEqual(['snowflake-3', 'snowflake-4']);
      // The invariant, composed: a memory of DROPPED E1 — created after the
      // boundary (persistence lag) with E1's snowflake — survives the filter…
      const droppedMemory: MemoryDocument = {
        pageContent: 'memory of E1',
        metadata: {
          id: 'mem-e1',
          createdAt: (preselected.oldestSelectedTs as number) + 5_000,
          score: 0.9,
          messageIds: ['snowflake-1'],
          channelId: 'channel-123',
        },
      };
      // …while a memory of SHIPPED E4 is dropped.
      const shippedMemory: MemoryDocument = {
        pageContent: 'memory of E4',
        metadata: {
          id: 'mem-e4',
          createdAt: (preselected.oldestSelectedTs as number) + 6_000,
          score: 0.9,
          messageIds: ['snowflake-4'],
          channelId: 'channel-123',
        },
      };
      manager.allocate(
        { ...options, retrievedMemories: [droppedMemory, shippedMemory], facts: [] },
        preselected
      );
      const calls = vi.mocked(mockPromptBuilder.buildFullSystemPrompt).mock.calls;
      const finalPromptArgs = calls[calls.length - 1][0] as {
        relevantMemories: MemoryDocument[];
      };
      expect(finalPromptArgs.relevantMemories.map(m => m.metadata?.id)).toEqual(['mem-e1']);
    });
  });
});
