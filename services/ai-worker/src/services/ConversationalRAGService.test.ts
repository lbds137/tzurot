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
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { ConversationalRAGService } from './ConversationalRAGService.js';
import type { ConversationContext, MemoryDocument } from './ConversationalRAGService.js';
import type {
  LoadedPersonality,
  AttachmentMetadata,
  ReferencedMessage,
} from '@tzurot/common-types';
import { CONTENT_TYPES, AttachmentType } from '@tzurot/common-types';

// Instance trackers for mock classes (populated when ConversationalRAGService is instantiated)
let mockLLMInvokerInstance: {
  getModel: ReturnType<typeof vi.fn>;
  invokeWithRetry: ReturnType<typeof vi.fn>;
};
let mockMemoryRetrieverInstance: {
  retrieveRelevantMemories: ReturnType<typeof vi.fn>;
  getAllParticipantPersonas: ReturnType<typeof vi.fn>;
  getUserPersonaForPersonality: ReturnType<typeof vi.fn>;
};
let mockPromptBuilderInstance: {
  formatUserMessage: ReturnType<typeof vi.fn>;
  buildSearchQuery: ReturnType<typeof vi.fn>;
  buildFullSystemPrompt: ReturnType<typeof vi.fn>;
  buildHumanMessage: ReturnType<typeof vi.fn>;
};
let mockLongTermMemoryInstance: {
  storeInteraction: ReturnType<typeof vi.fn>;
};
let mockReferencedMessageFormatterInstance: {
  formatReferencedMessages: ReturnType<typeof vi.fn>;
  extractTextForSearch: ReturnType<typeof vi.fn>;
};
let mockContextWindowManagerInstance: {
  buildContext: ReturnType<typeof vi.fn>;
  calculateHistoryBudget: ReturnType<typeof vi.fn>;
  selectAndSerializeHistory: ReturnType<typeof vi.fn>;
  countHistoryTokens: ReturnType<typeof vi.fn>;
  calculateMemoryBudget: ReturnType<typeof vi.fn>;
  selectMemoriesWithinBudget: ReturnType<typeof vi.fn>;
};

// Mock all dependencies using class syntax for proper constructor behavior
vi.mock('./LLMInvoker.js', () => ({
  LLMInvoker: class MockLLMInvoker {
    getModel = vi.fn().mockReturnValue({
      model: {
        invoke: vi.fn().mockResolvedValue({ content: 'AI response' }),
      },
      modelName: 'test-model',
    });
    invokeWithRetry = vi.fn().mockResolvedValue({
      content: 'AI response',
    });
    constructor() {
      mockLLMInvokerInstance = this;
    }
  },
}));

vi.mock('./MemoryRetriever.js', () => ({
  MemoryRetriever: class MockMemoryRetriever {
    retrieveRelevantMemories = vi.fn().mockResolvedValue([]);
    getAllParticipantPersonas = vi.fn().mockResolvedValue(new Map());
    resolvePersonaForMemory = vi.fn().mockResolvedValue({
      personaId: 'persona-123',
      shareLtmAcrossPersonalities: false,
    });
    constructor() {
      mockMemoryRetrieverInstance = this;
    }
  },
}));

vi.mock('./PromptBuilder.js', () => ({
  PromptBuilder: class MockPromptBuilder {
    formatUserMessage = vi.fn().mockReturnValue('formatted user message');
    buildSearchQuery = vi.fn().mockReturnValue('search query');
    buildFullSystemPrompt = vi.fn().mockReturnValue(new SystemMessage('system prompt'));
    buildHumanMessage = vi.fn().mockReturnValue({
      message: new HumanMessage('human message'),
      contentForStorage: 'content for storage',
    });
    countTokens = vi.fn().mockReturnValue(100);
    countMemoryTokens = vi.fn().mockReturnValue(50);
    constructor() {
      mockPromptBuilderInstance = this;
    }
  },
}));

vi.mock('./LongTermMemoryService.js', () => ({
  LongTermMemoryService: class MockLongTermMemoryService {
    storeInteraction = vi.fn().mockResolvedValue(undefined);
    constructor() {
      mockLongTermMemoryInstance = this;
    }
  },
}));

vi.mock('./ReferencedMessageFormatter.js', () => ({
  ReferencedMessageFormatter: class MockReferencedMessageFormatter {
    formatReferencedMessages = vi.fn().mockResolvedValue('formatted references');
    extractTextForSearch = vi.fn().mockReturnValue('reference text for search');
    constructor() {
      mockReferencedMessageFormatterInstance = this;
    }
  },
}));

