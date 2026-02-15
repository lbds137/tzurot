/**
 * Tests for ResponsePostProcessor
 *
 * Unit tests for response cleaning, reasoning extraction, and reference filtering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResponsePostProcessor } from './ResponsePostProcessor.js';
import type { ReferencedMessage } from '@tzurot/common-types';

// Use vi.hoisted() to create mocks that persist across test resets
const {
  mockRemoveDuplicateResponse,
  mockStripResponseArtifacts,
  mockExtractThinkingBlocks,
  mockExtractApiReasoningContent,
  mockMergeThinkingContent,
  mockReplacePromptPlaceholders,
} = vi.hoisted(() => ({
  mockRemoveDuplicateResponse: vi.fn(),
  mockStripResponseArtifacts: vi.fn(),
  mockExtractThinkingBlocks: vi.fn(),
  mockExtractApiReasoningContent: vi.fn(),
  mockMergeThinkingContent: vi.fn(),
  mockReplacePromptPlaceholders: vi.fn(),
}));

vi.mock('../utils/duplicateDetection.js', () => ({
  removeDuplicateResponse: mockRemoveDuplicateResponse,
}));

vi.mock('../utils/responseArtifacts.js', () => ({
  stripResponseArtifacts: mockStripResponseArtifacts,
}));

vi.mock('../utils/thinkingExtraction.js', () => ({
  extractThinkingBlocks: mockExtractThinkingBlocks,
  extractApiReasoningContent: mockExtractApiReasoningContent,
  mergeThinkingContent: mockMergeThinkingContent,
}));

vi.mock('../utils/promptPlaceholders.js', () => ({
  replacePromptPlaceholders: mockReplacePromptPlaceholders,
}));

describe('ResponsePostProcessor', () => {
  let processor: ResponsePostProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new ResponsePostProcessor();

    // Default mock implementations
    mockRemoveDuplicateResponse.mockImplementation((content: string) => content);
    mockStripResponseArtifacts.mockImplementation((content: string) => content);
    mockExtractThinkingBlocks.mockReturnValue({ thinkingContent: null, visibleContent: '' });
    mockExtractApiReasoningContent.mockReturnValue(null);
    mockMergeThinkingContent.mockReturnValue(null);
    mockReplacePromptPlaceholders.mockImplementation((content: string) => content);
  });

  describe('extractApiReasoning', () => {
    it('should extract reasoning from additional_kwargs.reasoning (primary source)', () => {
      const additionalKwargs = { reasoning: 'API-level reasoning content' };

      const result = processor.extractApiReasoning(additionalKwargs, undefined);

      expect(result).toBe('API-level reasoning content');
      // Should not call fallback
      expect(mockExtractApiReasoningContent).not.toHaveBeenCalled();
    });

    it('should fall back to reasoning_details when additional_kwargs.reasoning is missing', () => {
      mockExtractApiReasoningContent.mockReturnValue('Fallback reasoning');
      const responseMetadata = { reasoning_details: [{ type: 'thinking', text: 'step1' }] };

      const result = processor.extractApiReasoning(undefined, responseMetadata);

      expect(result).toBe('Fallback reasoning');
      expect(mockExtractApiReasoningContent).toHaveBeenCalledWith([
        { type: 'thinking', text: 'step1' },
      ]);
    });

    it('should return null when no reasoning is available', () => {
      mockExtractApiReasoningContent.mockReturnValue(null);

      const result = processor.extractApiReasoning(undefined, undefined);

      expect(result).toBeNull();
    });

    it('should ignore empty reasoning string', () => {
      mockExtractApiReasoningContent.mockReturnValue('Fallback');
      const additionalKwargs = { reasoning: '' };

      const result = processor.extractApiReasoning(additionalKwargs, { reasoning_details: [] });

      expect(result).toBe('Fallback');
    });

    it('should ignore non-string reasoning values', () => {
      mockExtractApiReasoningContent.mockReturnValue(null);
      const additionalKwargs = { reasoning: 123 as unknown as string };

      const result = processor.extractApiReasoning(additionalKwargs, undefined);

      expect(result).toBeNull();
    });
  });

  describe('processThinkingContent', () => {
    it('should extract inline thinking and merge with API reasoning', () => {
      mockExtractThinkingBlocks.mockReturnValue({
        thinkingContent: 'Inline thinking',
        visibleContent: 'Visible response',
      });
      mockMergeThinkingContent.mockReturnValue('Merged: API + Inline');

      const result = processor.processThinkingContent('raw content', 'API reasoning');

      expect(result.visibleContent).toBe('Visible response');
      expect(result.thinkingContent).toBe('Merged: API + Inline');
      expect(mockMergeThinkingContent).toHaveBeenCalledWith('API reasoning', 'Inline thinking');
    });

    it('should return empty visible content when model only produces thinking', () => {
      mockExtractThinkingBlocks.mockReturnValue({
        thinkingContent: 'Only thinking, no response',
        visibleContent: '   ',
      });
      mockMergeThinkingContent.mockReturnValue('Only thinking, no response');

      const result = processor.processThinkingContent('raw', null);

      expect(result.visibleContent).toBe('   ');
      expect(result.thinkingContent).toBe('Only thinking, no response');
    });

    it('should handle content with no thinking', () => {
      mockExtractThinkingBlocks.mockReturnValue({
        thinkingContent: null,
        visibleContent: 'Just a normal response',
      });
      mockMergeThinkingContent.mockReturnValue(null);

      const result = processor.processThinkingContent('Just a normal response', null);

      expect(result.visibleContent).toBe('Just a normal response');
      expect(result.thinkingContent).toBeNull();
    });
  });

  describe('processResponse', () => {
    const defaultContext = {
      personalityName: 'TestBot',
      userName: 'TestUser',
      discordUsername: 'testuser#1234',
    };

    it('should run full processing pipeline in order', () => {
      // Set up mock chain - return same content to indicate no deduplication
      mockRemoveDuplicateResponse.mockReturnValue('raw content');
      mockExtractThinkingBlocks.mockReturnValue({
        thinkingContent: null,
        visibleContent: 'raw content',
      });
      mockMergeThinkingContent.mockReturnValue(null);
      mockStripResponseArtifacts.mockReturnValue('stripped');
      mockReplacePromptPlaceholders.mockReturnValue('final content');

      const result = processor.processResponse('raw content', undefined, undefined, defaultContext);

      expect(result.cleanedContent).toBe('final content');
      expect(result.thinkingContent).toBeNull();
      expect(result.wasDeduplicated).toBe(false);

      // Verify order of operations
      expect(mockRemoveDuplicateResponse).toHaveBeenCalledWith('raw content');
      expect(mockStripResponseArtifacts).toHaveBeenCalledWith('raw content', 'TestBot');
      expect(mockReplacePromptPlaceholders).toHaveBeenCalledWith(
        'stripped',
        'TestUser',
        'TestBot',
        'testuser#1234'
      );
    });

    it('should detect when deduplication was applied', () => {
      mockRemoveDuplicateResponse.mockReturnValue('shortened content');
      mockExtractThinkingBlocks.mockReturnValue({
        thinkingContent: null,
        visibleContent: 'shortened content',
      });

      const result = processor.processResponse(
        'original longer content',
        undefined,
        undefined,
        defaultContext
      );

      expect(result.wasDeduplicated).toBe(true);
    });

    it('should extract API reasoning when present', () => {
      const additionalKwargs = { reasoning: 'API thinking' };

      mockRemoveDuplicateResponse.mockReturnValue('content');
      mockExtractThinkingBlocks.mockReturnValue({
        thinkingContent: null,
        visibleContent: 'content',
      });
      mockMergeThinkingContent.mockReturnValue('API thinking');
      mockStripResponseArtifacts.mockReturnValue('content');
      mockReplacePromptPlaceholders.mockReturnValue('content');

      const result = processor.processResponse(
        'content',
        additionalKwargs,
        undefined,
        defaultContext
      );

      expect(result.thinkingContent).toBe('API thinking');
    });

    it('should handle response with both API and inline thinking', () => {
      const additionalKwargs = { reasoning: 'API level' };

      mockRemoveDuplicateResponse.mockReturnValue('<think>Inline</think>Response');
      mockExtractThinkingBlocks.mockReturnValue({
        thinkingContent: 'Inline',
        visibleContent: 'Response',
      });
      mockMergeThinkingContent.mockReturnValue('API level\n\n---\n\nInline');
      mockStripResponseArtifacts.mockReturnValue('Response');
      mockReplacePromptPlaceholders.mockReturnValue('Response');

      const result = processor.processResponse(
        '<think>Inline</think>Response',
        additionalKwargs,
        undefined,
        defaultContext
      );

      expect(result.thinkingContent).toBe('API level\n\n---\n\nInline');
      expect(result.cleanedContent).toBe('Response');
    });
  });

  describe('filterDuplicateReferences', () => {
    it('should return empty array when no references provided', () => {
      const result = processor.filterDuplicateReferences(undefined, []);
      expect(result).toEqual([]);
    });

    it('should return empty array when references is empty', () => {
      const result = processor.filterDuplicateReferences([], [{ id: 'msg1' }]);
      expect(result).toEqual([]);
    });

    it('should return all references when history is empty', () => {
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg1',
          discordUserId: 'user1',
          authorUsername: 'user1',
          authorDisplayName: 'User One',
          content: 'Hello',
          embeds: '',
          timestamp: '2025-01-01T00:00:00Z',
          locationContext: '<location/>',
        },
      ];

      const result = processor.filterDuplicateReferences(references, []);

      expect(result).toEqual(references);
    });

    it('should return all references when history is undefined', () => {
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg1',
          discordUserId: 'user1',
          authorUsername: 'user1',
          authorDisplayName: 'User One',
          content: 'Hello',
          embeds: '',
          timestamp: '2025-01-01T00:00:00Z',
          locationContext: '<location/>',
        },
      ];

      const result = processor.filterDuplicateReferences(references, undefined);

      expect(result).toEqual(references);
    });

    it('should filter out references that are in history', () => {
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg1',
          discordUserId: 'user1',
          authorUsername: 'user1',
          authorDisplayName: 'User One',
          content: 'Already in history',
          embeds: '',
          timestamp: '2025-01-01T00:00:00Z',
          locationContext: '<location/>',
        },
        {
          referenceNumber: 2,
          discordMessageId: 'msg2',
          discordUserId: 'user2',
          authorUsername: 'user2',
          authorDisplayName: 'User Two',
          content: 'Not in history',
          embeds: '',
          timestamp: '2025-01-01T00:01:00Z',
          locationContext: '<location/>',
        },
      ];

      const history = [{ id: 'msg1' }, { id: 'msg3' }];

      const result = processor.filterDuplicateReferences(references, history);

      expect(result).toHaveLength(1);
      expect(result[0].discordMessageId).toBe('msg2');
    });

    it('should filter out all references when all are in history', () => {
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg1',
          discordUserId: 'user1',
          authorUsername: 'user1',
          authorDisplayName: 'User One',
          content: 'In history',
          embeds: '',
          timestamp: '2025-01-01T00:00:00Z',
          locationContext: '<location/>',
        },
      ];

      const history = [{ id: 'msg1' }];

      const result = processor.filterDuplicateReferences(references, history);

      expect(result).toHaveLength(0);
    });

    it('should preserve references with isDeduplicated === true even when in history', () => {
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg1',
          discordUserId: 'user1',
          authorUsername: 'user1',
          authorDisplayName: 'User One',
          content: 'Deduped stub content',
          embeds: '',
          timestamp: '2025-01-01T00:00:00Z',
          locationContext: '',
          isDeduplicated: true,
        },
        {
          referenceNumber: 2,
          discordMessageId: 'msg2',
          discordUserId: 'user2',
          authorUsername: 'user2',
          authorDisplayName: 'User Two',
          content: 'Normal ref not in history',
          embeds: '',
          timestamp: '2025-01-01T00:01:00Z',
          locationContext: '<location/>',
        },
      ];

      const history = [{ id: 'msg1' }, { id: 'msg3' }];

      const result = processor.filterDuplicateReferences(references, history);

      // msg1 has isDeduplicated: true, so it should be preserved despite being in history
      expect(result).toHaveLength(2);
      expect(result[0].discordMessageId).toBe('msg1');
      expect(result[0].isDeduplicated).toBe(true);
      expect(result[1].discordMessageId).toBe('msg2');
    });

    it('should handle history entries without id field', () => {
      const references: ReferencedMessage[] = [
        {
          referenceNumber: 1,
          discordMessageId: 'msg1',
          discordUserId: 'user1',
          authorUsername: 'user1',
          authorDisplayName: 'User One',
          content: 'Reference',
          embeds: '',
          timestamp: '2025-01-01T00:00:00Z',
          locationContext: '<location/>',
        },
      ];

      const history = [{ content: 'no id' }, { id: '' }, { id: 'msg2' }];

      const result = processor.filterDuplicateReferences(references, history);

      expect(result).toHaveLength(1);
      expect(result[0].discordMessageId).toBe('msg1');
    });
  });
});
