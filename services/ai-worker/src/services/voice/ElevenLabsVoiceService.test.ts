/**
 * Tests for ElevenLabsVoiceService
 *
 * Covers: cache hit, cache miss + clone, negative cache, in-flight dedup,
 * existing voice found in account, different API keys = different cache.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ElevenLabsVoiceService } from './ElevenLabsVoiceService.js';
import { ElevenLabsApiError } from './ElevenLabsClient.js';
import type { EnvConfig } from '@tzurot/common-types';

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
    getConfig: () =>
      ({
        GATEWAY_URL: 'http://localhost:3000',
      }) as unknown as EnvConfig,
  };
});

const mockListVoices = vi.fn();
const mockCloneVoice = vi.fn();
const mockDeleteVoice = vi.fn();

vi.mock('./ElevenLabsClient.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./ElevenLabsClient.js')>();
  return {
    ...actual,
    elevenLabsListVoices: (...args: unknown[]) => mockListVoices(...args),
    elevenLabsCloneVoice: (...args: unknown[]) => mockCloneVoice(...args),
    elevenLabsDeleteVoice: (...args: unknown[]) => mockDeleteVoice(...args),
  };
});

// Mock global fetch for gateway reference audio
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('ElevenLabsVoiceService', () => {
  let service: ElevenLabsVoiceService;
  const testApiKey = 'sk_test_key_123';

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ElevenLabsVoiceService();

    // Default: gateway returns reference audio successfully
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(100)),
      headers: { get: vi.fn().mockReturnValue('audio/wav') },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should find existing voice in account and cache it', async () => {
    mockListVoices.mockResolvedValue([
      { voiceId: 'existing-v1', name: 'tzurot-testbot' },
      { voiceId: 'other-v1', name: 'My Voice' },
    ]);

    const voiceId = await service.ensureVoiceCloned('testbot', testApiKey);

    expect(voiceId).toBe('existing-v1');
    expect(mockCloneVoice).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should clone voice when not found in account', async () => {
    mockListVoices.mockResolvedValue([]);
    mockCloneVoice.mockResolvedValue({ voiceId: 'new-clone-v1' });

    const voiceId = await service.ensureVoiceCloned('newbot', testApiKey);

    expect(voiceId).toBe('new-clone-v1');
    expect(mockCloneVoice).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'tzurot-newbot',
        apiKey: testApiKey,
      })
    );
    // Should have fetched reference audio from gateway
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/voice-references/newbot',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('should return cached voice on second call', async () => {
    mockListVoices.mockResolvedValue([{ voiceId: 'cached-v1', name: 'tzurot-cachedbot' }]);

    await service.ensureVoiceCloned('cachedbot', testApiKey);
    const voiceId = await service.ensureVoiceCloned('cachedbot', testApiKey);

    expect(voiceId).toBe('cached-v1');
    expect(mockListVoices).toHaveBeenCalledTimes(1);
  });

  it('should use different cache entries for different API keys', async () => {
    // User A's account has the voice
    mockListVoices
      .mockResolvedValueOnce([{ voiceId: 'userA-v1', name: 'tzurot-sharedbot' }])
      .mockResolvedValueOnce([{ voiceId: 'userB-v1', name: 'tzurot-sharedbot' }]);

    const voiceA = await service.ensureVoiceCloned('sharedbot', 'sk_user_a');
    const voiceB = await service.ensureVoiceCloned('sharedbot', 'sk_user_b');

    expect(voiceA).toBe('userA-v1');
    expect(voiceB).toBe('userB-v1');
    expect(mockListVoices).toHaveBeenCalledTimes(2);
  });

  it('should negatively cache clone failures', async () => {
    mockListVoices.mockResolvedValue([]);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    // First call: fails
    await expect(service.ensureVoiceCloned('badbot', testApiKey)).rejects.toThrow(
      'Failed to fetch voice reference'
    );

    // Second call: fails from negative cache without calling gateway
    mockFetch.mockClear();
    mockListVoices.mockClear();

    await expect(service.ensureVoiceCloned('badbot', testApiKey)).rejects.toThrow(
      'recently failed'
    );

    expect(mockListVoices).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should NOT negatively cache rate limit errors (429)', async () => {
    mockListVoices.mockResolvedValue([]);
    mockCloneVoice.mockRejectedValueOnce(new ElevenLabsApiError(429, 'Rate limited'));

    // First call: fails with 429
    await expect(service.ensureVoiceCloned('ratebot', testApiKey)).rejects.toThrow(
      ElevenLabsApiError
    );

    // Second call: should retry (not negatively cached)
    mockListVoices.mockResolvedValue([{ voiceId: 'retry-v1', name: 'tzurot-ratebot' }]);

    const voiceId = await service.ensureVoiceCloned('ratebot', testApiKey);
    expect(voiceId).toBe('retry-v1');
  });

  it('should retry after clearCache', async () => {
    mockListVoices.mockResolvedValue([]);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    // First call: fails
    await expect(service.ensureVoiceCloned('retrybot', testApiKey)).rejects.toThrow();

    service.clearCache();

    // After cache clear, should retry
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(50)),
      headers: { get: vi.fn().mockReturnValue('audio/wav') },
    });
    mockCloneVoice.mockResolvedValue({ voiceId: 'retry-v2' });

    const voiceId = await service.ensureVoiceCloned('retrybot', testApiKey);
    expect(voiceId).toBe('retry-v2');
  });

  it('should proceed with clone when listVoices fails', async () => {
    mockListVoices.mockRejectedValue(new Error('List failed'));
    mockCloneVoice.mockResolvedValue({ voiceId: 'fallback-v1' });

    const voiceId = await service.ensureVoiceCloned('fallbackbot', testApiKey);

    expect(voiceId).toBe('fallback-v1');
    expect(mockCloneVoice).toHaveBeenCalled();
  });

  it('should URL-encode slug in gateway request', async () => {
    mockListVoices.mockResolvedValue([]);
    mockCloneVoice.mockResolvedValue({ voiceId: 'encoded-v1' });

    await service.ensureVoiceCloned('bot with spaces', testApiKey);

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/voice-references/bot%20with%20spaces',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('should allow re-clone after invalidateVoice', async () => {
    // First call: voice found in account, cached
    mockListVoices.mockResolvedValueOnce([{ voiceId: 'old-v1', name: 'tzurot-stalebot' }]);

    const oldVoice = await service.ensureVoiceCloned('stalebot', testApiKey);
    expect(oldVoice).toBe('old-v1');

    // Invalidate (simulates TTSStep detecting a 404 from ElevenLabs)
    service.invalidateVoice('stalebot', testApiKey);

    // Next call: voice no longer in account, triggers re-clone
    mockListVoices.mockResolvedValueOnce([]);
    mockCloneVoice.mockResolvedValueOnce({ voiceId: 'new-v1' });

    const newVoice = await service.ensureVoiceCloned('stalebot', testApiKey);
    expect(newVoice).toBe('new-v1');
    expect(mockCloneVoice).toHaveBeenCalledTimes(1);
  });

  it('should deduplicate concurrent calls for the same slug+key', async () => {
    mockListVoices.mockResolvedValue([]);
    mockCloneVoice.mockResolvedValue({ voiceId: 'dedup-v1' });

    // Fire two concurrent calls
    const [result1, result2] = await Promise.all([
      service.ensureVoiceCloned('dedupbot', testApiKey),
      service.ensureVoiceCloned('dedupbot', testApiKey),
    ]);

    expect(result1).toBe('dedup-v1');
    expect(result2).toBe('dedup-v1');
    // Should only clone once despite two concurrent calls
    expect(mockCloneVoice).toHaveBeenCalledTimes(1);
  });

  describe('voice slot eviction', () => {
    const voiceLimitError = new ElevenLabsApiError(
      400,
      'You have reached the maximum number of voices'
    );

    it('should evict stale voice and re-clone on voice limit error', async () => {
      mockListVoices.mockResolvedValue([
        { voiceId: 'stale-v1', name: 'tzurot-oldbot' },
        { voiceId: 'other-v1', name: 'tzurot-otherbot' },
      ]);
      mockCloneVoice
        .mockRejectedValueOnce(voiceLimitError)
        .mockResolvedValueOnce({ voiceId: 'new-clone-v1' });
      mockDeleteVoice.mockResolvedValue(undefined);

      const voiceId = await service.ensureVoiceCloned('newbot', testApiKey);

      expect(voiceId).toBe('new-clone-v1');
      expect(mockDeleteVoice).toHaveBeenCalledWith('stale-v1', testApiKey);
      expect(mockCloneVoice).toHaveBeenCalledTimes(2);
    });

    it('should throw when all tzurot voices are warm (in cache)', async () => {
      // Pre-warm the cache by finding an existing voice
      mockListVoices.mockResolvedValueOnce([{ voiceId: 'warm-v1', name: 'tzurot-warmbot' }]);
      await service.ensureVoiceCloned('warmbot', testApiKey);

      // Now try to clone a new voice — limit hit, but warmbot is cached
      mockListVoices.mockResolvedValueOnce([{ voiceId: 'warm-v1', name: 'tzurot-warmbot' }]);
      mockCloneVoice.mockRejectedValueOnce(voiceLimitError);

      await expect(service.ensureVoiceCloned('newbot', testApiKey)).rejects.toThrow(
        'No evictable voices'
      );
      expect(mockDeleteVoice).not.toHaveBeenCalled();
    });

    it('should skip warm (cached) voices and evict cold ones', async () => {
      // Pre-warm one voice in cache
      mockListVoices.mockResolvedValueOnce([{ voiceId: 'warm-v1', name: 'tzurot-warmbot' }]);
      await service.ensureVoiceCloned('warmbot', testApiKey);

      // Now try to clone — list has warm + cold voice
      mockListVoices.mockResolvedValueOnce([
        { voiceId: 'warm-v1', name: 'tzurot-warmbot' },
        { voiceId: 'cold-v1', name: 'tzurot-coldbot' },
      ]);
      mockCloneVoice
        .mockRejectedValueOnce(voiceLimitError)
        .mockResolvedValueOnce({ voiceId: 'new-v1' });
      mockDeleteVoice.mockResolvedValue(undefined);

      const voiceId = await service.ensureVoiceCloned('newbot', testApiKey);

      expect(voiceId).toBe('new-v1');
      // Should evict cold, not warm
      expect(mockDeleteVoice).toHaveBeenCalledWith('cold-v1', testApiKey);
    });

    // Note: inflight filtering is a defensive safety net that's structurally
    // untestable through the full service flow — a voice being cloned (inflight)
    // won't appear in the voice list (it doesn't exist yet), so it can't be an
    // eviction candidate regardless. The cache-based filtering is validated by
    // the "skip warm" test above, which covers the same filtering pattern.

    it('should propagate error when delete fails during eviction', async () => {
      mockListVoices.mockResolvedValue([{ voiceId: 'stale-v1', name: 'tzurot-stalebot' }]);
      mockCloneVoice.mockRejectedValueOnce(voiceLimitError);
      mockDeleteVoice.mockRejectedValue(new ElevenLabsApiError(404, 'Voice not found'));

      await expect(service.ensureVoiceCloned('newbot', testApiKey)).rejects.toThrow(
        'Voice not found'
      );
    });

    it('should propagate error when re-clone fails after eviction', async () => {
      mockListVoices.mockResolvedValue([{ voiceId: 'stale-v1', name: 'tzurot-stalebot' }]);
      mockCloneVoice
        .mockRejectedValueOnce(voiceLimitError)
        .mockRejectedValueOnce(new ElevenLabsApiError(400, 'Audio too short'));
      mockDeleteVoice.mockResolvedValue(undefined);

      await expect(service.ensureVoiceCloned('newbot', testApiKey)).rejects.toThrow(
        'Audio too short'
      );
      expect(mockDeleteVoice).toHaveBeenCalledTimes(1);
    });

    it('should not trigger eviction for non-limit 400 error', async () => {
      mockListVoices.mockResolvedValue([{ voiceId: 'stale-v1', name: 'tzurot-stalebot' }]);
      mockCloneVoice.mockRejectedValueOnce(new ElevenLabsApiError(400, 'Bad request'));

      await expect(service.ensureVoiceCloned('newbot', testApiKey)).rejects.toThrow('Bad request');
      expect(mockDeleteVoice).not.toHaveBeenCalled();
    });

    it('should throw when voice list is empty (listing failed earlier)', async () => {
      mockListVoices.mockRejectedValue(new Error('Network error'));
      mockCloneVoice.mockRejectedValueOnce(voiceLimitError);

      await expect(service.ensureVoiceCloned('newbot', testApiKey)).rejects.toThrow(
        'No evictable voices'
      );
      expect(mockDeleteVoice).not.toHaveBeenCalled();
    });

    it('should not evict non-tzurot voices', async () => {
      mockListVoices.mockResolvedValue([
        { voiceId: 'personal-v1', name: 'My Custom Voice' },
        { voiceId: 'personal-v2', name: 'Another Voice' },
      ]);
      mockCloneVoice.mockRejectedValueOnce(voiceLimitError);

      await expect(service.ensureVoiceCloned('newbot', testApiKey)).rejects.toThrow(
        'No evictable voices'
      );
      expect(mockDeleteVoice).not.toHaveBeenCalled();
    });
  });
});