vi.mock('./context/ContextWindowManager.js', () => ({
  ContextWindowManager: class MockContextWindowManager {
    buildContext = vi.fn().mockReturnValue({
      systemPrompt: new SystemMessage('system prompt'),
      selectedHistory: [],
      currentMessage: new HumanMessage('current message'),
      budgetInfo: {
        totalBudget: 8000,
        systemPromptTokens: 500,
        memoriesTokens: 200,
        currentMessageTokens: 50,
        historyBudget: 7250,
        selectedHistoryTokens: 0,
      },
    });
    calculateHistoryBudget = vi.fn().mockReturnValue(7000);
    selectAndSerializeHistory = vi.fn().mockReturnValue({
      serializedHistory: '<msg user="Lila" role="user">Previous message</msg>',
      historyTokensUsed: 50,
      messagesIncluded: 1,
      messagesDropped: 0,
    });
    // New memory budget methods
    countHistoryTokens = vi.fn().mockReturnValue(100);
    calculateMemoryBudget = vi.fn().mockReturnValue(32000); // 25% of 128k
    selectMemoriesWithinBudget = vi.fn().mockImplementation((memories: unknown[]) => ({
      selectedMemories: memories, // Return all memories by default
      tokensUsed: 500,
      memoriesDropped: 0,
      droppedDueToSize: 0,
    }));
    constructor() {
      mockContextWindowManagerInstance = this;
    }
  },
}));

vi.mock('./MultimodalProcessor.js', () => ({
  processAttachments: vi.fn().mockResolvedValue([]),
}));

vi.mock('../utils/responseCleanup.js', () => ({
  stripResponseArtifacts: vi.fn((content: string) => content),
}));

vi.mock('../utils/promptPlaceholders.js', () => ({
  replacePromptPlaceholders: vi.fn((content: string) => content),
}));

vi.mock('../utils/errorHandling.js', () => ({
  logAndThrow: vi.fn((logger: unknown, msg: string, error: unknown) => {
    throw error;
  }),
}));

// Import mocks for assertions
import { processAttachments } from './MultimodalProcessor.js';

// Test fixtures
function createMockPersonality(overrides?: Partial<LoadedPersonality>): LoadedPersonality {
  return {
    id: 'personality-123',
    name: 'TestBot',
    displayName: 'Test Bot',
    slug: 'testbot',
    systemPrompt: 'You are a helpful test bot.',
    model: 'test-model',
    temperature: 0.7,
    maxTokens: 2000,
    contextWindowTokens: 8192,
    characterInfo: 'A friendly test bot',
    personalityTraits: 'Helpful, kind, knowledgeable',
    ...overrides,
  } as LoadedPersonality;
}

function createMockContext(overrides?: Partial<ConversationContext>): ConversationContext {
  return {
    userId: 'user-123',
    channelId: 'channel-456',
    serverId: 'server-789',
    userName: 'TestUser',
    ...overrides,
  };
}

