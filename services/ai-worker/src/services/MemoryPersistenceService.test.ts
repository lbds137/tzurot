/**
 * Tests for MemoryPersistenceService
 *
 * Unit tests for memory storage, deferred storage, and content embedding building.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryPersistenceService } from './MemoryPersistenceService.js';
import type { LoadedPersonality } from '@tzurot/common-types';
import type { LongTermMemoryService } from './LongTermMemoryService.js';
import type { MemoryRetriever } from './MemoryRetriever.js';
import type { ConversationContext } from './ConversationalRAGTypes.js';

describe('MemoryPersistenceService', () => {
  let service: MemoryPersistenceService;
  let mockLongTermMemory: LongTermMemoryService;
  let mockMemoryRetriever: MemoryRetriever;

  const createMockPersonality = (overrides = {}): LoadedPersonality => ({
    id: 'personality-123',
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
    serverId: 'guild-123',
    conversationHistory: [],
    rawConversationHistory: [],
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();

    mockLongTermMemory = {
      storeInteraction: vi.fn().mockResolvedValue(undefined),
    } as unknown as LongTermMemoryService;

    mockMemoryRetriever = {
      resolvePersonaForMemory: vi.fn().mockResolvedValue({ personaId: 'persona-uuid-123' }),
    } as unknown as MemoryRetriever;

    service = new MemoryPersistenceService(mockLongTermMemory, mockMemoryRetriever);
  });

  describe('buildContentForEmbedding', () => {
    it('should return content as-is when no referenced content', () => {
      const result = service.buildContentForEmbedding('Main content', undefined);

      expect(result).toBe('Main content');
    });

    it('should return content as-is when referenced content is empty', () => {
      const result = service.buildContentForEmbedding('Main content', '');

      expect(result).toBe('Main content');
    });

    it('should append referenced content when present', () => {
      const result = service.buildContentForEmbedding(
        'User question',
        'Previously mentioned: important context'
      );

      expect(result).toBe(
        'User question\n\n[Referenced content: Previously mentioned: important context]'
      );
    });

    it('should handle multiline referenced content', () => {
      const referencedContent = 'Line 1\nLine 2\nLine 3';
      const result = service.buildContentForEmbedding('Question', referencedContent);

      expect(result).toContain('[Referenced content: Line 1\nLine 2\nLine 3]');
    });
  });

  describe('storeInteraction', () => {
    it('should resolve persona and store interaction', async () => {
      const personality = createMockPersonality();
      const context = createMockContext();

      await service.storeInteraction(
        personality,
        context,
        'User said hello',
        'Bot response',
        undefined
      );

      expect(mockMemoryRetriever.resolvePersonaForMemory).toHaveBeenCalledWith(
        'user-123',
        'personality-123'
      );
      expect(mockLongTermMemory.storeInteraction).toHaveBeenCalledWith(
        personality,
        'User said hello',
        'Bot response',
        context,
        'persona-uuid-123'
      );
    });

    it('should include referenced content in embedding', async () => {
      const personality = createMockPersonality();
      const context = createMockContext();

      await service.storeInteraction(
        personality,
        context,
        'User question',
        'Bot answer',
        'Referenced: prior message'
      );

      expect(mockLongTermMemory.storeInteraction).toHaveBeenCalledWith(
        personality,
        'User question\n\n[Referenced content: Referenced: prior message]',
        'Bot answer',
        context,
        'persona-uuid-123'
      );
    });

    it('should skip storage when no persona found', async () => {
      vi.mocked(mockMemoryRetriever.resolvePersonaForMemory).mockResolvedValue(null);

      const personality = createMockPersonality();
      const context = createMockContext();

      await service.storeInteraction(personality, context, 'User content', 'Response', undefined);

      expect(mockLongTermMemory.storeInteraction).not.toHaveBeenCalled();
    });
  });

  describe('buildDeferredMemoryData', () => {
    it('should build deferred data with persona resolved', async () => {
      const context = createMockContext();

      const result = await service.buildDeferredMemoryData(
        context,
        'personality-123',
        'User content',
        'Response content',
        undefined
      );

      expect(result).toEqual({
        contentForEmbedding: 'User content',
        responseContent: 'Response content',
        personaId: 'persona-uuid-123',
      });
    });

    it('should include referenced content in embedding', async () => {
      const context = createMockContext();

      const result = await service.buildDeferredMemoryData(
        context,
        'personality-123',
        'Question',
        'Answer',
        'Referenced text'
      );

      expect(result?.contentForEmbedding).toBe('Question\n\n[Referenced content: Referenced text]');
    });

    it('should return null when no persona found', async () => {
      vi.mocked(mockMemoryRetriever.resolvePersonaForMemory).mockResolvedValue(null);

      const context = createMockContext();

      const result = await service.buildDeferredMemoryData(
        context,
        'personality-123',
        'Content',
        'Response',
        undefined
      );

      expect(result).toBeNull();
    });

    it('should call resolvePersonaForMemory with correct arguments', async () => {
      const context = createMockContext({ userId: 'user-456' });

      await service.buildDeferredMemoryData(
        context,
        'personality-789',
        'Content',
        'Response',
        undefined
      );

      expect(mockMemoryRetriever.resolvePersonaForMemory).toHaveBeenCalledWith(
        'user-456',
        'personality-789'
      );
    });
  });

  describe('storeDeferredMemory', () => {
    it('should store memory using deferred data', async () => {
      const personality = createMockPersonality();
      const context = createMockContext();
      const deferredData = {
        contentForEmbedding: 'Embedded content',
        responseContent: 'Response',
        personaId: 'persona-uuid-999',
      };

      await service.storeDeferredMemory(personality, context, deferredData);

      expect(mockLongTermMemory.storeInteraction).toHaveBeenCalledWith(
        personality,
        'Embedded content',
        'Response',
        context,
        'persona-uuid-999'
      );
    });

    it('should use personaId from deferred data, not resolve again', async () => {
      const personality = createMockPersonality();
      const context = createMockContext();
      const deferredData = {
        contentForEmbedding: 'Content',
        responseContent: 'Response',
        personaId: 'already-resolved-persona',
      };

      await service.storeDeferredMemory(personality, context, deferredData);

      // Should not call resolvePersonaForMemory since we have the ID
      expect(mockMemoryRetriever.resolvePersonaForMemory).not.toHaveBeenCalled();
      expect(mockLongTermMemory.storeInteraction).toHaveBeenCalledWith(
        personality,
        'Content',
        'Response',
        context,
        'already-resolved-persona'
      );
    });

    it('should work with different personality and context combinations', async () => {
      const personality = createMockPersonality({ id: 'different-personality' });
      const context = createMockContext({
        userId: 'different-user',
        channelId: 'different-channel',
      });
      const deferredData = {
        contentForEmbedding: 'Deferred content',
        responseContent: 'Deferred response',
        personaId: 'deferred-persona',
      };

      await service.storeDeferredMemory(personality, context, deferredData);

      expect(mockLongTermMemory.storeInteraction).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'different-personality' }),
        'Deferred content',
        'Deferred response',
        expect.objectContaining({ userId: 'different-user' }),
        'deferred-persona'
      );
    });
  });
});
