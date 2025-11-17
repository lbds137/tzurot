/**
 * Tests for ConversationalRAGService - Token Count Caching Usage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationalRAGService } from './ConversationalRAGService.js';
import type { ConversationContext } from './ConversationalRAGService.js';
import type { LoadedPersonality } from '@tzurot/common-types';
import { HumanMessage, AIMessage } from '@langchain/core/messages';

// Mock all dependencies
vi.mock('./LLMInvoker.js', () => {
  return {
    LLMInvoker: class {
      getModel = vi.fn().mockReturnValue({
        model: { invoke: vi.fn().mockResolvedValue({ content: 'Mock response' }) },
        modelName: 'test-model',
      });
      invokeWithRetry = vi.fn().mockResolvedValue({ content: 'Mock response' });
    },
  };
});

vi.mock('./MemoryRetriever.js', () => {
  return {
    MemoryRetriever: class {
      getAllParticipantPersonas = vi.fn().mockResolvedValue(new Map());
      retrieveRelevantMemories = vi.fn().mockResolvedValue([]);
      getUserPersonaForPersonality = vi.fn().mockResolvedValue('persona-123');
    },
  };
});

vi.mock('./PromptBuilder.js', () => {
  return {
    PromptBuilder: class {
      formatUserMessage = vi.fn().mockReturnValue({ text: 'Test message' });
      buildSearchQuery = vi.fn().mockReturnValue('Test query');
      buildFullSystemPrompt = vi.fn().mockReturnValue({ content: 'System prompt' });
      buildHumanMessage = vi.fn().mockReturnValue({
        message: new HumanMessage('Test message'),
        contentForStorage: 'Test message',
      });
      countTokens = vi.fn().mockReturnValue(10); // Default fallback
      countMemoryTokens = vi.fn().mockReturnValue(0);
    },
  };
});

vi.mock('./LongTermMemoryService.js', () => {
  return {
    LongTermMemoryService: class {
      storeInteraction = vi.fn().mockResolvedValue(undefined);
    },
  };
});

vi.mock('./ReferencedMessageFormatter.js', () => {
  return {
    ReferencedMessageFormatter: class {
      formatReferencedMessages = vi.fn().mockResolvedValue(undefined);
    },
  };
});

vi.mock('./MultimodalProcessor.js', () => ({
  processAttachments: vi.fn().mockResolvedValue([]),
}));

describe('ConversationalRAGService - Token Count Caching Usage', () => {
  let service: ConversationalRAGService;
  let mockPromptBuilder: any;

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
    contextWindowTokens: 8000, // Small context for testing
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
    vi.clearAllMocks();
    service = new ConversationalRAGService();
    mockPromptBuilder = (service as any).promptBuilder;
  });

  describe('Token Count Usage in Context Window Management', () => {
    it('should use cached token counts from rawConversationHistory instead of recomputing', async () => {
      // Setup: Create history with cached token counts
      const conversationHistory = [
        new HumanMessage('Message 1'),
        new AIMessage('Response 1'),
        new HumanMessage('Message 2'),
      ];

      const rawConversationHistory = [
        { role: 'user', content: 'Message 1', tokenCount: 5 },
        { role: 'assistant', content: 'Response 1', tokenCount: 8 },
        { role: 'user', content: 'Message 2', tokenCount: 6 },
      ];

      // Mock token counting to track calls
      const countTokensMock = mockPromptBuilder.countTokens;
      countTokensMock.mockReturnValue(100); // High fallback value to detect if called

      // Mock system prompt and current message token counts
      mockPromptBuilder.buildFullSystemPrompt.mockReturnValue({ content: 'System' });
      mockPromptBuilder.buildHumanMessage.mockReturnValue({
        message: new HumanMessage('Current message'),
        contentForStorage: 'Current message',
      });

      // Setup token count mocks
      countTokensMock
        .mockReturnValueOnce(1000) // System prompt
        .mockReturnValueOnce(500); // Current message

      const context: ConversationContext = {
        userId: 'user-123',
        conversationHistory,
        rawConversationHistory, // Provide cached token counts
      };

      await service.generateResponse(mockPersonality, { content: 'Hello' }, context);

      // Verify countTokens was called for system prompt and current message
      // but NOT for history messages (they use cached values)
      expect(countTokensMock).toHaveBeenCalledTimes(2);
      expect(countTokensMock).toHaveBeenNthCalledWith(1, 'System');
      expect(countTokensMock).toHaveBeenNthCalledWith(2, 'Current message');
    });

    it('should fall back to computing tokens when cached value is missing', async () => {
      const conversationHistory = [
        new HumanMessage('Old message without cache'),
        new AIMessage('Response'),
        new HumanMessage('New message with cache'),
      ];

      const rawConversationHistory = [
        { role: 'user', content: 'Old message without cache', tokenCount: undefined }, // No cache
        { role: 'assistant', content: 'Response', tokenCount: 8 }, // Has cache
        { role: 'user', content: 'New message with cache', tokenCount: 6 }, // Has cache
      ];

      const countTokensMock = vi.spyOn(mockPromptBuilder, 'countTokens');

      // Setup mocks
      mockPromptBuilder.buildFullSystemPrompt.mockReturnValue({ content: 'System' });
      mockPromptBuilder.buildHumanMessage.mockReturnValue({
        message: new HumanMessage('Current'),
        contentForStorage: 'Current',
      });

      countTokensMock
        .mockReturnValueOnce(1000) // System prompt
        .mockReturnValueOnce(500) // Current message
        .mockReturnValueOnce(12); // Fallback for old message without cache

      const context: ConversationContext = {
        userId: 'user-123',
        conversationHistory,
        rawConversationHistory,
      };

      await service.generateResponse(mockPersonality, { content: 'Hello' }, context);

      // Should call countTokens 3 times:
      // 1. System prompt
      // 2. Current message
      // 3. Old message (fallback because tokenCount is undefined)
      expect(countTokensMock).toHaveBeenCalledTimes(3);
    });

    it('should handle conversation history without rawConversationHistory (graceful degradation)', async () => {
      const conversationHistory = [
        new HumanMessage('Message 1'),
        new AIMessage('Response 1'),
      ];

      // No rawConversationHistory provided (backward compatibility)
      const context: ConversationContext = {
        userId: 'user-123',
        conversationHistory,
        // rawConversationHistory is undefined
      };

      const countTokensMock = vi.spyOn(mockPromptBuilder, 'countTokens');

      mockPromptBuilder.buildFullSystemPrompt.mockReturnValue({ content: 'System' });
      mockPromptBuilder.buildHumanMessage.mockReturnValue({
        message: new HumanMessage('Current'),
        contentForStorage: 'Current',
      });

      countTokensMock
        .mockReturnValueOnce(1000) // System prompt
        .mockReturnValueOnce(500) // Current message
        .mockReturnValueOnce(10) // Message 1 (fallback)
        .mockReturnValueOnce(15); // Response 1 (fallback)

      await service.generateResponse(mockPersonality, { content: 'Hello' }, context);

      // Should fall back to computing all history message tokens
      expect(countTokensMock).toHaveBeenCalledTimes(4);
    });

    it('should correctly budget context window using cached token counts', async () => {
      // Setup: Large history with cached token counts
      const conversationHistory = [];
      const rawConversationHistory = [];

      // Create 100 messages with known token counts
      for (let i = 0; i < 100; i++) {
        conversationHistory.push(new HumanMessage(`Message ${i}`));
        rawConversationHistory.push({
          role: 'user',
          content: `Message ${i}`,
          tokenCount: 50, // Each message is 50 tokens
        });
      }

      const countTokensMock = vi.spyOn(mockPromptBuilder, 'countTokens');

      mockPromptBuilder.buildFullSystemPrompt.mockReturnValue({ content: 'System' });
      mockPromptBuilder.buildHumanMessage.mockReturnValue({
        message: new HumanMessage('Current'),
        contentForStorage: 'Current',
      });

      countTokensMock
        .mockReturnValueOnce(2000) // System prompt
        .mockReturnValueOnce(500); // Current message

      const context: ConversationContext = {
        userId: 'user-123',
        conversationHistory,
        rawConversationHistory,
      };

      await service.generateResponse(mockPersonality, { content: 'Hello' }, context);

      // Context window: 8000 tokens
      // System: 2000, Current: 500, Memories: 0 = 2500 used
      // History budget: 8000 - 2500 = 5500 tokens
      // With 50 tokens per message: 5500 / 50 = 110 messages fit
      // But we only have 100 messages, so all should be included

      // Should NOT call countTokens for history (using cached values)
      // Only system prompt and current message
      expect(countTokensMock).toHaveBeenCalledTimes(2);
    });

    it('should respect history token budget and exclude old messages', async () => {
      const conversationHistory = [];
      const rawConversationHistory = [];

      // Create 200 messages (will exceed budget)
      for (let i = 0; i < 200; i++) {
        conversationHistory.push(new HumanMessage(`Message ${i}`));
        rawConversationHistory.push({
          role: 'user',
          content: `Message ${i}`,
          tokenCount: 100, // Each message is 100 tokens
        });
      }

      const countTokensMock = vi.spyOn(mockPromptBuilder, 'countTokens');

      mockPromptBuilder.buildFullSystemPrompt.mockReturnValue({ content: 'System' });
      mockPromptBuilder.buildHumanMessage.mockReturnValue({
        message: new HumanMessage('Current'),
        contentForStorage: 'Current',
      });

      countTokensMock
        .mockReturnValueOnce(2000) // System prompt
        .mockReturnValueOnce(500); // Current message

      const context: ConversationContext = {
        userId: 'user-123',
        conversationHistory,
        rawConversationHistory,
      };

      await service.generateResponse(mockPersonality, { content: 'Hello' }, context);

      // Context window: 8000 tokens
      // System: 2000, Current: 500 = 2500 used
      // History budget: 8000 - 2500 = 5500 tokens
      // With 100 tokens per message: 5500 / 100 = 55 messages fit
      // So 200 - 55 = 145 oldest messages should be excluded

      // Should use cached token counts, not recompute
      expect(countTokensMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('Performance Optimization Validation', () => {
    it('should avoid expensive token recomputation for large histories', async () => {
      // Setup: Simulate real-world scenario with 100 messages
      const conversationHistory = [];
      const rawConversationHistory = [];

      for (let i = 0; i < 100; i++) {
        const content = `This is message number ${i} with varying length content that could be quite long`;
        conversationHistory.push(
          i % 2 === 0 ? new HumanMessage(content) : new AIMessage(content)
        );
        rawConversationHistory.push({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content,
          tokenCount: 15 + (i % 10), // Varying token counts
        });
      }

      const countTokensMock = vi.spyOn(mockPromptBuilder, 'countTokens');

      mockPromptBuilder.buildFullSystemPrompt.mockReturnValue({ content: 'System' });
      mockPromptBuilder.buildHumanMessage.mockReturnValue({
        message: new HumanMessage('Current'),
        contentForStorage: 'Current',
      });

      countTokensMock
        .mockReturnValueOnce(2000) // System prompt
        .mockReturnValueOnce(500); // Current message

      const context: ConversationContext = {
        userId: 'user-123',
        conversationHistory,
        rawConversationHistory,
      };

      await service.generateResponse(mockPersonality, { content: 'Hello' }, context);

      // CRITICAL PERFORMANCE CHECK:
      // Without caching: Would call countTokens 102 times (system + current + 100 history)
      // With caching: Should only call 2 times (system + current)
      expect(countTokensMock).toHaveBeenCalledTimes(2);
    });
  });
});