describe('ConversationalRAGService', () => {
  let service: ConversationalRAGService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Create service - this populates the mock instance trackers via constructors
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

      expect(mockPromptBuilderInstance.formatUserMessage).toHaveBeenCalledWith(
        'Test message',
        context
      );
    });

    it('should retrieve relevant memories via MemoryRetriever', async () => {
      const personality = createMockPersonality();
      const context = createMockContext();

      await service.generateResponse(personality, 'Test message', context);

      expect(mockMemoryRetrieverInstance.retrieveRelevantMemories).toHaveBeenCalledWith(
        personality,
        'search query',
        context
      );
    });

    it('should build context window via ContextWindowManager', async () => {
      const personality = createMockPersonality();
      const context = createMockContext();

      await service.generateResponse(personality, 'Test message', context);

      // NEW: ContextWindowManager is now called via calculateHistoryBudget and selectAndSerializeHistory
      expect(mockContextWindowManagerInstance.calculateHistoryBudget).toHaveBeenCalled();
      expect(mockContextWindowManagerInstance.selectAndSerializeHistory).toHaveBeenCalled();
    });

    it('should invoke LLM via LLMInvoker', async () => {
      const personality = createMockPersonality();
      const context = createMockContext();

      await service.generateResponse(personality, 'Test message', context);

      expect(mockLLMInvokerInstance.invokeWithRetry).toHaveBeenCalled();
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
      mockMemoryRetrieverInstance.retrieveRelevantMemories = vi.fn().mockResolvedValue(memories);

      const personality = createMockPersonality();
      const context = createMockContext();

      const result = await service.generateResponse(personality, 'Recall something', context);

      // buildFullSystemPrompt is called twice: once for base tokens, once with history
      expect(mockPromptBuilderInstance.buildFullSystemPrompt).toHaveBeenCalledWith({
        personality,
        participantPersonas: expect.any(Map),
        relevantMemories: memories,
        context,
        referencedMessagesFormatted: undefined,
        serializedHistory: expect.anything(), // undefined first call, string second call
      });
      expect(result.retrievedMemories).toBe(2);
    });

    it('should include participant personas in system prompt', async () => {
      const participantMap = new Map([
        ['user-123', { personaId: 'persona-1', personaName: 'Alice', isActive: true }],
      ]);
      mockMemoryRetrieverInstance.getAllParticipantPersonas = vi
        .fn()
        .mockResolvedValue(participantMap);

      const personality = createMockPersonality();
      const context = createMockContext();

      await service.generateResponse(personality, 'Hello', context);

      // buildFullSystemPrompt is called twice: once for base tokens, once with history
      expect(mockPromptBuilderInstance.buildFullSystemPrompt).toHaveBeenCalledWith({
        personality,
        participantPersonas: participantMap,
        relevantMemories: expect.any(Array),
        context,
        referencedMessagesFormatted: undefined,
        serializedHistory: expect.anything(),
      });
    });

    it('should handle empty memory results gracefully', async () => {
      mockMemoryRetrieverInstance.retrieveRelevantMemories = vi.fn().mockResolvedValue([]);

      const personality = createMockPersonality();
      const context = createMockContext();

      const result = await service.generateResponse(personality, 'New topic', context);

      expect(result.retrievedMemories).toBe(0);
      expect(result.content).toBe('AI response');
    });
  });

  describe('LTM storage integration', () => {
    it('should store interaction to LTM when persona exists', async () => {
      mockMemoryRetrieverInstance.getUserPersonaForPersonality = vi
        .fn()
        .mockResolvedValue({ personaId: 'persona-123', shareLtmAcrossPersonalities: false });

      const personality = createMockPersonality();
      const context = createMockContext();

      await service.generateResponse(personality, 'Remember this', context);

      expect(mockLongTermMemoryInstance.storeInteraction).toHaveBeenCalledWith(
        personality,
        'content for storage',
        'AI response',
        context,
        'persona-123'
      );
    });

    it('should skip LTM storage when no persona found', async () => {
      mockMemoryRetrieverInstance.resolvePersonaForMemory = vi.fn().mockResolvedValue(null);

      const personality = createMockPersonality();
      const context = createMockContext();

      await service.generateResponse(personality, 'Test', context);

      expect(mockLongTermMemoryInstance.storeInteraction).not.toHaveBeenCalled();
    });

    it('should store LTM with shareLtmAcrossPersonalities enabled', async () => {
      mockMemoryRetrieverInstance.resolvePersonaForMemory = vi
        .fn()
        .mockResolvedValue({ personaId: 'persona-456', shareLtmAcrossPersonalities: true });

      const personality = createMockPersonality();
      const context = createMockContext();

      await service.generateResponse(personality, 'Test', context);

      // Should still store to LTM - the sharing flag is handled in MemoryRetriever
      expect(mockLongTermMemoryInstance.storeInteraction).toHaveBeenCalledWith(
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

      expect(mockReferencedMessageFormatterInstance.formatReferencedMessages).toHaveBeenCalledWith(
        referencedMessages,
        personality,
        false, // isGuestMode (default)
        undefined // preprocessedReferenceAttachments
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

      expect(mockReferencedMessageFormatterInstance.extractTextForSearch).toHaveBeenCalledWith(
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

      expect(mockPromptBuilderInstance.buildSearchQuery).toHaveBeenCalledWith(
        'formatted user message',
        expect.any(Array),
        'reference text for search',
        undefined // recentHistoryWindow - no rawConversationHistory in context
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

      // buildFullSystemPrompt is called twice: once for base tokens, once with history
      expect(mockPromptBuilderInstance.buildFullSystemPrompt).toHaveBeenCalledWith({
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

      expect(
        mockReferencedMessageFormatterInstance.formatReferencedMessages
      ).not.toHaveBeenCalled();
    });

    it('should not format references when array is empty', async () => {
      const context = createMockContext({ referencedMessages: [] });
      const personality = createMockPersonality();

      await service.generateResponse(personality, 'Hello', context);

      expect(
        mockReferencedMessageFormatterInstance.formatReferencedMessages
      ).not.toHaveBeenCalled();
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

      expect(processAttachments).toHaveBeenCalledWith(attachments, personality);
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

      expect(processAttachments).toHaveBeenCalledWith(attachments, personality);
    });

    it('should include processed attachments in search query', async () => {
      const processedAttachments = [
        {
          type: AttachmentType.Image,
          description: 'A photo of a cat',
          metadata: { url: 'https://example.com/cat.png', name: 'cat.png' },
        },
      ];
      vi.mocked(processAttachments).mockResolvedValue(processedAttachments);

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

      expect(mockPromptBuilderInstance.buildSearchQuery).toHaveBeenCalledWith(
        'formatted user message',
        processedAttachments,
        undefined,
        undefined // recentHistoryWindow - no rawConversationHistory in context
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
      vi.mocked(processAttachments).mockResolvedValue(processedAttachments);

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

      expect(mockPromptBuilderInstance.buildHumanMessage).toHaveBeenCalledWith(
        'formatted user message',
        processedAttachments,
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
      vi.mocked(processAttachments).mockResolvedValue(processedAttachments);

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

      expect(processAttachments).not.toHaveBeenCalled();
    });

    it('should not process attachments when array is empty', async () => {
      const context = createMockContext({ attachments: [] });
      const personality = createMockPersonality();

      await service.generateResponse(personality, 'Empty attachments', context);

      expect(processAttachments).not.toHaveBeenCalled();
    });

    it('should use preprocessed attachments instead of calling processAttachments', async () => {
      // Preprocessed attachments from dependency jobs (ImageDescriptionJob)
      // should be used directly, avoiding duplicate vision API calls
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

      // Should NOT call processAttachments when preprocessedAttachments is provided
      expect(processAttachments).not.toHaveBeenCalled();

      // Verify the preprocessed description is used in prompt building
      expect(mockPromptBuilderInstance.buildSearchQuery).toHaveBeenCalledWith(
        expect.any(String),
        preprocessedAttachments,
        undefined,
        undefined
      );
    });
  });

  describe('censored response retry behavior in full RAG flow', () => {
    it('should delegate retry logic to LLMInvoker', async () => {
      const personality = createMockPersonality();
      const context = createMockContext();

      await service.generateResponse(personality, 'Test', context);

      // The service uses invokeWithRetry which handles censored responses internally
      expect(mockLLMInvokerInstance.invokeWithRetry).toHaveBeenCalled();
    });

    it('should pass correct model parameters to LLMInvoker', async () => {
      const personality = createMockPersonality({ model: 'claude-3-sonnet', temperature: 0.9 });
      const context = createMockContext();

      await service.generateResponse(personality, 'Test', context);

      expect(mockLLMInvokerInstance.getModel).toHaveBeenCalledWith(
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

      await service.generateResponse(personality, 'Test', context, userApiKey);

      expect(mockLLMInvokerInstance.getModel).toHaveBeenCalledWith(
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

      expect(mockLLMInvokerInstance.getModel).toHaveBeenCalledWith(
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

      // invokeWithRetry should be called with imageCount=2, audioCount=1, and stop sequences
      expect(mockLLMInvokerInstance.invokeWithRetry).toHaveBeenCalledWith({
        model: expect.anything(),
        messages: expect.any(Array),
        modelName: 'test-model',
        imageCount: 2,
        audioCount: 1,
        stopSequences: expect.any(Array), // stopSequences for identity bleeding prevention
      });
    });

    it('should propagate LLMInvoker errors', async () => {
      mockLLMInvokerInstance.invokeWithRetry = vi
        .fn()
        .mockRejectedValue(new Error('All retries exhausted'));

      const personality = createMockPersonality();
      const context = createMockContext();

      await expect(service.generateResponse(personality, 'Test', context)).rejects.toThrow(
        'All retries exhausted'
      );
    });
  });

  describe('error handling', () => {
    it('should propagate errors from memory retrieval', async () => {
      mockMemoryRetrieverInstance.retrieveRelevantMemories = vi
        .fn()
        .mockRejectedValue(new Error('Memory service unavailable'));

      const personality = createMockPersonality();
      const context = createMockContext();

      await expect(service.generateResponse(personality, 'Test', context)).rejects.toThrow(
        'Memory service unavailable'
      );
    });

    it('should propagate errors from attachment processing', async () => {
      vi.mocked(processAttachments).mockRejectedValue(new Error('Vision API error'));

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
});
