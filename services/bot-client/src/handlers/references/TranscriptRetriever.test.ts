/**
 * Tests for TranscriptRetriever
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TranscriptRetriever } from './TranscriptRetriever.js';
import type { ConversationHistoryService } from '@tzurot/common-types';

// Mock Redis cache - must use factory function for vi.mock
vi.mock('../../redis.js', () => ({
  voiceTranscriptCache: {
    get: vi.fn(),
    store: vi.fn(),
  },
}));

// Mock logger
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  };
});

describe('TranscriptRetriever', () => {
  let retriever: TranscriptRetriever;
  let mockConversationHistoryService: ConversationHistoryService;
  let mockVoiceTranscriptCache: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Get the mocked cache
    const redisModule = await import('../../redis.js');
    mockVoiceTranscriptCache = redisModule.voiceTranscriptCache;

    mockConversationHistoryService = {
      getMessageByDiscordId: vi.fn(),
    } as any;

    retriever = new TranscriptRetriever(mockConversationHistoryService);
  });

  describe('Redis Cache (Tier 1)', () => {
    it('should return transcript from Redis cache when available', async () => {
      const transcript = 'This is a cached transcript';
      mockVoiceTranscriptCache.get.mockResolvedValue(transcript);

      const result = await retriever.retrieveTranscript('msg-123', 'https://example.com/voice.ogg');

      expect(result).toBe(transcript);
      expect(mockVoiceTranscriptCache.get).toHaveBeenCalledWith('https://example.com/voice.ogg');
      // Should not check database if cache hit
      expect(mockConversationHistoryService.getMessageByDiscordId).not.toHaveBeenCalled();
    });

    it('should skip empty string from cache', async () => {
      mockVoiceTranscriptCache.get.mockResolvedValue('');
      vi.mocked(mockConversationHistoryService.getMessageByDiscordId).mockResolvedValue({
        id: 1,
        content: 'Database transcript',
      } as any);

      const result = await retriever.retrieveTranscript('msg-123', 'https://example.com/voice.ogg');

      // Should fall through to database
      expect(result).toBe('Database transcript');
      expect(mockConversationHistoryService.getMessageByDiscordId).toHaveBeenCalled();
    });

    it('should skip null from cache', async () => {
      mockVoiceTranscriptCache.get.mockResolvedValue(null);
      vi.mocked(mockConversationHistoryService.getMessageByDiscordId).mockResolvedValue({
        id: 1,
        content: 'Database transcript',
      } as any);

      const result = await retriever.retrieveTranscript('msg-123', 'https://example.com/voice.ogg');

      // Should fall through to database
      expect(result).toBe('Database transcript');
      expect(mockConversationHistoryService.getMessageByDiscordId).toHaveBeenCalled();
    });

    it('should skip undefined from cache', async () => {
      mockVoiceTranscriptCache.get.mockResolvedValue(undefined);
      vi.mocked(mockConversationHistoryService.getMessageByDiscordId).mockResolvedValue({
        id: 1,
        content: 'Database transcript',
      } as any);

      const result = await retriever.retrieveTranscript('msg-123', 'https://example.com/voice.ogg');

      // Should fall through to database
      expect(result).toBe('Database transcript');
      expect(mockConversationHistoryService.getMessageByDiscordId).toHaveBeenCalled();
    });
  });

  describe('Database (Tier 2)', () => {
    it('should return transcript from database when cache misses', async () => {
      mockVoiceTranscriptCache.get.mockResolvedValue(null);
      vi.mocked(mockConversationHistoryService.getMessageByDiscordId).mockResolvedValue({
        id: 1,
        discordMessageId: 'msg-123',
        content: 'Database transcript text',
      } as any);

      const result = await retriever.retrieveTranscript('msg-123', 'https://example.com/voice.ogg');

      expect(result).toBe('Database transcript text');
      expect(mockConversationHistoryService.getMessageByDiscordId).toHaveBeenCalledWith('msg-123');
    });

    it('should return null when message not found in database', async () => {
      mockVoiceTranscriptCache.get.mockResolvedValue(null);
      vi.mocked(mockConversationHistoryService.getMessageByDiscordId).mockResolvedValue(null);

      const result = await retriever.retrieveTranscript('msg-123', 'https://example.com/voice.ogg');

      expect(result).toBeNull();
    });

    it('should return null when database message has no content', async () => {
      mockVoiceTranscriptCache.get.mockResolvedValue(null);
      vi.mocked(mockConversationHistoryService.getMessageByDiscordId).mockResolvedValue({
        id: 1,
        content: null,
      } as any);

      const result = await retriever.retrieveTranscript('msg-123', 'https://example.com/voice.ogg');

      expect(result).toBeNull();
    });

    it('should return null when database message has empty content', async () => {
      mockVoiceTranscriptCache.get.mockResolvedValue(null);
      vi.mocked(mockConversationHistoryService.getMessageByDiscordId).mockResolvedValue({
        id: 1,
        content: '',
      } as any);

      const result = await retriever.retrieveTranscript('msg-123', 'https://example.com/voice.ogg');

      expect(result).toBeNull();
    });
  });

  describe('Error Handling', () => {
    it('should return null when Redis cache throws error', async () => {
      mockVoiceTranscriptCache.get.mockRejectedValue(new Error('Redis connection failed'));
      vi.mocked(mockConversationHistoryService.getMessageByDiscordId).mockResolvedValue({
        id: 1,
        content: 'Database transcript',
      } as any);

      const result = await retriever.retrieveTranscript('msg-123', 'https://example.com/voice.ogg');

      // Should handle error gracefully and return null
      expect(result).toBeNull();
    });

    it('should return null when database throws error', async () => {
      mockVoiceTranscriptCache.get.mockResolvedValue(null);
      vi.mocked(mockConversationHistoryService.getMessageByDiscordId).mockRejectedValue(
        new Error('Database query failed')
      );

      const result = await retriever.retrieveTranscript('msg-123', 'https://example.com/voice.ogg');

      // Should handle error gracefully and return null
      expect(result).toBeNull();
    });

    it('should return null when both cache and database fail', async () => {
      mockVoiceTranscriptCache.get.mockRejectedValue(new Error('Redis error'));
      vi.mocked(mockConversationHistoryService.getMessageByDiscordId).mockRejectedValue(
        new Error('Database error')
      );

      const result = await retriever.retrieveTranscript('msg-123', 'https://example.com/voice.ogg');

      expect(result).toBeNull();
    });
  });

  describe('Integration Scenarios', () => {
    it('should prefer cache over database when both have data', async () => {
      mockVoiceTranscriptCache.get.mockResolvedValue('Cached transcript');
      vi.mocked(mockConversationHistoryService.getMessageByDiscordId).mockResolvedValue({
        id: 1,
        content: 'Database transcript',
      } as any);

      const result = await retriever.retrieveTranscript('msg-123', 'https://example.com/voice.ogg');

      expect(result).toBe('Cached transcript');
      // Should not query database if cache hit
      expect(mockConversationHistoryService.getMessageByDiscordId).not.toHaveBeenCalled();
    });

    it('should handle long attachment URLs gracefully', async () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(1000) + '/voice.ogg';
      mockVoiceTranscriptCache.get.mockResolvedValue('Transcript for long URL');

      const result = await retriever.retrieveTranscript('msg-123', longUrl);

      expect(result).toBe('Transcript for long URL');
      expect(mockVoiceTranscriptCache.get).toHaveBeenCalledWith(longUrl);
    });

    it('should handle different message IDs correctly', async () => {
      mockVoiceTranscriptCache.get.mockResolvedValue(null);

      vi.mocked(mockConversationHistoryService.getMessageByDiscordId)
        .mockResolvedValueOnce({
          id: 1,
          discordMessageId: 'msg-123',
          content: 'First transcript',
        } as any)
        .mockResolvedValueOnce({
          id: 2,
          discordMessageId: 'msg-456',
          content: 'Second transcript',
        } as any);

      const result1 = await retriever.retrieveTranscript(
        'msg-123',
        'https://example.com/voice1.ogg'
      );
      const result2 = await retriever.retrieveTranscript(
        'msg-456',
        'https://example.com/voice2.ogg'
      );

      expect(result1).toBe('First transcript');
      expect(result2).toBe('Second transcript');
      expect(mockConversationHistoryService.getMessageByDiscordId).toHaveBeenCalledTimes(2);
    });
  });
});
