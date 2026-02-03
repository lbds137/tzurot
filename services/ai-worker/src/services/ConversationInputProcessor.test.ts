/**
 * Tests for ConversationInputProcessor
 *
 * Unit tests for input normalization, attachment processing, and search query building.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationInputProcessor } from './ConversationInputProcessor.js';
import type { LoadedPersonality, MessageContent, ReferencedMessage } from '@tzurot/common-types';
import type { ConversationContext } from './ConversationalRAGTypes.js';
import type { PromptBuilder } from './PromptBuilder.js';
import type { ReferencedMessageFormatter } from './ReferencedMessageFormatter.js';
import type { ResponsePostProcessor } from './ResponsePostProcessor.js';
import type { ProcessedAttachment } from './MultimodalProcessor.js';

// Use vi.hoisted() to create mocks that persist across test resets
const { mockProcessAttachments, mockExtractRecentHistoryWindow } = vi.hoisted(() => ({
  mockProcessAttachments: vi.fn(),
  mockExtractRecentHistoryWindow: vi.fn(),
}));

vi.mock('./MultimodalProcessor.js', () => ({
  processAttachments: mockProcessAttachments,
}));

vi.mock('./RAGUtils.js', () => ({
  extractRecentHistoryWindow: mockExtractRecentHistoryWindow,
}));

describe('ConversationInputProcessor', () => {
  let processor: ConversationInputProcessor;
  let mockPromptBuilder: PromptBuilder;
  let mockReferencedMessageFormatter: ReferencedMessageFormatter;
  let mockResponsePostProcessor: ResponsePostProcessor;

  const createMockPersonality = (overrides = {}): LoadedPersonality => ({
    id: 'test-personality',
    name: 'TestBot',
    displayName: 'Test Bot',
    slug: 'testbot',
    systemPrompt: 'Test system prompt',
    model: 'test-model',
    temperature: 0.7,
    maxTokens: 2000,
    contextWindowTokens: 131072,
    characterInfo: 'Test character',
    personalityTraits: 'Test traits',
    ...overrides,
  });

  const createMockContext = (overrides = {}): ConversationContext => ({
    userId: 'user-123',
    channelId: 'channel-123',
    guildId: 'guild-123',
    conversationHistory: [],
    rawConversationHistory: [],
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();

    mockPromptBuilder = {
      formatUserMessage: vi.fn().mockReturnValue('formatted user message'),
      buildSearchQuery: vi.fn().mockReturnValue('search query'),
    } as unknown as PromptBuilder;

    mockReferencedMessageFormatter = {
      formatReferencedMessages: vi.fn().mockResolvedValue('<references>formatted</references>'),
      extractTextForSearch: vi.fn().mockReturnValue('reference text for search'),
    } as unknown as ReferencedMessageFormatter;

    mockResponsePostProcessor = {
      filterDuplicateReferences: vi.fn().mockImplementation(refs => refs || []),
    } as unknown as ResponsePostProcessor;

    mockProcessAttachments.mockResolvedValue([]);
    mockExtractRecentHistoryWindow.mockReturnValue('recent history window');

    processor = new ConversationInputProcessor(
      mockPromptBuilder,
      mockReferencedMessageFormatter,
      mockResponsePostProcessor
    );
  });

  describe('resolveUserName', () => {
    it('should return userName when available', () => {
      const context = createMockContext({ userName: 'Alice' });

      const result = processor.resolveUserName(context);

      expect(result).toBe('Alice');
    });

    it('should fall back to activePersonaName when userName is empty', () => {
      const context = createMockContext({
        userName: '',
        activePersonaName: 'AlicePersona',
      });

      const result = processor.resolveUserName(context);

      expect(result).toBe('AlicePersona');
    });

    it('should fall back to activePersonaName when userName is undefined', () => {
      const context = createMockContext({
        activePersonaName: 'AlicePersona',
      });

      const result = processor.resolveUserName(context);

      expect(result).toBe('AlicePersona');
    });

    it('should return "User" when both userName and activePersonaName are empty', () => {
      const context = createMockContext({
        userName: '',
        activePersonaName: '',
      });

      const result = processor.resolveUserName(context);

      expect(result).toBe('User');
    });

    it('should return "User" when both are undefined', () => {
      const context = createMockContext({});

      const result = processor.resolveUserName(context);

      expect(result).toBe('User');
    });
  });

  describe('processInputs', () => {
    const mockMessage: MessageContent = 'Hello, how are you?';
    const mockPersonality = createMockPersonality();

    it('should use preprocessed attachments when available', async () => {
      const preprocessedAttachments: ProcessedAttachment[] = [
        { type: 'image', description: 'A cute cat', sourceUrl: 'http://example.com/cat.jpg' },
      ];
      const context = createMockContext({ preprocessedAttachments });

      const result = await processor.processInputs(mockPersonality, mockMessage, context, false);

      expect(result.processedAttachments).toEqual(preprocessedAttachments);
      expect(mockProcessAttachments).not.toHaveBeenCalled();
    });

    it('should process attachments inline as fallback', async () => {
      const attachments = [{ url: 'http://example.com/cat.jpg', contentType: 'image/jpeg' }];
      const processedResult: ProcessedAttachment[] = [
        { type: 'image', description: 'Processed cat', sourceUrl: 'http://example.com/cat.jpg' },
      ];
      mockProcessAttachments.mockResolvedValue(processedResult);

      const context = createMockContext({ attachments });

      const result = await processor.processInputs(
        mockPersonality,
        mockMessage,
        context,
        false,
        'user-api-key'
      );

      expect(result.processedAttachments).toEqual(processedResult);
      expect(mockProcessAttachments).toHaveBeenCalledWith(
        attachments,
        mockPersonality,
        false,
        'user-api-key'
      );
    });

    it('should format user message via PromptBuilder', async () => {
      const context = createMockContext();

      await processor.processInputs(mockPersonality, mockMessage, context, false);

      expect(mockPromptBuilder.formatUserMessage).toHaveBeenCalledWith(mockMessage, context);
    });

    it('should filter duplicate references', async () => {
      const referencedMessages: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg1',
          discordUserId: 'user1',
          authorUsername: 'user1',
          authorDisplayName: 'User One',
          content: 'Referenced content',
          embeds: '',
          timestamp: '2025-01-01T00:00:00Z',
          locationContext: '<location/>',
        },
      ];
      const rawHistory = [{ id: 'msg2' }];
      const context = createMockContext({
        referencedMessages,
        rawConversationHistory: rawHistory,
      });

      await processor.processInputs(mockPersonality, mockMessage, context, false);

      expect(mockResponsePostProcessor.filterDuplicateReferences).toHaveBeenCalledWith(
        referencedMessages,
        rawHistory
      );
    });

    it('should format referenced messages when present', async () => {
      const referencedMessages: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg1',
          discordUserId: 'user1',
          authorUsername: 'user1',
          authorDisplayName: 'User One',
          content: 'Referenced content',
          embeds: '',
          timestamp: '2025-01-01T00:00:00Z',
          locationContext: '<location/>',
        },
      ];
      const context = createMockContext({ referencedMessages });

      const result = await processor.processInputs(
        mockPersonality,
        mockMessage,
        context,
        true // guest mode
      );

      expect(mockReferencedMessageFormatter.formatReferencedMessages).toHaveBeenCalledWith(
        referencedMessages,
        mockPersonality,
        true,
        undefined,
        undefined
      );
      expect(result.referencedMessagesDescriptions).toBe('<references>formatted</references>');
    });

    it('should not format references when none present', async () => {
      const context = createMockContext({ referencedMessages: [] });

      const result = await processor.processInputs(mockPersonality, mockMessage, context, false);

      expect(mockReferencedMessageFormatter.formatReferencedMessages).not.toHaveBeenCalled();
      expect(result.referencedMessagesDescriptions).toBeUndefined();
    });

    it('should extract text from references for memory search', async () => {
      const referencedMessages: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg1',
          discordUserId: 'user1',
          authorUsername: 'user1',
          authorDisplayName: 'User One',
          content: 'Referenced content',
          embeds: '',
          timestamp: '2025-01-01T00:00:00Z',
          locationContext: '<location/>',
        },
      ];
      const context = createMockContext({ referencedMessages });

      const result = await processor.processInputs(mockPersonality, mockMessage, context, false);

      expect(mockReferencedMessageFormatter.extractTextForSearch).toHaveBeenCalledWith(
        '<references>formatted</references>'
      );
      expect(result.referencedMessagesTextForSearch).toBe('reference text for search');
    });

    it('should extract recent history window for context-aware search', async () => {
      const rawHistory = [{ id: 'msg1', content: 'previous' }];
      const context = createMockContext({ rawConversationHistory: rawHistory });

      await processor.processInputs(mockPersonality, mockMessage, context, false);

      expect(mockExtractRecentHistoryWindow).toHaveBeenCalledWith(rawHistory);
    });

    it('should build search query with all components', async () => {
      const preprocessedAttachments: ProcessedAttachment[] = [
        { type: 'image', description: 'A cat', sourceUrl: 'http://example.com/cat.jpg' },
      ];
      const referencedMessages: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg1',
          discordUserId: 'user1',
          authorUsername: 'user1',
          authorDisplayName: 'User One',
          content: 'Referenced',
          embeds: '',
          timestamp: '2025-01-01T00:00:00Z',
          locationContext: '<location/>',
        },
      ];
      const context = createMockContext({
        preprocessedAttachments,
        referencedMessages,
        rawConversationHistory: [{ id: 'history1' }],
      });

      const result = await processor.processInputs(mockPersonality, mockMessage, context, false);

      expect(mockPromptBuilder.buildSearchQuery).toHaveBeenCalledWith(
        'formatted user message',
        preprocessedAttachments,
        'reference text for search',
        'recent history window'
      );
      expect(result.searchQuery).toBe('search query');
    });

    it('should pass preprocessed reference attachments to formatter', async () => {
      const referencedMessages: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg1',
          discordUserId: 'user1',
          authorUsername: 'user1',
          authorDisplayName: 'User One',
          content: 'Referenced',
          embeds: '',
          timestamp: '2025-01-01T00:00:00Z',
          locationContext: '<location/>',
        },
      ];
      const preprocessedReferenceAttachments: ProcessedAttachment[] = [
        { type: 'image', description: 'Reference image', sourceUrl: 'http://example.com/ref.jpg' },
      ];
      const context = createMockContext({
        referencedMessages,
        preprocessedReferenceAttachments,
      });

      await processor.processInputs(mockPersonality, mockMessage, context, false, 'api-key');

      expect(mockReferencedMessageFormatter.formatReferencedMessages).toHaveBeenCalledWith(
        referencedMessages,
        mockPersonality,
        false,
        preprocessedReferenceAttachments,
        'api-key'
      );
    });

    it('should return complete ProcessedInputs structure', async () => {
      const context = createMockContext();

      const result = await processor.processInputs(mockPersonality, mockMessage, context, false);

      expect(result).toHaveProperty('processedAttachments');
      expect(result).toHaveProperty('userMessage');
      expect(result).toHaveProperty('searchQuery');
      expect(result.userMessage).toBe('formatted user message');
      expect(result.searchQuery).toBe('search query');
    });
  });
});
