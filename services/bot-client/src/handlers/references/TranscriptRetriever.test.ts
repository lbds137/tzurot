/**
 * Tests for TranscriptRetriever
 *
 * The retriever is Redis-cache-only — there is no DB tier in bot-client (the
 * worker owns the DB). A cache miss returns null; the worker recovers reference
 * transcripts from its own DB tier, and aged-out extended-context transcripts
 * are an accepted divergence. See the module docblock.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TranscriptRetriever } from './TranscriptRetriever.js';

// Mock Redis cache - must use factory function for vi.mock
vi.mock('../../redis.js', () => ({
  voiceTranscriptCache: {
    get: vi.fn(),
    store: vi.fn(),
  },
}));

// Mock logger
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
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
  let mockVoiceTranscriptCache: { get: ReturnType<typeof vi.fn>; store: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();

    const redisModule = await import('../../redis.js');
    mockVoiceTranscriptCache =
      redisModule.voiceTranscriptCache as unknown as typeof mockVoiceTranscriptCache;

    retriever = new TranscriptRetriever();
  });

  describe('Redis cache hit', () => {
    it('returns the transcript from the Redis cache when present', async () => {
      const transcript = 'This is a cached transcript';
      mockVoiceTranscriptCache.get.mockResolvedValue(transcript);

      const result = await retriever.retrieveTranscript('msg-123', 'https://example.com/voice.ogg');

      expect(result).toBe(transcript);
      expect(mockVoiceTranscriptCache.get).toHaveBeenCalledWith('https://example.com/voice.ogg');
    });

    it('keys the cache lookup by attachment URL, not message id', async () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(1000) + '/voice.ogg';
      mockVoiceTranscriptCache.get.mockResolvedValue('Transcript for long URL');

      const result = await retriever.retrieveTranscript('msg-123', longUrl);

      expect(result).toBe('Transcript for long URL');
      expect(mockVoiceTranscriptCache.get).toHaveBeenCalledWith(longUrl);
    });
  });

  describe('Redis cache miss (no DB tier — null, not a DB fallback)', () => {
    it('returns null on an empty-string cache value', async () => {
      mockVoiceTranscriptCache.get.mockResolvedValue('');

      const result = await retriever.retrieveTranscript('msg-123', 'https://example.com/voice.ogg');

      expect(result).toBeNull();
    });

    it('returns null on a null cache value', async () => {
      mockVoiceTranscriptCache.get.mockResolvedValue(null);

      const result = await retriever.retrieveTranscript('msg-123', 'https://example.com/voice.ogg');

      expect(result).toBeNull();
    });

    it('returns null on an undefined cache value', async () => {
      mockVoiceTranscriptCache.get.mockResolvedValue(undefined);

      const result = await retriever.retrieveTranscript('msg-123', 'https://example.com/voice.ogg');

      expect(result).toBeNull();
    });
  });

  describe('Error handling', () => {
    it('returns null when the Redis cache throws', async () => {
      mockVoiceTranscriptCache.get.mockRejectedValue(new Error('Redis connection failed'));

      const result = await retriever.retrieveTranscript('msg-123', 'https://example.com/voice.ogg');

      expect(result).toBeNull();
    });
  });
});
