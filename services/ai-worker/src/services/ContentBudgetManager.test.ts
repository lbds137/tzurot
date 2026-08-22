/**
 * Tests for ContentBudgetManager
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AIMessage, SystemMessage, HumanMessage } from '@langchain/core/messages';
import { ContentBudgetManager, activeSpeakerPronouns } from './ContentBudgetManager.js';
import { ContextWindowManager as RealContextWindowManager } from './context/ContextWindowManager.js';
import type { PromptBuilder } from './PromptBuilder.js';
import type { ContextWindowManager } from './context/ContextWindowManager.js';
import type {
  BudgetAllocationOptions,
  MemoryDocument,
  ParticipantInfo,
  PreselectedHistory,
} from './ConversationalRAGTypes.js';
import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';

// The realMessagesEnabled rollout flag (PR 2.3). Hoisted so the mock factory
// (which runs at import time) can close over a mutable flag — a plain `let`
// initializes AFTER the factory would already need it. Defaults false so
// every existing test in this file sees today's byte-identical shape; the
// "realMessagesEnabled (PR 2.3)" describe block below flips it per test.
const { settingsState } = vi.hoisted(() => ({ settingsState: { realMessagesEnabled: false } }));
vi.mock('@tzurot/common-types/services/SystemSettingsService', () => ({
  getSystemSetting: (key: string) =>
    key === 'realMessagesEnabled' ? settingsState.realMessagesEnabled : false,
}));

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
      buildSystemMessage: vi.fn().mockReturnValue({ message: mockSystemPrompt, sections: [] }),
      buildVolatilePrefix: vi.fn().mockReturnValue('<context>volatile prefix</context>'),
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
        crossChannelXml: '',
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

    it('builds the FINAL human message with the POST-selection volatile prefix', () => {
      // The sequencing seam: the pre-pass prefix lacks memories/facts (not
      // retrieved yet); the final prefix — built after selection — is what the
      // shipped human message must carry. Distinct sentinels per call pin that
      // the final buildHumanMessage received the SECOND prefix, and that the
      // final prefix build got the selected memories.
      vi.mocked(mockPromptBuilder.buildVolatilePrefix)
        .mockReturnValueOnce('<context>PRE-PASS</context>')
        .mockReturnValueOnce('<context>FINAL-WITH-MEMORIES</context>');
      const options = createBaseOptions();

      budgetManager.allocate(options, budgetManager.preselectHistory(options));

      const humanCalls = vi.mocked(mockPromptBuilder.buildHumanMessage).mock.calls;
      expect(humanCalls[0][2]).toMatchObject({ volatilePrefix: '<context>PRE-PASS</context>' });
      expect(humanCalls.at(-1)?.[2]).toMatchObject({
        volatilePrefix: '<context>FINAL-WITH-MEMORIES</context>',
      });
      // The pre-pass prefix build must NOT receive memories/facts…
      const prefixCalls = vi.mocked(mockPromptBuilder.buildVolatilePrefix).mock.calls;
      expect(prefixCalls[0][0].relevantMemories).toBeUndefined();
      expect(prefixCalls[0][0].facts).toBeUndefined();
      // …while the final one receives the selected sets.
      expect(prefixCalls.at(-1)?.[0].relevantMemories).toBeDefined();
      expect(prefixCalls.at(-1)?.[0].facts).toBeDefined();
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
        crossChannelXml: '',
      });

      const result = budgetManager.allocate(options, budgetManager.preselectHistory(options));

      expect(mockContextWindowManager.selectAndSerializeHistory).toHaveBeenCalled();

      // The responder identity crossing this mocked seam, asserted by VALUE.
      // Both fields are strings, so a mixup (passing the name twice, dropping
      // the id) is invisible to the compiler, and a mocked collaborator returns
      // the same thing either way — the id only has an observable effect two
      // layers down, where this test cannot see it.
      const [, responder] = vi.mocked(mockContextWindowManager.selectAndSerializeHistory).mock
        .calls[0];
      expect(responder).toEqual({ name: mockPersonality.name, id: mockPersonality.id });

      // The pre-measure must see the SAME identity as the shipped selection,
      // or the budget identity it underwrites does not hold.
      const [, measuredResponder] = vi.mocked(mockContextWindowManager.countHistoryTokens).mock
        .calls[0];
      expect(measuredResponder).toEqual(responder);

      expect(result.serializedHistory).toBe('Serialized history content');
      expect(result.historyTokensUsed).toBe(150);
      expect(result.messagesDropped).toBe(0);
    });

    it('should build final system prompt with memories and history', () => {
      const options = createBaseOptions();

      budgetManager.allocate(options, budgetManager.preselectHistory(options));

      // Each container is built exactly twice per request:
      // 1. Pre-pass (token measurement): system without history, volatile
      //    prefix WITHOUT memories/facts (not retrieved yet), human message
      //    carrying that pre-pass prefix.
      // 2. Final: system with history; prefix with the selected memory
      //    blocks; the human message the invoker actually ships.
      // The old middle build (prompt-with-memories to size the history
      // budget) is gone by design: the history budget uses the memory
      // RESERVE so it is computable BEFORE retrieval — that ordering is what
      // closes the STM/LTM coverage hole.
      expect(mockPromptBuilder.buildSystemMessage).toHaveBeenCalledTimes(2);
      expect(mockPromptBuilder.buildVolatilePrefix).toHaveBeenCalledTimes(2);
      expect(mockPromptBuilder.buildHumanMessage).toHaveBeenCalledTimes(2);
    });

    it('passes participant personas to BOTH buildSystemMessage calls', () => {
      // The roster renders in the system message, so it counts toward
      // systemPromptBaseTokens. The budget identity (contextWindow −
      // systemPromptBase − currentMessage − memoryReserve) holds only if the
      // MEASUREMENT call and the shipped call see the same input; passing it to
      // one and not the other under-counts the base and inflates historyBudget
      // by exactly the roster's size — silently, since both calls succeed.
      const options = createBaseOptions();
      options.participantPersonas = new Map([
        [
          'persona-alice',
          {
            personaName: 'Alice',
            content: 'User persona',
            isActive: true,
            personaId: 'persona-alice',
          },
        ],
      ]);

      budgetManager.allocate(options, budgetManager.preselectHistory(options));

      const systemCalls = vi.mocked(mockPromptBuilder.buildSystemMessage).mock.calls;
      // The measurement call (no serializedHistory) is the silent-failure path.
      const measurementCall = systemCalls.find(
        ([arg]) => (arg as { serializedHistory?: string }).serializedHistory === undefined
      );
      const shippedCall = systemCalls.find(
        ([arg]) => (arg as { serializedHistory?: string }).serializedHistory !== undefined
      );

      expect(measurementCall?.[0]).toEqual(
        expect.objectContaining({ participantPersonas: options.participantPersonas })
      );
      expect(shippedCall?.[0]).toEqual(
        expect.objectContaining({ participantPersonas: options.participantPersonas })
      );
    });

    it('passes the active speaker pronouns to the human message from the roster', () => {
      const options = createBaseOptions();
      options.context.activePersonaId = 'persona-alice';
      options.participantPersonas = new Map([
        [
          'persona-alice',
          {
            personaName: 'Alice',
            content: 'User persona',
            isActive: true,
            personaId: 'persona-alice',
            pronouns: 'she/her',
          },
        ],
      ]);

      budgetManager.allocate(options, budgetManager.preselectHistory(options));

      const humanCalls = vi.mocked(mockPromptBuilder.buildHumanMessage).mock.calls;
      expect(humanCalls.length).toBeGreaterThan(0);
      // Both the pre-pass and the shipped message identify the same speaker.
      for (const call of humanCalls) {
        expect(call[2]).toEqual(expect.objectContaining({ activePersonaPronouns: 'she/her' }));
      }
    });

    it('omits pronouns when the active speaker is absent from the roster', () => {
      const options = createBaseOptions();
      options.context.activePersonaId = 'persona-nobody';
      options.participantPersonas = new Map([
        [
          'persona-alice',
          {
            personaName: 'Alice',
            content: 'User persona',
            isActive: true,
            personaId: 'persona-alice',
            pronouns: 'she/her',
          },
        ],
      ]);

      budgetManager.allocate(options, budgetManager.preselectHistory(options));

      for (const call of vi.mocked(mockPromptBuilder.buildHumanMessage).mock.calls) {
        expect(
          (call[2] as { activePersonaPronouns?: string }).activePersonaPronouns
        ).toBeUndefined();
      }
    });

    it('should pass referenced messages to system prompt builder', () => {
      const options = createBaseOptions();
      options.referencedMessagesDescriptions = 'Referenced: Some quoted message';

      budgetManager.allocate(options, budgetManager.preselectHistory(options));

      expect(mockPromptBuilder.buildVolatilePrefix).toHaveBeenCalledWith(
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
        crossChannelXml: '',
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

      // Verify cross-channel groups were passed in the trailing options object
      const call = vi.mocked(mockContextWindowManager.selectAndSerializeHistory).mock.calls[0];
      expect(call).toBeDefined();
      // The options parameter is optional on the signature, so the mock tuple
      // types it as possibly-undefined — but the caller always passes it.
      const passedOptions = call[3]!;
      expect(passedOptions.crossChannelGroups).toBeDefined();
      expect(passedOptions.crossChannelGroups).toHaveLength(1);
      expect(passedOptions.crossChannelGroups![0].channelEnvironment.type).toBe('guild');
      expect(passedOptions.crossChannelGroups![0].messages[0].content).toBe('Cross-channel msg');
    });

    it('should pass environment to selectAndSerializeHistory in the options object', () => {
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
      expect(call[3]!.currentEnvironment).toBeDefined();
      expect(call[3]!.currentEnvironment).toEqual(environment);
    });

    it('should pass undefined environment when not available in context', () => {
      const options = createBaseOptions();
      // No environment set in context

      budgetManager.allocate(options, budgetManager.preselectHistory(options));

      const call = vi.mocked(mockContextWindowManager.selectAndSerializeHistory).mock.calls[0];
      expect(call).toBeDefined();
      expect(call[3]!.currentEnvironment).toBeUndefined();
    });

    describe('realMessagesEnabled (PR 2.3)', () => {
      afterEach(() => {
        settingsState.realMessagesEnabled = false;
      });

      it('flag-ON colliding roster: the tag survives preselectHistory -> allocate into the shipped header (wiring seam)', () => {
        // The one layer with no per-feature pin: the map is computed in
        // preselectHistory and travels to allocate ONLY as a destructured
        // field on PreselectedHistory — a dropped field would silently ship
        // untagged headers while every unit-level test stayed green. Real
        // computeHeaderIdTags + real buildShippedHistoryMessages; only the
        // class collaborators are mocked.
        settingsState.realMessagesEnabled = true;
        const options = createBaseOptions();
        options.participantPersonas = new Map([
          [
            'aaaa1111-0000-0000-0000-000000000001',
            {
              personaId: 'aaaa1111-0000-0000-0000-000000000001',
              personaName: 'Lila',
              content: '',
            },
          ],
          [
            'bbbb2222-0000-0000-0000-000000000002',
            {
              personaId: 'bbbb2222-0000-0000-0000-000000000002',
              personaName: 'Lila',
              content: '',
            },
          ],
        ]) as never;
        vi.mocked(mockContextWindowManager.selectAndSerializeHistory).mockReturnValue({
          serializedHistory: '',
          historyTokensUsed: 10,
          messagesIncluded: 1,
          messagesDropped: 0,
          crossChannelMessagesIncluded: 0,
          selectedEntries: [
            {
              role: 'user',
              content: 'hi',
              personaId: 'aaaa1111-0000-0000-0000-000000000001',
              personaName: 'Lila',
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ],
          crossChannelXml: '',
        });

        const preselected = budgetManager.preselectHistory(options);
        const result = budgetManager.allocate(options, preselected);

        const header = String(result.historyMessages?.[0]?.content).split('\n')[0];
        expect(header).toContain('(id:aaaa)');
      });

      it('flag-OFF: no historyMessages/crossChannelMessage; the shipped system-message build is unaffected', () => {
        const options = createBaseOptions();
        vi.mocked(mockContextWindowManager.selectAndSerializeHistory).mockReturnValue({
          serializedHistory: '<chat_log>hi</chat_log>',
          historyTokensUsed: 50,
          messagesIncluded: 1,
          messagesDropped: 0,
          crossChannelMessagesIncluded: 0,
          selectedEntries: [{ role: 'user', content: 'hi', personaId: 'p-1', personaName: 'Vlad' }],
          crossChannelXml: '<prior_conversations>old</prior_conversations>',
        });

        const preselected = budgetManager.preselectHistory(options);
        const result = budgetManager.allocate(options, preselected);

        expect(result.historyMessages).toBeUndefined();
        expect(result.crossChannelMessage).toBeUndefined();
        // serializedHistory keeps carrying the full XML — this exact assertion
        // is the byte-parity anchor: the pre-change shape had no other field.
        expect(result.serializedHistory).toBe('<chat_log>hi</chat_log>');

        const shippedCall = vi
          .mocked(mockPromptBuilder.buildSystemMessage)
          .mock.calls.find(
            ([arg]) => (arg as { serializedHistory?: string }).serializedHistory !== undefined
          );
        expect(shippedCall?.[0]).toEqual(
          expect.objectContaining({
            serializedHistory: '<chat_log>hi</chat_log>',
            realMessagesEnabled: false,
          })
        );
      });

      it('flag-ON: historyMessages in chronological order, cross-channel message present, chat_log suppressed via an empty serializedHistory at the shipped build — result.serializedHistory keeps the full XML regardless', () => {
        settingsState.realMessagesEnabled = true;
        const options = createBaseOptions();
        const entries = [
          {
            role: 'user',
            content: 'first',
            personaId: 'p-1',
            personaName: 'Vlad',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
          {
            role: 'assistant',
            content: 'second',
            personalityId: mockPersonality.id,
            personalityName: mockPersonality.name,
            createdAt: '2026-01-01T00:05:00.000Z',
          },
        ];
        vi.mocked(mockContextWindowManager.selectAndSerializeHistory).mockReturnValue({
          serializedHistory: '<chat_log>first second</chat_log>',
          historyTokensUsed: 50,
          messagesIncluded: 2,
          messagesDropped: 0,
          crossChannelMessagesIncluded: 1,
          selectedEntries: entries,
          crossChannelXml: '<prior_conversations>old chat</prior_conversations>',
        });

        const preselected = budgetManager.preselectHistory(options);
        const result = budgetManager.allocate(options, preselected);

        expect(result.historyMessages).toHaveLength(2);
        expect(result.historyMessages?.[0]).not.toBeInstanceOf(AIMessage);
        expect(String(result.historyMessages?.[0].content)).toContain('first');
        expect(result.historyMessages?.[1]).toBeInstanceOf(AIMessage);
        expect(String(result.historyMessages?.[1].content)).toContain('second');

        expect(result.crossChannelMessage).toBeDefined();
        expect(String(result.crossChannelMessage?.content)).toBe(
          '<prior_conversations>old chat</prior_conversations>'
        );

        // The mechanism behind "no <chat_log>": the shipped build receives ''
        // regardless of the actual serializedHistory content.
        const shippedCall = vi.mocked(mockPromptBuilder.buildSystemMessage).mock.calls.at(-1);
        expect(shippedCall?.[0]).toEqual(
          expect.objectContaining({ serializedHistory: '', realMessagesEnabled: true })
        );

        // serializedHistory on the RESULT still carries the full XML in BOTH
        // modes — diagnostics/prefix-cache observability read it regardless
        // of which container ships it.
        expect(result.serializedHistory).toBe('<chat_log>first second</chat_log>');
      });

      it('flag-ON with empty cross-channel XML and no history: historyMessages is [], crossChannelMessage is absent', () => {
        settingsState.realMessagesEnabled = true;
        const options = createBaseOptions();
        vi.mocked(mockContextWindowManager.selectAndSerializeHistory).mockReturnValue({
          serializedHistory: '',
          historyTokensUsed: 0,
          messagesIncluded: 0,
          messagesDropped: 0,
          crossChannelMessagesIncluded: 0,
          selectedEntries: [],
          crossChannelXml: '',
        });

        const preselected = budgetManager.preselectHistory(options);
        const result = budgetManager.allocate(options, preselected);

        expect(result.historyMessages).toEqual([]);
        expect(result.crossChannelMessage).toBeUndefined();
      });

      it('threads the SAME flag value to the base-measurement build and the shipped build', () => {
        settingsState.realMessagesEnabled = true;
        const options = createBaseOptions();

        budgetManager.allocate(options, budgetManager.preselectHistory(options));

        const calls = vi.mocked(mockPromptBuilder.buildSystemMessage).mock.calls;
        expect(calls.length).toBeGreaterThan(0);
        for (const [arg] of calls) {
          expect((arg as { realMessagesEnabled?: boolean }).realMessagesEnabled).toBe(true);
        }
      });
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
        .mocked(mockPromptBuilder.buildVolatilePrefix)
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
        .mocked(mockPromptBuilder.buildVolatilePrefix)
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
      selectedEntries: [],
      crossChannelXml: '',
      realMessagesEnabled: false,
      headerIdTags: new Map(),
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

    it('filters an EXACT-tie createdAt (=== oldestSelectedTs) unless the ID rescue keeps it', () => {
      // Strict `<` at the boundary: a tie temporally corresponds to shipped
      // content, so the time baseline does NOT keep it — only the id rescue
      // can (unshipped ids, same channel). An id-less tie is filtered.
      const kept = allocateAndCaptureFiltered(
        [mem('tie-rescued', CUTOFF, ['m-unshipped']), mem('tie-legacy', CUTOFF, undefined)],
        preselectedWith({ oldestSelectedTs: CUTOFF, shippedMessageIds: new Set(['s1']) })
      );
      expect(kept.map(m => m.metadata?.id)).toEqual(['tie-rescued']);
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
      // Sized so the REAL budget math (window 1450 − base 100 − msg 100 −
      // real memory reserve) fits exactly TWO entries: E1/E2 drop, E3/E4 ship.
      // The size has to come from actual content — selection measures the
      // rendered entry, so a declared tokenCount would size nothing.
      const bulk = 'lorem ipsum dolor sit amet consectetur adipiscing elit '.repeat(50);
      const entry = (n: number): Record<string, unknown> => ({
        id: `uuid-${n}`,
        discordMessageId: [`snowflake-${n}`],
        role: n % 2 === 0 ? 'assistant' : 'user',
        content: `message ${n} ${bulk}`,
        createdAt: new Date(1_000_000 + n * 60_000).toISOString(),
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
      const calls = vi.mocked(mockPromptBuilder.buildVolatilePrefix).mock.calls;
      const finalPromptArgs = calls[calls.length - 1][0] as {
        relevantMemories: MemoryDocument[];
      };
      expect(finalPromptArgs.relevantMemories.map(m => m.metadata?.id)).toEqual(['mem-e1']);
    });

    describe('the CHUNKED cut (§2.5) — selectedEntries<->memory-dedup still holds', () => {
      const bulk = 'lorem ipsum dolor sit amet consectetur adipiscing elit '.repeat(10);
      const entry = (n: number): Record<string, unknown> => ({
        id: `uuid-${n}`,
        discordMessageId: [`snowflake-${n}`],
        role: n % 2 === 0 ? 'assistant' : 'user',
        content: `message ${n} ${bulk}`,
        createdAt: new Date(1_000_000 + n * 60_000).toISOString(),
        // Persona/personality attribution widens the XML-form envelope
        // (`from=`/`t=` attributes) relative to a real-message header,
        // which is what makes the flag-on measure fit MORE entries under
        // the same budget — an id-less/name-less fixture (as the sibling
        // test above uses) renders near-identically in both forms and
        // hides the effect.
        personaName: n % 2 === 1 ? 'Vlad' : undefined,
        personalityName: n % 2 === 0 ? mockPersonality.name : undefined,
      });
      const ENTRY_COUNT = 40;

      afterEach(() => {
        settingsState.realMessagesEnabled = false;
      });

      function buildOptions(effectiveContextWindowTokens: number): BudgetAllocationOptions {
        return {
          personality: mockPersonality,
          processedPersonality: mockPersonality,
          participantPersonas: new Map(),
          context: {
            userId: 'user-123',
            channelId: 'channel-123',
            rawConversationHistory: Array.from({ length: ENTRY_COUNT }, (_, i) => entry(i + 1)),
          },
          userMessage: 'hello',
          processedAttachments: [],
          referencedMessagesDescriptions: undefined,
          effectiveContextWindowTokens,
        } as unknown as BudgetAllocationOptions;
      }

      it('drives the CHUNKED cut (not merely the minimal cut) — at least the entry floor ships, and some drop', () => {
        const realManager = new RealContextWindowManager();
        const manager = new ContentBudgetManager(mockPromptBuilder, realManager);
        vi.mocked(mockPromptBuilder.countTokens).mockReturnValue(100);
        const options = buildOptions(3500);

        const preselected = manager.preselectHistory(options);

        // Precondition for the seam cases below: this budget puts the window
        // into the trimming regime at all (some entries dropped) while still
        // shipping at least the entry floor. Note this pair of assertions does
        // NOT by itself distinguish a chunked cut from a minimal cut that
        // happens to leave >= floor — that distinction is pinned directly, on
        // `computeEvictionCut`, by the OSCILLATION and HYSTERESIS property
        // tests in ContextWindowManager.test.ts. What matters here is only
        // that the dedup seam is exercised against a POST-CUT shipped set.
        expect(preselected.messagesDropped).toBeGreaterThan(0);
        expect(preselected.messagesDropped).toBeLessThan(ENTRY_COUNT);
        expect(preselected.selectedEntries.length).toBeGreaterThanOrEqual(20);
      });

      it('(a) oldestSelectedTs/shippedMessageIds derive from the POST-CUT shipped set, not the fetched set', () => {
        const realManager = new RealContextWindowManager();
        const manager = new ContentBudgetManager(mockPromptBuilder, realManager);
        vi.mocked(mockPromptBuilder.countTokens).mockReturnValue(100);
        const options = buildOptions(3500);

        const preselected = manager.preselectHistory(options);
        const droppedCount = preselected.messagesDropped;

        // The chunk-evicted entries (the oldest `droppedCount` of them) are
        // absent from the shipped-id set.
        for (let i = 1; i <= droppedCount; i++) {
          expect(preselected.shippedMessageIds.has(`snowflake-${i}`)).toBe(false);
        }
        // The oldest SHIPPED entry's timestamp is the boundary.
        const oldestShippedIndex = droppedCount + 1;
        expect(preselected.oldestSelectedTs).toBe(1_000_000 + oldestShippedIndex * 60_000);
      });

      it('(b) filterShippedMemories KEEPS a memory predating the oldest shipped entry', () => {
        const realManager = new RealContextWindowManager();
        const manager = new ContentBudgetManager(mockPromptBuilder, realManager);
        vi.mocked(mockPromptBuilder.countTokens).mockReturnValue(100);
        const options = buildOptions(3500);
        const preselected = manager.preselectHistory(options);

        const predatingMemory: MemoryDocument = {
          pageContent: 'predates the boundary',
          metadata: {
            id: 'mem-predate',
            createdAt: (preselected.oldestSelectedTs as number) - 5_000,
            score: 0.9,
            channelId: 'channel-123',
          },
        };
        manager.allocate(
          { ...options, retrievedMemories: [predatingMemory], facts: [] },
          preselected
        );
        const calls = vi.mocked(mockPromptBuilder.buildVolatilePrefix).mock.calls;
        const finalPromptArgs = calls[calls.length - 1][0] as {
          relevantMemories: MemoryDocument[];
        };
        expect(finalPromptArgs.relevantMemories.map(m => m.metadata?.id)).toEqual(['mem-predate']);
      });

      it('(c) RESCUES a current-channel memory whose source messages were ALL evicted by the chunk cut', () => {
        const realManager = new RealContextWindowManager();
        const manager = new ContentBudgetManager(mockPromptBuilder, realManager);
        vi.mocked(mockPromptBuilder.countTokens).mockReturnValue(100);
        const options = buildOptions(3500);
        const preselected = manager.preselectHistory(options);

        // snowflake-1 is chunk-evicted (the first entries drop) — a memory of
        // it, stamped AFTER the boundary (persistence lag), must be rescued.
        const rescuedMemory: MemoryDocument = {
          pageContent: 'memory of an evicted entry',
          metadata: {
            id: 'mem-rescued',
            createdAt: (preselected.oldestSelectedTs as number) + 1_000,
            score: 0.9,
            messageIds: ['snowflake-1'],
            channelId: 'channel-123',
          },
        };
        manager.allocate(
          { ...options, retrievedMemories: [rescuedMemory], facts: [] },
          preselected
        );
        const calls = vi.mocked(mockPromptBuilder.buildVolatilePrefix).mock.calls;
        const finalPromptArgs = calls[calls.length - 1][0] as {
          relevantMemories: MemoryDocument[];
        };
        expect(finalPromptArgs.relevantMemories.map(m => m.metadata?.id)).toEqual(['mem-rescued']);
      });

      it('(d) DROPS a memory of a SHIPPED message', () => {
        const realManager = new RealContextWindowManager();
        const manager = new ContentBudgetManager(mockPromptBuilder, realManager);
        vi.mocked(mockPromptBuilder.countTokens).mockReturnValue(100);
        const options = buildOptions(3500);
        const preselected = manager.preselectHistory(options);

        const shippedId = `snowflake-${ENTRY_COUNT}`;
        expect(preselected.shippedMessageIds.has(shippedId)).toBe(true);
        const shippedMemory: MemoryDocument = {
          pageContent: 'memory of a shipped entry',
          metadata: {
            id: 'mem-shipped',
            createdAt: (preselected.oldestSelectedTs as number) + 1_000,
            score: 0.9,
            messageIds: [shippedId],
            channelId: 'channel-123',
          },
        };
        manager.allocate(
          { ...options, retrievedMemories: [shippedMemory], facts: [] },
          preselected
        );
        const calls = vi.mocked(mockPromptBuilder.buildVolatilePrefix).mock.calls;
        const finalPromptArgs = calls[calls.length - 1][0] as {
          relevantMemories: MemoryDocument[];
        };
        expect(finalPromptArgs.relevantMemories).toEqual([]);
      });

      it('RESCUES a memory of a render-skipped row flag-on — the row is not in the shipped set, so the dedup filter cannot claim it', () => {
        const realManager = new RealContextWindowManager();
        const manager = new ContentBudgetManager(mockPromptBuilder, realManager);
        vi.mocked(mockPromptBuilder.countTokens).mockReturnValue(100);
        settingsState.realMessagesEnabled = true;
        // Generous budget: nothing is budget-dropped; the empty-body assistant
        // row leaves the shipped set purely via the render-skip exclusion.
        const options = {
          ...buildOptions(100_000),
          context: {
            userId: 'user-123',
            channelId: 'channel-123',
            rawConversationHistory: [
              entry(1),
              {
                id: 'uuid-empty',
                discordMessageId: ['snowflake-render-skipped'],
                role: 'assistant',
                content: '',
                createdAt: new Date(1_000_000 + 90_000).toISOString(),
                personalityName: mockPersonality.name,
              },
              entry(3),
            ],
          },
        } as unknown as BudgetAllocationOptions;

        const preselected = manager.preselectHistory(options);
        expect(preselected.messagesDropped).toBe(0);
        expect(preselected.shippedMessageIds.has('snowflake-render-skipped')).toBe(false);

        const skippedRowMemory: MemoryDocument = {
          pageContent: 'memory of the render-skipped row',
          metadata: {
            id: 'mem-skipped-row',
            createdAt: (preselected.oldestSelectedTs as number) + 1_000,
            score: 0.9,
            messageIds: ['snowflake-render-skipped'],
            channelId: 'channel-123',
          },
        };
        manager.allocate(
          { ...options, retrievedMemories: [skippedRowMemory], facts: [] },
          preselected
        );
        const calls = vi.mocked(mockPromptBuilder.buildVolatilePrefix).mock.calls;
        const finalPromptArgs = calls[calls.length - 1][0] as {
          relevantMemories: MemoryDocument[];
        };
        // The row is invisible to the model, so its memory must be allowed to
        // backfill — kept, not dedup-dropped as "shipped".
        expect(finalPromptArgs.relevantMemories.map(m => m.metadata?.id)).toEqual([
          'mem-skipped-row',
        ]);
      });

      it("follows EACH flag polarity's OWN shipped set — the real-measure mode fits a different (larger) set under the same budget", () => {
        const realManager = new RealContextWindowManager();
        const manager = new ContentBudgetManager(mockPromptBuilder, realManager);
        vi.mocked(mockPromptBuilder.countTokens).mockReturnValue(100);
        const options = buildOptions(3500);

        settingsState.realMessagesEnabled = false;
        const preselectedOff = manager.preselectHistory(options);
        settingsState.realMessagesEnabled = true;
        const preselectedOn = manager.preselectHistory(options);

        // The real measure prices the same window lower, so flag-on fits a
        // strictly larger set under the same budget.
        expect(preselectedOn.messagesDropped).toBeLessThan(preselectedOff.messagesDropped);

        // Each polarity's dedup boundary follows its OWN shipped set — the
        // point of the case, and the reason the two are asserted separately
        // rather than against each other.
        for (const preselected of [preselectedOff, preselectedOn]) {
          const dropped = preselected.messagesDropped;
          expect(preselected.shippedMessageIds.size).toBe(ENTRY_COUNT - dropped);
          // Every evicted entry is absent from the shipped-id set…
          for (let i = 1; i <= dropped; i++) {
            expect(preselected.shippedMessageIds.has(`snowflake-${i}`)).toBe(false);
          }
          // …every surviving one is present…
          for (let i = dropped + 1; i <= ENTRY_COUNT; i++) {
            expect(preselected.shippedMessageIds.has(`snowflake-${i}`)).toBe(true);
          }
          // …and the time baseline is the oldest SHIPPED entry, not the
          // oldest fetched one.
          expect(preselected.oldestSelectedTs).toBe(1_000_000 + (dropped + 1) * 60_000);
        }
      });
    });
  });
});

describe('activeSpeakerPronouns', () => {
  const roster = new Map<string, ParticipantInfo>([
    [
      'persona-alice',
      {
        personaName: 'Alice',
        content: 'User persona',
        isActive: true,
        personaId: 'persona-alice',
        pronouns: 'she/her',
      },
    ],
  ]);

  it('returns the pronouns for a speaker present in the roster', () => {
    expect(activeSpeakerPronouns(roster, 'persona-alice')).toBe('she/her');
  });

  it('returns undefined for an undefined id', () => {
    expect(activeSpeakerPronouns(roster, undefined)).toBeUndefined();
  });

  it('returns undefined for an empty-string id', () => {
    expect(activeSpeakerPronouns(roster, '')).toBeUndefined();
  });

  it('returns undefined for a speaker absent from the roster', () => {
    expect(activeSpeakerPronouns(roster, 'persona-nobody')).toBeUndefined();
  });

  it('returns undefined when the speaker declares no pronouns', () => {
    const noPronouns = new Map<string, ParticipantInfo>([
      [
        'persona-bob',
        { personaName: 'Bob', content: 'User persona', isActive: true, personaId: 'persona-bob' },
      ],
    ]);
    expect(activeSpeakerPronouns(noPronouns, 'persona-bob')).toBeUndefined();
  });
});
