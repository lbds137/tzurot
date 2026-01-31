/**
 * Tests for ContentBudgetManager
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SystemMessage } from '@langchain/core/messages';
import { ContentBudgetManager } from './ContentBudgetManager.js';
import type { PromptBuilder } from './PromptBuilder.js';
import type { ContextWindowManager } from './context/ContextWindowManager.js';
import type { BudgetAllocationOptions, MemoryDocument } from './ConversationalRAGTypes.js';
import type { LoadedPersonality } from '@tzurot/common-types';

describe('ContentBudgetManager', () => {
  let mockPromptBuilder: PromptBuilder;
  let mockContextWindowManager: ContextWindowManager;
  let budgetManager: ContentBudgetManager;

  const mockPersonality: LoadedPersonality = {
    id: 'test-personality-id',
    name: 'TestBot',
    systemPrompt: 'You are a helpful assistant',
    model: 'gpt-4',
    contextWindowTokens: 8000,
    isActive: true,
    ownerId: 'owner-123',
    createdAt: new Date(),
    updatedAt: new Date(),
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
      calculateHistoryBudget: vi.fn().mockReturnValue(500),
      selectAndSerializeHistory: vi.fn().mockReturnValue({
        serializedHistory: '',
        historyTokensUsed: 0,
        messagesIncluded: 0,
        messagesDropped: 0,
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
    });

    it('should return budget allocation result with all required fields', () => {
      const options = createBaseOptions();

      const result = budgetManager.allocate(options);

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

      budgetManager.allocate(options);

      expect(mockPromptBuilder.buildHumanMessage).toHaveBeenCalledWith(
        'Hello, how are you?',
        [],
        undefined,
        undefined,
        undefined
      );
    });

    it('should use default context window tokens when not specified', () => {
      const options = createBaseOptions();
      options.personality = { ...mockPersonality, contextWindowTokens: undefined };

      budgetManager.allocate(options);

      // Should use AI_DEFAULTS.CONTEXT_WINDOW_TOKENS (128000)
      expect(mockContextWindowManager.calculateMemoryBudget).toHaveBeenCalled();
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

      const result = budgetManager.allocate(options);

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
      });

      const result = budgetManager.allocate(options);

      expect(mockContextWindowManager.selectAndSerializeHistory).toHaveBeenCalled();
      expect(result.serializedHistory).toBe('Serialized history content');
      expect(result.historyTokensUsed).toBe(150);
      expect(result.messagesDropped).toBe(0);
    });

    it('should build final system prompt with memories and history', () => {
      const options = createBaseOptions();

      budgetManager.allocate(options);

      // buildFullSystemPrompt should be called 3 times:
      // 1. Base system prompt (for token counting)
      // 2. With memories (for history budget calculation)
      // 3. Final with memories AND history
      expect(mockPromptBuilder.buildFullSystemPrompt).toHaveBeenCalledTimes(3);
    });

    it('should pass participant personas to system prompt builder', () => {
      const options = createBaseOptions();
      options.participantPersonas = new Map([
        ['Alice', { content: 'User persona', isActive: true }],
      ]);

      budgetManager.allocate(options);

      expect(mockPromptBuilder.buildFullSystemPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          participantPersonas: options.participantPersonas,
        })
      );
    });

    it('should pass referenced messages to system prompt builder', () => {
      const options = createBaseOptions();
      options.referencedMessagesDescriptions = 'Referenced: Some quoted message';

      budgetManager.allocate(options);

      expect(mockPromptBuilder.buildFullSystemPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          referencedMessagesFormatted: 'Referenced: Some quoted message',
        })
      );
    });

    it('should pass user timezone for memory selection', () => {
      const options = createBaseOptions();
      options.context.userTimezone = 'America/New_York';

      budgetManager.allocate(options);

      expect(mockContextWindowManager.selectMemoriesWithinBudget).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'America/New_York'
      );
    });

    it('should return content for storage from prompt builder', () => {
      vi.mocked(mockPromptBuilder.buildHumanMessage).mockReturnValue({
        message: { content: 'Message content' },
        contentForStorage: 'Clean content for LTM storage',
      });

      const options = createBaseOptions();

      const result = budgetManager.allocate(options);

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

      const result = budgetManager.allocate(options);

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
      });

      const result = budgetManager.allocate(options);

      expect(result.messagesDropped).toBe(2);
    });
  });
});
