/**
 * Tests for ConversationalRAGService
 *
 * Unit tests for the RAG orchestration service that coordinates:
 * - LLMInvoker: Model management and invocation
 * - MemoryRetriever: LTM queries and persona lookups
 * - PromptBuilder: System prompt construction
 * - LongTermMemoryService: pgvector storage
 * - MultimodalProcessor: Attachment processing (vision/transcription)
 * - ReferencedMessageFormatter: Reference formatting
 * - ContextWindowManager: Token budgeting
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConversationalRAGService } from './ConversationalRAGService.js';
import type { MemoryDocument } from './ConversationalRAGService.js';
import type { AttachmentMetadata, ReferencedMessage } from '@tzurot/common-types';
import { CONTENT_TYPES, AttachmentType } from '@tzurot/common-types';

// Set up mocks using async factories (vi.mock is hoisted before imports)
vi.mock('./LLMInvoker.js', async () => {
  const { mockLLMInvoker } = await import('../test/mocks/LLMInvoker.mock.js');
  return mockLLMInvoker;
});
vi.mock('./MemoryRetriever.js', async () => {
  const { mockMemoryRetriever } = await import('../test/mocks/MemoryRetriever.mock.js');
  return mockMemoryRetriever;
});
vi.mock('./PromptBuilder.js', async () => {
  const { mockPromptBuilder } = await import('../test/mocks/PromptBuilder.mock.js');
  return mockPromptBuilder;
});
vi.mock('./context/ContextWindowManager.js', async () => {
  const { mockContextWindowManager } = await import('../test/mocks/ContextWindowManager.mock.js');
  return mockContextWindowManager;
});
vi.mock('./LongTermMemoryService.js', async () => {
  const { mockLongTermMemoryService } = await import('../test/mocks/LongTermMemoryService.mock.js');
  return mockLongTermMemoryService;
});
vi.mock('./ReferencedMessageFormatter.js', async () => {
  const { mockReferencedMessageFormatter } =
    await import('../test/mocks/ReferencedMessageFormatter.mock.js');
  return mockReferencedMessageFormatter;
});
vi.mock('./MultimodalProcessor.js', async () => {
  const { mockMultimodalProcessor } = await import('../test/mocks/utils.mock.js');
  return mockMultimodalProcessor;
});
vi.mock('../utils/responseCleanup.js', async () => {
  const { mockResponseCleanup } = await import('../test/mocks/utils.mock.js');
  return mockResponseCleanup;
});
vi.mock('../utils/promptPlaceholders.js', async () => {
  const { mockPromptPlaceholders } = await import('../test/mocks/utils.mock.js');
  return mockPromptPlaceholders;
});
vi.mock('../utils/errorHandling.js', async () => {
  const { mockErrorHandling } = await import('../test/mocks/utils.mock.js');
  return mockErrorHandling;
});
vi.mock('./UserReferenceResolver.js', async () => {
  const { mockUserReferenceResolver } = await import('../test/mocks/UserReferenceResolver.mock.js');
  return mockUserReferenceResolver;
});
vi.mock('../redis.js', () => ({
  redisService: {
    isIncognitoActive: vi.fn().mockResolvedValue(false),
  },
}));

// Import mock accessors and fixtures (after vi.mock declarations)
import {
  getLLMInvokerMock,
  getMemoryRetrieverMock,
  getPromptBuilderMock,
  getContextWindowManagerMock,
  getLongTermMemoryServiceMock,
  getReferencedMessageFormatterMock,
  getUserReferenceResolverMock,
  mockProcessAttachments,
  mockReplacePromptPlaceholders,
  createMockPersonality,
  createMockContext,
  resetAllMocks,
} from '../test/mocks/index.js';

describe('ConversationalRAGService', () => {
  let service: ConversationalRAGService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default mock implementations after mockReset clears them
    resetAllMocks();
    // Create service - this populates the mock instances via constructors
    service = new ConversationalRAGService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('RAG service orchestration', () => {
    it('should orchestrate the full RAG flow and return response', async () => {
      const personality = createMockPersonality();
      const context = createMockContext();

      const result = await service.generateResponse(personality, 'Hello', context);

      expect(result).toMatchObject({
        content: 'AI response',
        retrievedMemories: 0,
        modelUsed: 'test-model',
      });
    });

    it('should format user message via PromptBuilder', async () => {
      const personality = createMockPersonality();
      const context = createMockContext();

      await service.generateResponse(personality, 'Test message', context);

      expect(getPromptBuilderMock().formatUserMessage).toHaveBeenCalledWith(
        'Test message',
        context
      );
    });

    it('should retrieve relevant memories via MemoryRetriever', async () => {
      const personality = createMockPersonality();
      const context = createMockContext();

      await service.generateResponse(personality, 'Test message', context);

      expect(getMemoryRetrieverMock().retrieveRelevantMemories).toHaveBeenCalledWith(
        personality,
        'search query',
        context
      );
    });

    it('should build context window via ContextWindowManager', async () => {
      const personality = createMockPersonality();
      const context = createMockContext();

      await service.generateResponse(personality, 'Test message', context);

      expect(getContextWindowManagerMock().calculateHistoryBudget).toHaveBeenCalled();
      expect(getContextWindowManagerMock().selectAndSerializeHistory).toHaveBeenCalled();
    });

    it('should invoke LLM via LLMInvoker', async () => {
      const personality = createMockPersonality();
      const context = createMockContext();

      await service.generateResponse(personality, 'Test message', context);

      expect(getLLMInvokerMock().invokeWithRetry).toHaveBeenCalled();
    });

    it('should return model name in response', async () => {
      const personality = createMockPersonality();
      const context = createMockContext();

      const result = await service.generateResponse(personality, 'Test', context);

      expect(result.modelUsed).toBe('test-model');
    });
  });

  describe('memory retrieval integration', () => {
    it('should pass retrieved memories to prompt builder', async () => {
      const memories: MemoryDocument[] = [
        { pageContent: 'Memory 1', metadata: { id: 'm1' } },
        { pageContent: 'Memory 2', metadata: { id: 'm2' } },
      ];
      getMemoryRetrieverMock().retrieveRelevantMemories.mockResolvedValue({
        memories,
        focusModeEnabled: false,
      });

      const personality = createMockPersonality();
      const context = createMockContext();

      const result = await service.generateResponse(personality, 'Recall something', context);

      expect(getPromptBuilderMock().buildFullSystemPrompt).toHaveBeenCalledWith({
        personality,
        participantPersonas: expect.any(Map),
        relevantMemories: memories,
        context,
        referencedMessagesFormatted: undefined,
        serializedHistory: expect.anything(),
      });
      expect(result.retrievedMemories).toBe(2);
    });

    it('should include participant personas in system prompt', async () => {
      const participantMap = new Map([
        ['user-123', { personaId: 'persona-1', personaName: 'Alice', isActive: true }],
      ]);
      getMemoryRetrieverMock().getAllParticipantPersonas.mockResolvedValue(participantMap);

      const personality = createMockPersonality();
      const context = createMockContext();

      await service.generateResponse(personality, 'Hello', context);

      expect(getPromptBuilderMock().buildFullSystemPrompt).toHaveBeenCalledWith({
        personality,
        participantPersonas: participantMap,
        relevantMemories: expect.any(Array),
        context,
        referencedMessagesFormatted: undefined,
        serializedHistory: expect.anything(),
      });
    });

    it('should handle empty memory results gracefully', async () => {
      getMemoryRetrieverMock().retrieveRelevantMemories.mockResolvedValue({
        memories: [],
        focusModeEnabled: false,
      });

      const personality = createMockPersonality();
      const context = createMockContext();

      const result = await service.generateResponse(personality, 'New topic', context);

      expect(result.retrievedMemories).toBe(0);
      expect(result.content).toBe('AI response');
    });
  });

  describe('LTM storage integration', () => {
    it('should store interaction to LTM when persona exists', async () => {
      getMemoryRetrieverMock().getUserPersonaForPersonality.mockResolvedValue({
        personaId: 'persona-123',
        shareLtmAcrossPersonalities: false,
      });

      const personality = createMockPersonality();
      const context = createMockContext();

      await service.generateResponse(personality, 'Remember this', context);

      expect(getLongTermMemoryServiceMock().storeInteraction).toHaveBeenCalledWith(
        personality,
        'content for storage',
        'AI response',
        context,
        'persona-123'
      );
    });

    it('should skip LTM storage when no persona found', async () => {
      getMemoryRetrieverMock().resolvePersonaForMemory.mockResolvedValue(null);

      const personality = createMockPersonality();
      const context = createMockContext();

      await service.generateResponse(personality, 'Test', context);

      expect(getLongTermMemoryServiceMock().storeInteraction).not.toHaveBeenCalled();
    });

    it('should store LTM with shareLtmAcrossPersonalities enabled', async () => {
      getMemoryRetrieverMock().resolvePersonaForMemory.mockResolvedValue({
        personaId: 'persona-456',
        shareLtmAcrossPersonalities: true,
      });

      const personality = createMockPersonality();
      const context = createMockContext();

      await service.generateResponse(personality, 'Test', context);

      expect(getLongTermMemoryServiceMock().storeInteraction).toHaveBeenCalledWith(
        personality,
        'content for storage',
        'AI response',
        context,
        'persona-456'
      );
    });

    it('should return userMessageContent for bot-client storage', async () => {
      const personality = createMockPersonality();
      const context = createMockContext();

      const result = await service.generateResponse(personality, 'Test', context);

      expect(result.userMessageContent).toBe('content for storage');
    });

    it('should skip LTM storage when incognito mode is active', async () => {
      // Import the mock to control it
      const { redisService } = await import('../redis.js');
      vi.mocked(redisService.isIncognitoActive).mockResolvedValue(true);

      getMemoryRetrieverMock().resolvePersonaForMemory.mockResolvedValue({
        personaId: 'persona-123',
        shareLtmAcrossPersonalities: false,
      });

      const personality = createMockPersonality();
      const context = createMockContext();

      const result = await service.generateResponse(personality, 'Test', context);

      // LTM storage should NOT have been called
      expect(getLongTermMemoryServiceMock().storeInteraction).not.toHaveBeenCalled();
      // Response should indicate incognito mode was active
      expect(result.incognitoModeActive).toBe(true);

      // Reset mock to default
      vi.mocked(redisService.isIncognitoActive).mockResolvedValue(false);
    });

    it('should return incognitoModeActive false when not in incognito', async () => {
      const personality = createMockPersonality();
      const context = createMockContext();

      const result = await service.generateResponse(personality, 'Test', context);

      expect(result.incognitoModeActive).toBe(false);
    });

    it('should defer memory storage when skipMemoryStorage is true', async () => {
      getMemoryRetrieverMock().resolvePersonaForMemory.mockResolvedValue({
        personaId: 'persona-123',
        shareLtmAcrossPersonalities: false,
      });

      const personality = createMockPersonality();
      const context = createMockContext();

      const result = await service.generateResponse(personality, 'Test', context, {
        skipMemoryStorage: true,
      });

      // Memory should NOT be stored immediately
      expect(getLongTermMemoryServiceMock().storeInteraction).not.toHaveBeenCalled();

      // But deferredMemoryData should be populated
      expect(result.deferredMemoryData).toBeDefined();
      expect(result.deferredMemoryData?.personaId).toBe('persona-123');
      expect(result.deferredMemoryData?.responseContent).toBe('AI response');
      expect(result.deferredMemoryData?.contentForEmbedding).toBe('content for storage');
    });

    it('should store memory immediately when skipMemoryStorage is false (default)', async () => {
      getMemoryRetrieverMock().resolvePersonaForMemory.mockResolvedValue({
        personaId: 'persona-123',
        shareLtmAcrossPersonalities: false,
      });

      const personality = createMockPersonality();
      const context = createMockContext();

      const result = await service.generateResponse(personality, 'Test', context, {
        skipMemoryStorage: false,
      });

      // Memory should be stored immediately
      expect(getLongTermMemoryServiceMock().storeInteraction).toHaveBeenCalledOnce();

      // deferredMemoryData should NOT be populated
      expect(result.deferredMemoryData).toBeUndefined();
    });

    it('should not return deferredMemoryData when incognito mode is active', async () => {
      const { redisService } = await import('../redis.js');
      vi.mocked(redisService.isIncognitoActive).mockResolvedValue(true);

      getMemoryRetrieverMock().resolvePersonaForMemory.mockResolvedValue({
        personaId: 'persona-123',
        shareLtmAcrossPersonalities: false,
      });

      const personality = createMockPersonality();
      const context = createMockContext();

      const result = await service.generateResponse(personality, 'Test', context, {
        skipMemoryStorage: true,
      });

      // Even with skipMemoryStorage: true, no deferredMemoryData when incognito
      expect(result.deferredMemoryData).toBeUndefined();
      expect(result.incognitoModeActive).toBe(true);

      // Reset mock
      vi.mocked(redisService.isIncognitoActive).mockResolvedValue(false);
    });

    it('should not return deferredMemoryData when no persona found', async () => {
      getMemoryRetrieverMock().resolvePersonaForMemory.mockResolvedValue(null);

      const personality = createMockPersonality();
      const context = createMockContext();

      const result = await service.generateResponse(personality, 'Test', context, {
        skipMemoryStorage: true,
      });

      // No persona = no memory data
      expect(result.deferredMemoryData).toBeUndefined();
      expect(getLongTermMemoryServiceMock().storeInteraction).not.toHaveBeenCalled();
    });
  });

  describe('storeDeferredMemory', () => {
    it('should store memory using deferred data', async () => {
      const personality = createMockPersonality();
      const context = createMockContext();
      const deferredData = {
        contentForEmbedding: 'user message content',
        responseContent: 'AI response content',
        personaId: 'persona-456',
      };

      await service.storeDeferredMemory(personality, context, deferredData);

      expect(getLongTermMemoryServiceMock().storeInteraction).toHaveBeenCalledWith(
        personality,
        'user message content',
        'AI response content',
        context,
        'persona-456'
      );
    });
  });

  describe('referenced messages included in LTM search query', () => {
    it('should format referenced messages when present', async () => {
      const referencedMessages: ReferencedMessage[] = [
        {
          id: 'ref-1',
          authorId: 'author-1',
          authorName: 'Alice',
          content: 'Original message content',
          timestamp: Date.now(),
          referenceType: 'reply',
        },
      ];
      const context = createMockContext({ referencedMessages });
      const personality = createMockPersonality();

      await service.generateResponse(personality, 'Reply to this', context);

      // Includes preprocessedAttachments (undefined) and userApiKey (undefined) for BYOK support
      expect(getReferencedMessageFormatterMock().formatReferencedMessages).toHaveBeenCalledWith(
        referencedMessages,
        personality,
        false,
        undefined,
        undefined
      );
    });

    it('should extract text from references for memory search', async () => {
      const referencedMessages: ReferencedMessage[] = [
        {
          id: 'ref-1',
          authorId: 'author-1',
          authorName: 'Bob',
          content: 'Context from referenced message',
          timestamp: Date.now(),
          referenceType: 'link',
        },
      ];
      const context = createMockContext({ referencedMessages });
      const personality = createMockPersonality();

      await service.generateResponse(personality, 'What about this?', context);

      expect(getReferencedMessageFormatterMock().extractTextForSearch).toHaveBeenCalledWith(
        'formatted references'
      );
    });

    it('should include reference text in search query', async () => {
      const referencedMessages: ReferencedMessage[] = [
        {
          id: 'ref-1',
          authorId: 'author-1',
          authorName: 'Carol',
          content: 'Referenced content',
          timestamp: Date.now(),
          referenceType: 'reply',
        },
      ];
      const context = createMockContext({ referencedMessages });
      const personality = createMockPersonality();

      await service.generateResponse(personality, 'Follow up', context);

      expect(getPromptBuilderMock().buildSearchQuery).toHaveBeenCalledWith(
        'formatted user message',
        expect.any(Array),
        'reference text for search',
        undefined
      );
    });

    it('should include formatted references in system prompt', async () => {
      const referencedMessages: ReferencedMessage[] = [
        {
          id: 'ref-1',
          authorId: 'author-1',
          authorName: 'Dave',
          content: 'Important context',
          timestamp: Date.now(),
          referenceType: 'reply',
        },
      ];
      const context = createMockContext({ referencedMessages });
      const personality = createMockPersonality();

      await service.generateResponse(personality, 'Respond to Dave', context);

      expect(getPromptBuilderMock().buildFullSystemPrompt).toHaveBeenCalledWith({
        personality,
        participantPersonas: expect.any(Map),
        relevantMemories: expect.any(Array),
        context,
        referencedMessagesFormatted: 'formatted references',
        serializedHistory: expect.anything(),
      });
    });

    it('should not format references when none present', async () => {
      const context = createMockContext({ referencedMessages: undefined });
      const personality = createMockPersonality();

      await service.generateResponse(personality, 'Hello', context);

      expect(getReferencedMessageFormatterMock().formatReferencedMessages).not.toHaveBeenCalled();
    });

    it('should not format references when array is empty', async () => {
      const context = createMockContext({ referencedMessages: [] });
      const personality = createMockPersonality();

      await service.generateResponse(personality, 'Hello', context);

      expect(getReferencedMessageFormatterMock().formatReferencedMessages).not.toHaveBeenCalled();
    });
  });

  describe('media content (images/audio) included in LTM search query', () => {
    it('should process image attachments', async () => {
      const attachments: AttachmentMetadata[] = [
        {
          url: 'https://example.com/image.png',
          contentType: CONTENT_TYPES.IMAGE_PNG,
          name: 'photo.png',
          size: 1024,
        },
      ];
      const context = createMockContext({ attachments });
      const personality = createMockPersonality();

      await service.generateResponse(personality, 'What is this?', context);

      // Includes isGuestMode (false) and userApiKey (undefined) for BYOK support
      expect(mockProcessAttachments).toHaveBeenCalledWith(
        attachments,
        personality,
        false,
        undefined
      );
    });

    it('should process audio attachments', async () => {
      const attachments: AttachmentMetadata[] = [
        {
          url: 'https://example.com/audio.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          name: 'voice.ogg',
          size: 2048,
          isVoiceMessage: true,
          duration: 5.5,
        },
      ];
      const context = createMockContext({ attachments });
      const personality = createMockPersonality();

      await service.generateResponse(personality, '', context);

      // Includes isGuestMode (false) and userApiKey (undefined) for BYOK support
      expect(mockProcessAttachments).toHaveBeenCalledWith(
        attachments,
        personality,
        false,
        undefined
      );
    });

    it('should include processed attachments in search query', async () => {
      const processedAttachments = [
        {
          type: AttachmentType.Image,
          description: 'A photo of a cat',
          metadata: { url: 'https://example.com/cat.png', name: 'cat.png' },
        },
      ];
      mockProcessAttachments.mockResolvedValue(processedAttachments);

      const attachments: AttachmentMetadata[] = [
        {
          url: 'https://example.com/cat.png',
          contentType: CONTENT_TYPES.IMAGE_PNG,
          name: 'cat.png',
          size: 1024,
        },
      ];
      const context = createMockContext({ attachments });
      const personality = createMockPersonality();

      await service.generateResponse(personality, 'What do you see?', context);

      expect(getPromptBuilderMock().buildSearchQuery).toHaveBeenCalledWith(
        'formatted user message',
        processedAttachments,
        undefined,
        undefined
      );
    });

    it('should include processed attachments in human message', async () => {
      const processedAttachments = [
        {
          type: AttachmentType.Audio,
          description: 'User says hello in the voice message',
          metadata: {
            url: 'https://example.com/voice.ogg',
            name: 'voice.ogg',
            isVoiceMessage: true,
            duration: 2.0,
          },
        },
      ];
      mockProcessAttachments.mockResolvedValue(processedAttachments);

      const attachments: AttachmentMetadata[] = [
        {
          url: 'https://example.com/voice.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          name: 'voice.ogg',
          size: 2048,
          isVoiceMessage: true,
          duration: 2.0,
        },
      ];
      const context = createMockContext({ attachments });
      const personality = createMockPersonality();

      await service.generateResponse(personality, '', context);

      expect(getPromptBuilderMock().buildHumanMessage).toHaveBeenCalledWith(
        'formatted user message',
        processedAttachments,
        undefined,
        undefined,
        undefined
      );
    });

    it('should return attachment descriptions in response', async () => {
      const processedAttachments = [
        {
          type: AttachmentType.Image,
          description: 'A beautiful sunset',
          metadata: { url: 'https://example.com/sunset.jpg', name: 'sunset.jpg' },
        },
      ];
      mockProcessAttachments.mockResolvedValue(processedAttachments);

      const attachments: AttachmentMetadata[] = [
        {
          url: 'https://example.com/sunset.jpg',
          contentType: CONTENT_TYPES.IMAGE_JPG,
          name: 'sunset.jpg',
          size: 5000,
        },
      ];
      const context = createMockContext({ attachments });
      const personality = createMockPersonality();

      const result = await service.generateResponse(personality, 'Describe', context);

      expect(result.attachmentDescriptions).toContain('sunset.jpg');
      expect(result.attachmentDescriptions).toContain('A beautiful sunset');
    });

    it('should not process attachments when none present', async () => {
      const context = createMockContext({ attachments: undefined });
      const personality = createMockPersonality();

      await service.generateResponse(personality, 'No attachments', context);

      expect(mockProcessAttachments).not.toHaveBeenCalled();
    });

    it('should not process attachments when array is empty', async () => {
      const context = createMockContext({ attachments: [] });
      const personality = createMockPersonality();

      await service.generateResponse(personality, 'Empty attachments', context);

      expect(mockProcessAttachments).not.toHaveBeenCalled();
    });

    it('should use preprocessed attachments instead of calling processAttachments', async () => {
      const preprocessedAttachments = [
        {
          type: AttachmentType.Image,
          description: 'A scenic mountain landscape from preprocessing job',
          originalUrl: 'https://example.com/image.png',
          metadata: {
            url: 'https://example.com/image.png',
            name: 'image.png',
            contentType: CONTENT_TYPES.IMAGE_PREFIX + '/png',
            size: 1000,
          },
        },
      ];

      const context = createMockContext({
        attachments: [
          {
            url: 'https://example.com/image.png',
            name: 'image.png',
            contentType: CONTENT_TYPES.IMAGE_PREFIX + '/png',
            size: 1000,
          },
        ],
        preprocessedAttachments,
      });
      const personality = createMockPersonality();

      await service.generateResponse(personality, 'Check this image', context);

      expect(mockProcessAttachments).not.toHaveBeenCalled();
      expect(getPromptBuilderMock().buildSearchQuery).toHaveBeenCalledWith(
        expect.any(String),
        preprocessedAttachments,
        undefined,
        undefined
      );
    });

    it('should process extended context image attachments without errors', async () => {
      const preprocessedExtendedContextAttachments = [
        {
          type: AttachmentType.Image,
          description: 'A cat sitting on a couch',
          originalUrl: 'https://example.com/cat.jpg',
          metadata: {
            url: 'https://example.com/cat.jpg',
            name: 'cat.jpg',
            contentType: CONTENT_TYPES.IMAGE_PREFIX + '/jpeg',
            size: 2000,
          },
        },
        {
          type: AttachmentType.Image,
          description: 'A dog playing in the park',
          originalUrl: 'https://example.com/dog.jpg',
          metadata: {
            url: 'https://example.com/dog.jpg',
            name: 'dog.jpg',
            contentType: CONTENT_TYPES.IMAGE_PREFIX + '/jpeg',
            size: 3000,
          },
        },
      ];

      const context = createMockContext({
        preprocessedExtendedContextAttachments,
      });
      const personality = createMockPersonality();

      // Should not throw and should complete normally
      const result = await service.generateResponse(
        personality,
        'What images did you see?',
        context
      );

      expect(result.content).toBe('AI response');
    });

    it('should handle empty extended context attachments gracefully', async () => {
      const context = createMockContext({
        preprocessedExtendedContextAttachments: [],
      });
      const personality = createMockPersonality();

      const result = await service.generateResponse(personality, 'No images', context);

      expect(result.content).toBe('AI response');
    });
  });

  describe('censored response retry behavior in full RAG flow', () => {
    it('should delegate retry logic to LLMInvoker', async () => {
      const personality = createMockPersonality();
      const context = createMockContext();

      await service.generateResponse(personality, 'Test', context);

      expect(getLLMInvokerMock().invokeWithRetry).toHaveBeenCalled();
    });

    it('should pass correct model parameters to LLMInvoker', async () => {
      const personality = createMockPersonality({ model: 'claude-3-sonnet', temperature: 0.9 });
      const context = createMockContext();

      await service.generateResponse(personality, 'Test', context);

      expect(getLLMInvokerMock().getModel).toHaveBeenCalledWith(
        expect.objectContaining({
          modelName: 'claude-3-sonnet',
          apiKey: undefined,
          temperature: 0.9,
        })
      );
    });

    it('should pass user API key when provided', async () => {
      const personality = createMockPersonality();
      const context = createMockContext();
      const userApiKey = 'user-api-key-123';

      await service.generateResponse(personality, 'Test', context, { userApiKey });

      expect(getLLMInvokerMock().getModel).toHaveBeenCalledWith(
        expect.objectContaining({
          modelName: 'test-model',
          apiKey: userApiKey,
          temperature: 0.7,
        })
      );
    });

    it('should pass all sampling parameters to LLMInvoker', async () => {
      const personality = createMockPersonality({
        model: 'claude-3-sonnet',
        temperature: 0.8,
        topP: 0.95,
        topK: 50,
        frequencyPenalty: 0.5,
        presencePenalty: 0.3,
        repetitionPenalty: 1.1,
        maxTokens: 4096,
      });
      const context = createMockContext();

      await service.generateResponse(personality, 'Test', context);

      expect(getLLMInvokerMock().getModel).toHaveBeenCalledWith(
        expect.objectContaining({
          modelName: 'claude-3-sonnet',
          temperature: 0.8,
          topP: 0.95,
          topK: 50,
          frequencyPenalty: 0.5,
          presencePenalty: 0.3,
          repetitionPenalty: 1.1,
          maxTokens: 4096,
        })
      );
    });

    it('should pass advanced sampling parameters to LLMInvoker', async () => {
      const personality = createMockPersonality({
        model: 'openrouter/deepseek-r1',
        minP: 0.1,
        topA: 0.5,
        seed: 42,
      });
      const context = createMockContext();

      await service.generateResponse(personality, 'Test', context);

      expect(getLLMInvokerMock().getModel).toHaveBeenCalledWith(
        expect.objectContaining({
          modelName: 'openrouter/deepseek-r1',
          minP: 0.1,
          topA: 0.5,
          seed: 42,
        })
      );
    });

    it('should pass reasoning config for thinking models', async () => {
      const personality = createMockPersonality({
        model: 'openrouter/deepseek-r1',
        reasoning: {
          effort: 'high',
          enabled: true,
        },
        showThinking: true,
      });
      const context = createMockContext();

      await service.generateResponse(personality, 'Test', context);

      expect(getLLMInvokerMock().getModel).toHaveBeenCalledWith(
        expect.objectContaining({
          modelName: 'openrouter/deepseek-r1',
          reasoning: {
            effort: 'high',
            enabled: true,
          },
          showThinking: true,
        })
      );
    });

    it('should pass OpenRouter-specific parameters to LLMInvoker', async () => {
      const personality = createMockPersonality({
        model: 'openrouter/gpt-4o',
        transforms: ['middle-out'],
        route: 'fallback',
        verbosity: 'high',
      });
      const context = createMockContext();

      await service.generateResponse(personality, 'Test', context);

      expect(getLLMInvokerMock().getModel).toHaveBeenCalledWith(
        expect.objectContaining({
          modelName: 'openrouter/gpt-4o',
          transforms: ['middle-out'],
          route: 'fallback',
          verbosity: 'high',
        })
      );
    });

    it('should pass image and audio counts for timeout calculation', async () => {
      const attachments: AttachmentMetadata[] = [
        {
          url: 'https://example.com/img1.png',
          contentType: CONTENT_TYPES.IMAGE_PNG,
          name: 'img1.png',
          size: 1000,
        },
        {
          url: 'https://example.com/img2.png',
          contentType: CONTENT_TYPES.IMAGE_PNG,
          name: 'img2.png',
          size: 1000,
        },
        {
          url: 'https://example.com/voice.ogg',
          contentType: CONTENT_TYPES.AUDIO_OGG,
          name: 'voice.ogg',
          size: 2000,
          isVoiceMessage: true,
        },
      ];
      const context = createMockContext({ attachments });
      const personality = createMockPersonality();

      await service.generateResponse(personality, '', context);

      expect(getLLMInvokerMock().invokeWithRetry).toHaveBeenCalledWith({
        model: expect.anything(),
        messages: expect.any(Array),
        modelName: 'test-model',
        imageCount: 2,
        audioCount: 1,
        stopSequences: expect.any(Array),
      });
    });

    it('should propagate LLMInvoker errors', async () => {
      getLLMInvokerMock().invokeWithRetry.mockRejectedValue(new Error('All retries exhausted'));

      const personality = createMockPersonality();
      const context = createMockContext();

      await expect(service.generateResponse(personality, 'Test', context)).rejects.toThrow(
        'All retries exhausted'
      );
    });
  });

  describe('name collision disambiguation', () => {
    it('should pass discordUsername to replacePromptPlaceholders for response cleanup', async () => {
      const personality = createMockPersonality({ name: 'Lila' });
      const context = createMockContext({
        userName: 'TestUser',
        activePersonaName: 'Lila',
        discordUsername: 'lbds137',
      });

      await service.generateResponse(personality, 'Hello', context);

      expect(mockReplacePromptPlaceholders).toHaveBeenCalledWith(
        'AI response',
        'TestUser',
        'Lila',
        'lbds137'
      );
    });

    it('should use activePersonaName when userName is empty', async () => {
      const personality = createMockPersonality({ name: 'TestBot' });
      const context = createMockContext({
        userName: '',
        activePersonaName: 'Alice',
        discordUsername: 'alice123',
      });

      await service.generateResponse(personality, 'Hello', context);

      expect(mockReplacePromptPlaceholders).toHaveBeenCalledWith(
        'AI response',
        'Alice',
        'TestBot',
        'alice123'
      );
    });

    it('should use default "User" when both userName and activePersonaName are empty', async () => {
      const personality = createMockPersonality({ name: 'TestBot' });
      const context = createMockContext({
        userName: '',
        activePersonaName: '',
        discordUsername: 'someuser',
      });

      await service.generateResponse(personality, 'Hello', context);

      expect(mockReplacePromptPlaceholders).toHaveBeenCalledWith(
        'AI response',
        'User',
        'TestBot',
        'someuser'
      );
    });

    it('should pass undefined discordUsername when not provided', async () => {
      const personality = createMockPersonality({ name: 'TestBot' });
      const context = createMockContext({
        userName: 'TestUser',
      });

      await service.generateResponse(personality, 'Hello', context);

      expect(mockReplacePromptPlaceholders).toHaveBeenCalledWith(
        'AI response',
        'TestUser',
        'TestBot',
        undefined
      );
    });
  });

  describe('user reference resolution in output', () => {
    it('should resolve user references in AI output', async () => {
      // Mock the LLM to return content with shapes.inc format user reference
      getLLMInvokerMock().invokeWithRetry.mockResolvedValue({
        content: 'Hello @[alice](user:user-123)! How are you?',
        usage_metadata: { input_tokens: 100, output_tokens: 50 },
      });

      // Mock UserReferenceResolver to transform the output
      getUserReferenceResolverMock().resolveUserReferences.mockResolvedValue({
        processedText: 'Hello @alice! How are you?',
        resolvedPersonas: [],
      });

      const personality = createMockPersonality();
      const context = createMockContext();

      const result = await service.generateResponse(personality, 'Hi alice', context);

      // UserReferenceResolver should be called on the cleaned output with correct arguments
      expect(getUserReferenceResolverMock().resolveUserReferences).toHaveBeenCalledWith(
        'Hello @[alice](user:user-123)! How are you?',
        'personality-123'
      );

      // The response should contain the resolved text
      expect(result.content).toBe('Hello @alice! How are you?');
    });

    it('should resolve multiple user references in output', async () => {
      getLLMInvokerMock().invokeWithRetry.mockResolvedValue({
        content: 'Hi @[alice](user:user-1) and @[bob](user:user-2)!',
        usage_metadata: { input_tokens: 100, output_tokens: 50 },
      });

      getUserReferenceResolverMock().resolveUserReferences.mockResolvedValue({
        processedText: 'Hi @alice and @bob!',
        resolvedPersonas: [],
      });

      const personality = createMockPersonality();
      const context = createMockContext();

      const result = await service.generateResponse(personality, 'Hello both', context);

      expect(result.content).toBe('Hi @alice and @bob!');
    });

    it('should store resolved content in LTM', async () => {
      getLLMInvokerMock().invokeWithRetry.mockResolvedValue({
        content: 'Message for @[alice](user:user-123)',
        usage_metadata: { input_tokens: 100, output_tokens: 50 },
      });

      getUserReferenceResolverMock().resolveUserReferences.mockResolvedValue({
        processedText: 'Message for @alice',
        resolvedPersonas: [],
      });

      getMemoryRetrieverMock().resolvePersonaForMemory.mockResolvedValue({
        personaId: 'persona-123',
        shareLtmAcrossPersonalities: false,
      });

      const personality = createMockPersonality();
      const context = createMockContext();

      await service.generateResponse(personality, 'Tell alice something', context);

      // LTM should receive the resolved content
      expect(getLongTermMemoryServiceMock().storeInteraction).toHaveBeenCalledWith(
        personality,
        expect.any(String),
        'Message for @alice', // resolved content
        context,
        'persona-123'
      );
    });

    it('should handle output without user references gracefully', async () => {
      getLLMInvokerMock().invokeWithRetry.mockResolvedValue({
        content: 'Just a normal response',
        usage_metadata: { input_tokens: 100, output_tokens: 50 },
      });

      // UserReferenceResolver returns input unchanged when no references
      getUserReferenceResolverMock().resolveUserReferences.mockResolvedValue({
        processedText: 'Just a normal response',
        resolvedPersonas: [],
      });

      const personality = createMockPersonality();
      const context = createMockContext();

      const result = await service.generateResponse(personality, 'Hello', context);

      expect(result.content).toBe('Just a normal response');
    });
  });

  describe('error handling', () => {
    it('should propagate errors from memory retrieval', async () => {
      getMemoryRetrieverMock().retrieveRelevantMemories.mockRejectedValue(
        new Error('Memory service unavailable')
      );

      const personality = createMockPersonality();
      const context = createMockContext();

      await expect(service.generateResponse(personality, 'Test', context)).rejects.toThrow(
        'Memory service unavailable'
      );
    });

    it('should propagate errors from attachment processing', async () => {
      mockProcessAttachments.mockRejectedValue(new Error('Vision API error'));

      const attachments: AttachmentMetadata[] = [
        {
          url: 'https://example.com/image.png',
          contentType: CONTENT_TYPES.IMAGE_PNG,
          name: 'image.png',
          size: 1024,
        },
      ];
      const context = createMockContext({ attachments });
      const personality = createMockPersonality();

      await expect(service.generateResponse(personality, 'Test', context)).rejects.toThrow(
        'Vision API error'
      );
    });
  });

  describe('inline image descriptions', () => {
    it('should inject image descriptions into matching history entries', async () => {
      const personality = createMockPersonality();

      // Create history with a message that has an image
      const rawHistory = [
        {
          id: 'msg-with-image-123',
          role: 'user' as const,
          content: 'Check out this image!',
          speaker: 'Alice',
          timestamp: new Date().toISOString(),
        },
        {
          id: 'msg-no-image-456',
          role: 'assistant' as const,
          content: 'Nice image!',
          speaker: 'TestBot',
          timestamp: new Date().toISOString(),
        },
      ];

      // Create preprocessed attachments with sourceDiscordMessageId matching history
      const preprocessedAttachments = [
        {
          type: AttachmentType.Image,
          description: 'A beautiful sunset over the ocean',
          metadata: {
            url: 'https://example.com/sunset.png',
            contentType: CONTENT_TYPES.IMAGE_PNG,
            name: 'sunset.png',
            size: 2048,
            sourceDiscordMessageId: 'msg-with-image-123',
          },
        },
      ];

      const context = createMockContext({
        rawConversationHistory: rawHistory,
        preprocessedExtendedContextAttachments: preprocessedAttachments,
      });

      await service.generateResponse(personality, 'What do you see?', context);

      // Verify that the history entry was mutated to include imageDescriptions
      expect(rawHistory[0].messageMetadata).toBeDefined();
      expect(rawHistory[0].messageMetadata?.imageDescriptions).toEqual([
        { filename: 'sunset.png', description: 'A beautiful sunset over the ocean' },
      ]);
      // The second message should not have imageDescriptions
      expect(rawHistory[1].messageMetadata).toBeUndefined();
    });

    it('should handle multiple images on the same message', async () => {
      const personality = createMockPersonality();

      const rawHistory = [
        {
          id: 'msg-multi-images',
          role: 'user' as const,
          content: 'Here are some photos from my trip!',
          speaker: 'Bob',
          timestamp: new Date().toISOString(),
        },
      ];

      const preprocessedAttachments = [
        {
          type: AttachmentType.Image,
          description: 'Mountain landscape with snow',
          metadata: {
            url: 'https://example.com/mountain.png',
            contentType: CONTENT_TYPES.IMAGE_PNG,
            name: 'mountain.png',
            size: 3000,
            sourceDiscordMessageId: 'msg-multi-images',
          },
        },
        {
          type: AttachmentType.Image,
          description: 'Beach with palm trees',
          metadata: {
            url: 'https://example.com/beach.png',
            contentType: CONTENT_TYPES.IMAGE_PNG,
            name: 'beach.png',
            size: 2500,
            sourceDiscordMessageId: 'msg-multi-images',
          },
        },
      ];

      const context = createMockContext({
        rawConversationHistory: rawHistory,
        preprocessedExtendedContextAttachments: preprocessedAttachments,
      });

      await service.generateResponse(personality, 'Describe the photos', context);

      expect(rawHistory[0].messageMetadata?.imageDescriptions).toHaveLength(2);
      expect(rawHistory[0].messageMetadata?.imageDescriptions).toEqual([
        { filename: 'mountain.png', description: 'Mountain landscape with snow' },
        { filename: 'beach.png', description: 'Beach with palm trees' },
      ]);
    });

    it('should skip images without sourceDiscordMessageId', async () => {
      const personality = createMockPersonality();

      const rawHistory = [
        {
          id: 'msg-123',
          role: 'user' as const,
          content: 'Some message',
          speaker: 'Charlie',
          timestamp: new Date().toISOString(),
        },
      ];

      // Attachment without sourceDiscordMessageId
      const preprocessedAttachments = [
        {
          type: AttachmentType.Image,
          description: 'An orphan image',
          metadata: {
            url: 'https://example.com/orphan.png',
            contentType: CONTENT_TYPES.IMAGE_PNG,
            name: 'orphan.png',
            size: 1000,
            // No sourceDiscordMessageId
          },
        },
      ];

      const context = createMockContext({
        rawConversationHistory: rawHistory,
        preprocessedExtendedContextAttachments: preprocessedAttachments,
      });

      await service.generateResponse(personality, 'Test', context);

      // No injection should happen
      expect(rawHistory[0].messageMetadata).toBeUndefined();
    });

    it('should handle empty preprocessedExtendedContextAttachments', async () => {
      const personality = createMockPersonality();

      const rawHistory = [
        {
          id: 'msg-123',
          role: 'user' as const,
          content: 'No images here',
          speaker: 'Dave',
          timestamp: new Date().toISOString(),
        },
      ];

      const context = createMockContext({
        rawConversationHistory: rawHistory,
        preprocessedExtendedContextAttachments: [],
      });

      await service.generateResponse(personality, 'Test', context);

      // Should complete without errors
      expect(rawHistory[0].messageMetadata).toBeUndefined();
    });

    it('should handle undefined preprocessedExtendedContextAttachments', async () => {
      const personality = createMockPersonality();

      const rawHistory = [
        {
          id: 'msg-123',
          role: 'user' as const,
          content: 'No extended context',
          speaker: 'Eve',
          timestamp: new Date().toISOString(),
        },
      ];

      const context = createMockContext({
        rawConversationHistory: rawHistory,
        // preprocessedExtendedContextAttachments is undefined
      });

      await service.generateResponse(personality, 'Test', context);

      // Should complete without errors
      expect(rawHistory[0].messageMetadata).toBeUndefined();
    });

    it('should use default filename when attachment name is undefined', async () => {
      const personality = createMockPersonality();

      const rawHistory = [
        {
          id: 'msg-unnamed',
          role: 'user' as const,
          content: 'Image with no name',
          speaker: 'Frank',
          timestamp: new Date().toISOString(),
        },
      ];

      const preprocessedAttachments = [
        {
          type: AttachmentType.Image,
          description: 'A mystery image',
          metadata: {
            url: 'https://example.com/unnamed.png',
            contentType: CONTENT_TYPES.IMAGE_PNG,
            // name is undefined
            size: 500,
            sourceDiscordMessageId: 'msg-unnamed',
          },
        },
      ];

      const context = createMockContext({
        rawConversationHistory: rawHistory,
        preprocessedExtendedContextAttachments: preprocessedAttachments,
      });

      await service.generateResponse(personality, 'Test', context);

      expect(rawHistory[0].messageMetadata?.imageDescriptions).toEqual([
        { filename: 'image', description: 'A mystery image' },
      ]);
    });
  });

  describe('API-level reasoning extraction', () => {
    it('should extract reasoning from additional_kwargs.reasoning (DeepSeek R1 format)', async () => {
      // Mock the LLM to return content with reasoning in additional_kwargs
      getLLMInvokerMock().invokeWithRetry.mockResolvedValue({
        content: 'The answer is 42.',
        usage_metadata: { input_tokens: 100, output_tokens: 50 },
        additional_kwargs: {
          reasoning: 'Let me think about this carefully. First, I need to consider...',
        },
      });

      getUserReferenceResolverMock().resolveUserReferences.mockResolvedValue({
        processedText: 'The answer is 42.',
        resolvedPersonas: [],
      });

      const personality = createMockPersonality({ showThinking: true });
      const context = createMockContext();

      const result = await service.generateResponse(
        personality,
        'What is the meaning of life?',
        context
      );

      // The thinkingContent should contain the extracted reasoning
      expect(result.thinkingContent).toBe(
        'Let me think about this carefully. First, I need to consider...'
      );
      // The visible content should not contain the reasoning
      expect(result.content).toBe('The answer is 42.');
    });

    it('should extract reasoning from response_metadata.reasoning_details as fallback', async () => {
      // Mock the LLM to return reasoning_details instead of additional_kwargs.reasoning
      getLLMInvokerMock().invokeWithRetry.mockResolvedValue({
        content: 'The result is correct.',
        usage_metadata: { input_tokens: 100, output_tokens: 50 },
        response_metadata: {
          reasoning_details: [
            { type: 'thinking', text: 'First step of reasoning.' },
            { type: 'thinking', summary: 'Second step summary.' },
          ],
        },
      });

      getUserReferenceResolverMock().resolveUserReferences.mockResolvedValue({
        processedText: 'The result is correct.',
        resolvedPersonas: [],
      });

      const personality = createMockPersonality({ showThinking: true });
      const context = createMockContext();

      const result = await service.generateResponse(personality, 'Verify this', context);

      // The thinkingContent should contain the extracted reasoning from reasoning_details
      // Multiple reasoning items are separated by \n\n---\n\n
      expect(result.thinkingContent).toBe(
        'First step of reasoning.\n\n---\n\nSecond step summary.'
      );
    });

    it('should merge API reasoning with inline thinking tags', async () => {
      // Mock the LLM to return both API reasoning and inline thinking
      getLLMInvokerMock().invokeWithRetry.mockResolvedValue({
        content: '<think>Inline thinking here</think>The final answer.',
        usage_metadata: { input_tokens: 100, output_tokens: 50 },
        additional_kwargs: {
          reasoning: 'API-level reasoning content',
        },
      });

      getUserReferenceResolverMock().resolveUserReferences.mockResolvedValue({
        processedText: 'The final answer.',
        resolvedPersonas: [],
      });

      const personality = createMockPersonality({ showThinking: true });
      const context = createMockContext();

      const result = await service.generateResponse(personality, 'Combine thinking', context);

      // Both API reasoning and inline thinking should be present
      expect(result.thinkingContent).toContain('API-level reasoning content');
      expect(result.thinkingContent).toContain('Inline thinking here');
    });

    it('should prefer additional_kwargs.reasoning over reasoning_details', async () => {
      // Mock with both additional_kwargs.reasoning and reasoning_details
      getLLMInvokerMock().invokeWithRetry.mockResolvedValue({
        content: 'Final answer.',
        usage_metadata: { input_tokens: 100, output_tokens: 50 },
        additional_kwargs: {
          reasoning: 'Primary reasoning from additional_kwargs',
        },
        response_metadata: {
          reasoning_details: [{ type: 'thinking', text: 'Fallback reasoning from details' }],
        },
      });

      getUserReferenceResolverMock().resolveUserReferences.mockResolvedValue({
        processedText: 'Final answer.',
        resolvedPersonas: [],
      });

      const personality = createMockPersonality({ showThinking: true });
      const context = createMockContext();

      const result = await service.generateResponse(personality, 'Priority test', context);

      // Should use additional_kwargs.reasoning (primary), not reasoning_details (fallback)
      expect(result.thinkingContent).toBe('Primary reasoning from additional_kwargs');
      expect(result.thinkingContent).not.toContain('Fallback reasoning');
    });

    it('should not include thinking when showThinking is false', async () => {
      getLLMInvokerMock().invokeWithRetry.mockResolvedValue({
        content: 'Response without thinking.',
        usage_metadata: { input_tokens: 100, output_tokens: 50 },
        additional_kwargs: {
          reasoning: 'This reasoning should not be shown',
        },
      });

      getUserReferenceResolverMock().resolveUserReferences.mockResolvedValue({
        processedText: 'Response without thinking.',
        resolvedPersonas: [],
      });

      // showThinking is false (default)
      const personality = createMockPersonality({ showThinking: false });
      const context = createMockContext();

      const result = await service.generateResponse(personality, 'Hide thinking', context);

      // thinkingContent is extracted but showThinking=false means it won't be displayed
      // The service still extracts it, the display decision is made elsewhere
      expect(result.content).toBe('Response without thinking.');
    });

    it('should use thinking content as response when visible content is empty (R1T Chimera edge case)', async () => {
      // Some models like R1T Chimera wrap their entire response in reasoning tags
      // instead of having separate thinking and response sections
      getLLMInvokerMock().invokeWithRetry.mockResolvedValue({
        content: '<reasoning>Actual response content inside reasoning tags.</reasoning>',
        usage_metadata: { input_tokens: 100, output_tokens: 50 },
        additional_kwargs: {},
        response_metadata: {},
      });

      getUserReferenceResolverMock().resolveUserReferences.mockResolvedValue({
        processedText: 'Actual response content inside reasoning tags.',
        resolvedPersonas: [],
      });

      const personality = createMockPersonality({ showThinking: true });
      const context = createMockContext();

      const result = await service.generateResponse(personality, 'Test message', context);

      // When all content is inside thinking tags, the thinking content should become the visible response
      expect(result.content).toBe('Actual response content inside reasoning tags.');
      // thinkingContent should be undefined since it was used as the response (null is converted to undefined)
      expect(result.thinkingContent).toBeUndefined();
    });
  });
});
