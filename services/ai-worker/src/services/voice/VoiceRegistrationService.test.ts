/**
 * Tests for VoiceRegistrationService
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VoiceRegistrationService } from './VoiceRegistrationService.js';
import { VoiceEngineError } from './VoiceEngineClient.js';
import type { VoiceEngineClient } from './VoiceEngineClient.js';
import * as commonTypes from '@tzurot/common-types';
import { TimeoutError, type EnvConfig } from '@tzurot/common-types';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('VoiceRegistrationService', () => {
  let service: VoiceRegistrationService;
  let mockVoiceEngineClient: {
    listVoices: ReturnType<typeof vi.fn>;
    registerVoice: ReturnType<typeof vi.fn>;
  };
  let getConfigSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockVoiceEngineClient = {
      listVoices: vi.fn(),
      registerVoice: vi.fn(),
    };

    getConfigSpy = vi.spyOn(commonTypes, 'getConfig').mockReturnValue({
      GATEWAY_URL: 'http://localhost:3000',
    } as unknown as EnvConfig);

    service = new VoiceRegistrationService(mockVoiceEngineClient as unknown as VoiceEngineClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should skip listVoices on cache hit (second call for same slug)', async () => {
    mockVoiceEngineClient.listVoices.mockResolvedValue(['my-voice']);

    await service.ensureVoiceRegistered('my-voice');
    await service.ensureVoiceRegistered('my-voice');

    expect(mockVoiceEngineClient.listVoices).toHaveBeenCalledTimes(1);
  });

  it('should cache and return when voice is already registered on voice-engine', async () => {
    mockVoiceEngineClient.listVoices.mockResolvedValue(['existing-voice', 'other-voice']);

    await service.ensureVoiceRegistered('existing-voice');

    expect(mockVoiceEngineClient.listVoices).toHaveBeenCalledOnce();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockVoiceEngineClient.registerVoice).not.toHaveBeenCalled();
  });

  it('should fetch from gateway and register when voice is not on voice-engine', async () => {
    mockVoiceEngineClient.listVoices.mockResolvedValue([]);
    mockVoiceEngineClient.registerVoice.mockResolvedValue(undefined);
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(100)),
      headers: { get: vi.fn().mockReturnValue('audio/wav') },
    });

    await service.ensureVoiceRegistered('new-voice');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/voice-references/new-voice',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(mockVoiceEngineClient.registerVoice).toHaveBeenCalledWith(
      'new-voice',
      expect.any(Buffer),
      'audio/wav'
    );
  });

  it('should throw when gateway fetch returns 404', async () => {
    mockVoiceEngineClient.listVoices.mockResolvedValue([]);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    await expect(service.ensureVoiceRegistered('missing-voice')).rejects.toThrow(
      'Failed to fetch voice reference for "missing-voice": 404 Not Found'
    );
  });

  it('should attempt registration when listVoices fails', async () => {
    mockVoiceEngineClient.listVoices.mockRejectedValue(new Error('Connection refused'));
    mockVoiceEngineClient.registerVoice.mockResolvedValue(undefined);
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(50)),
      headers: { get: vi.fn().mockReturnValue('audio/wav') },
    });

    await service.ensureVoiceRegistered('fallback-voice');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/voice-references/fallback-voice',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(mockVoiceEngineClient.registerVoice).toHaveBeenCalledWith(
      'fallback-voice',
      expect.any(Buffer),
      'audio/wav'
    );
  });

  it('should throw when GATEWAY_URL is not configured', async () => {
    getConfigSpy.mockReturnValue({
      GATEWAY_URL: undefined,
    } as unknown as EnvConfig);

    mockVoiceEngineClient.listVoices.mockResolvedValue([]);

    await expect(service.ensureVoiceRegistered('no-gateway')).rejects.toThrow(
      'GATEWAY_URL not configured'
    );
  });

  it('should go through full flow after clearCache', async () => {
    // First call: registers and caches
    mockVoiceEngineClient.listVoices.mockResolvedValue(['cached-voice']);
    await service.ensureVoiceRegistered('cached-voice');
    expect(mockVoiceEngineClient.listVoices).toHaveBeenCalledTimes(1);

    // Clear cache
    service.clearCache();

    // Second call: must go through listVoices again
    mockVoiceEngineClient.listVoices.mockResolvedValue(['cached-voice']);
    await service.ensureVoiceRegistered('cached-voice');
    expect(mockVoiceEngineClient.listVoices).toHaveBeenCalledTimes(2);
  });

  it('should default content-type to audio/wav when header is null', async () => {
    mockVoiceEngineClient.listVoices.mockResolvedValue([]);
    mockVoiceEngineClient.registerVoice.mockResolvedValue(undefined);
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(80)),
      headers: { get: vi.fn().mockReturnValue(null) },
    });

    await service.ensureVoiceRegistered('null-ct-voice');

    expect(mockVoiceEngineClient.registerVoice).toHaveBeenCalledWith(
      'null-ct-voice',
      expect.any(Buffer),
      'audio/wav'
    );
  });

  it('should throw typed TimeoutError when gateway fetch times out', async () => {
    mockVoiceEngineClient.listVoices.mockResolvedValue([]);

    const timeoutError = new DOMException('The operation timed out', 'TimeoutError');
    mockFetch.mockRejectedValue(timeoutError);

    const error = await service.ensureVoiceRegistered('slow-voice').catch(e => e);

    expect(error).toBeInstanceOf(TimeoutError);
    expect((error as TimeoutError).operationName).toBe('voice reference fetch for "slow-voice"');
    expect((error as TimeoutError).timeoutMs).toBe(15_000);
  });

  it('should cache failure and reject immediately on retry (negative caching)', async () => {
    mockVoiceEngineClient.listVoices.mockResolvedValue([]);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    // First call: fails and caches
    await expect(service.ensureVoiceRegistered('bad-voice')).rejects.toThrow(
      'Failed to fetch voice reference for "bad-voice": 404 Not Found'
    );

    // Second call: fails immediately from negative cache without hitting gateway
    mockFetch.mockClear();
    mockVoiceEngineClient.listVoices.mockClear();

    await expect(service.ensureVoiceRegistered('bad-voice')).rejects.toThrow(
      'Voice registration for "bad-voice" recently failed'
    );

    // Should NOT have called listVoices or fetch on the second attempt
    expect(mockVoiceEngineClient.listVoices).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should retry after clearCache clears negative entries', async () => {
    mockVoiceEngineClient.listVoices.mockResolvedValue([]);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    // First call: fails and caches
    await expect(service.ensureVoiceRegistered('retry-voice')).rejects.toThrow();

    // Clear caches
    service.clearCache();

    // Now mock a successful response
    mockVoiceEngineClient.registerVoice.mockResolvedValue(undefined);
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(50)),
      headers: { get: vi.fn().mockReturnValue('audio/wav') },
    });

    // Should succeed after cache clear
    await service.ensureVoiceRegistered('retry-voice');
    expect(mockVoiceEngineClient.registerVoice).toHaveBeenCalledWith(
      'retry-voice',
      expect.any(Buffer),
      'audio/wav'
    );
  });

  it('should NOT negatively cache connection errors (ECONNREFUSED)', async () => {
    mockVoiceEngineClient.listVoices.mockResolvedValue([]);

    // First call: ECONNREFUSED (voice engine sleeping)
    const connError = new Error('fetch failed');
    (connError as NodeJS.ErrnoException).code = 'ECONNREFUSED';
    mockFetch.mockRejectedValue(connError);

    await expect(service.ensureVoiceRegistered('wake-voice')).rejects.toThrow('fetch failed');

    // Second call: should retry (NOT hit negative cache)
    mockFetch.mockClear();
    mockVoiceEngineClient.listVoices.mockClear();

    // Voice engine is now awake — mock success
    mockVoiceEngineClient.listVoices.mockResolvedValue(['wake-voice']);

    await service.ensureVoiceRegistered('wake-voice');

    // Should have called listVoices again (not blocked by negative cache)
    expect(mockVoiceEngineClient.listVoices).toHaveBeenCalledOnce();
  });

  it('should NOT negatively cache errors with ECONNREFUSED in cause chain', async () => {
    mockVoiceEngineClient.listVoices.mockResolvedValue([]);

    // Node fetch wraps connection errors in a cause chain
    const innerError = new Error('connect ECONNREFUSED');
    (innerError as NodeJS.ErrnoException).code = 'ECONNREFUSED';
    const outerError = new Error('fetch failed', { cause: innerError });
    mockFetch.mockRejectedValue(outerError);

    await expect(service.ensureVoiceRegistered('nested-voice')).rejects.toThrow('fetch failed');

    // Second call: should retry (not cached)
    mockVoiceEngineClient.listVoices.mockResolvedValue(['nested-voice']);
    await service.ensureVoiceRegistered('nested-voice');
    expect(mockVoiceEngineClient.listVoices).toHaveBeenCalledTimes(2);
  });

  it('should NOT negatively cache errors with exact "fetch failed" message (no code)', async () => {
    mockVoiceEngineClient.listVoices.mockResolvedValue([]);

    // undici emits 'fetch failed' without a code property — should still bypass negative cache
    const fetchError = new Error('fetch failed');
    mockFetch.mockRejectedValue(fetchError);

    await expect(service.ensureVoiceRegistered('undici-voice')).rejects.toThrow('fetch failed');

    // Second call: should retry (not cached)
    mockVoiceEngineClient.listVoices.mockResolvedValue(['undici-voice']);
    await service.ensureVoiceRegistered('undici-voice');
    expect(mockVoiceEngineClient.listVoices).toHaveBeenCalledTimes(2);
  });

  it.each([
    [502, 'Bad Gateway', 'Railway LB up, app not yet ready'],
    [503, 'TTS model not loaded', 'voice-engine models still loading'],
    [504, 'Gateway Timeout', 'Railway LB timeout during boot'],
  ] as const)(
    'should NOT negatively cache %i VoiceEngineError (%s — %s)',
    async (status, detail, _scenario) => {
      // Realistic path: listVoices returns empty, gateway fetch succeeds,
      // but registerVoice throws transient HTTP error during cold start
      mockVoiceEngineClient.listVoices.mockResolvedValue([]);
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(100)),
        headers: { get: vi.fn().mockReturnValue('audio/wav') },
      });
      mockVoiceEngineClient.registerVoice.mockRejectedValue(new VoiceEngineError(status, detail));

      const slug = `transient-${status}`;
      await expect(service.ensureVoiceRegistered(slug)).rejects.toThrow(
        `Voice engine request failed (${status})`
      );

      // Second call: should retry (NOT hit negative cache)
      mockVoiceEngineClient.listVoices.mockClear();
      mockVoiceEngineClient.registerVoice.mockClear();

      // Engine is now ready and voice was registered between calls
      mockVoiceEngineClient.listVoices.mockResolvedValue([slug]);

      await service.ensureVoiceRegistered(slug);

      expect(mockVoiceEngineClient.listVoices).toHaveBeenCalledOnce();
    }
  );

  it('should negatively cache non-transient VoiceEngineError (e.g., 400)', async () => {
    // Realistic path: listVoices returns empty, gateway fetch succeeds,
    // but registerVoice throws 400 (bad audio format — permanent error)
    mockVoiceEngineClient.listVoices.mockResolvedValue([]);
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(100)),
      headers: { get: vi.fn().mockReturnValue('audio/wav') },
    });
    mockVoiceEngineClient.registerVoice.mockRejectedValue(
      new VoiceEngineError(400, 'Invalid audio format')
    );

    await expect(service.ensureVoiceRegistered('bad-audio')).rejects.toThrow(
      'Voice engine request failed (400)'
    );

    // Second call: should be negatively cached
    mockVoiceEngineClient.listVoices.mockClear();
    mockVoiceEngineClient.registerVoice.mockClear();

    await expect(service.ensureVoiceRegistered('bad-audio')).rejects.toThrow(
      'Voice registration for "bad-audio" recently failed'
    );
    expect(mockVoiceEngineClient.listVoices).not.toHaveBeenCalled();
  });

  it('should negatively cache errors with "fetch failed" substring in longer message', async () => {
    mockVoiceEngineClient.listVoices.mockResolvedValue([]);

    // An error that merely contains "fetch failed" in a longer message is NOT a connection error
    const otherError = new Error('to fetch failed to parse response');
    mockFetch.mockRejectedValue(otherError);

    await expect(service.ensureVoiceRegistered('parse-voice')).rejects.toThrow();

    // Second call: should be negatively cached (NOT retried)
    mockFetch.mockClear();
    mockVoiceEngineClient.listVoices.mockClear();

    await expect(service.ensureVoiceRegistered('parse-voice')).rejects.toThrow(
      'Voice registration for "parse-voice" recently failed'
    );
    expect(mockVoiceEngineClient.listVoices).not.toHaveBeenCalled();
  });

  it('should URL-encode the slug in the gateway request', async () => {
    mockVoiceEngineClient.listVoices.mockResolvedValue([]);
    mockVoiceEngineClient.registerVoice.mockResolvedValue(undefined);
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(60)),
      headers: { get: vi.fn().mockReturnValue('audio/wav') },
    });

    await service.ensureVoiceRegistered('voice with spaces');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/voice-references/voice%20with%20spaces',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
});
