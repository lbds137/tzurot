/**
 * Tests for VoiceEngineClient
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  VoiceEngineClient,
  VoiceEngineError,
  getVoiceEngineClient,
  resetVoiceEngineClient,
} from './VoiceEngineClient.js';
import * as commonTypes from '@tzurot/common-types';
import type { EnvConfig } from '@tzurot/common-types';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('VoiceEngineClient', () => {
  let client: VoiceEngineClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new VoiceEngineClient('http://voice-engine:8000', 'test-key');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('transcribe', () => {
    it('should return parsed transcription on success', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ text: 'Hello world' }),
      });

      const result = await client.transcribe(Buffer.from('fake-audio'), 'test.wav', 'audio/wav');

      expect(result.text).toBe('Hello world');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://voice-engine:8000/v1/transcribe',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-key',
          }),
        })
      );
    });

    it('should throw VoiceEngineError on 401 unauthorized', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: vi.fn().mockResolvedValue({ detail: 'Invalid or missing API key' }),
      });

      const promise = client.transcribe(Buffer.from('fake-audio'), 'test.wav', 'audio/wav');
      await expect(promise).rejects.toThrow(VoiceEngineError);
      await expect(promise).rejects.toThrow('Voice engine transcription failed (401)');
      try {
        await client.transcribe(Buffer.from('fake-audio'), 'test.wav', 'audio/wav');
      } catch (error) {
        expect(error).toBeInstanceOf(VoiceEngineError);
        expect((error as VoiceEngineError).status).toBe(401);
        expect((error as VoiceEngineError).isAuthError).toBe(true);
      }
    });

    it('should throw VoiceEngineError on 503 (non-auth)', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: vi.fn().mockResolvedValue({ detail: 'STT model not loaded' }),
      });

      try {
        await client.transcribe(Buffer.from('fake-audio'), 'test.wav', 'audio/wav');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(VoiceEngineError);
        expect((error as VoiceEngineError).status).toBe(503);
        expect((error as VoiceEngineError).isAuthError).toBe(false);
      }
    });

    it('should throw on network error', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(
        client.transcribe(Buffer.from('fake-audio'), 'test.wav', 'audio/wav')
      ).rejects.toThrow('ECONNREFUSED');
    });

    it('should not include Authorization header when no API key', async () => {
      const noAuthClient = new VoiceEngineClient('http://voice-engine:8000');
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ text: 'Hello' }),
      });

      await noAuthClient.transcribe(Buffer.from('fake-audio'), 'test.wav', 'audio/wav');

      const fetchCall = mockFetch.mock.calls[0];
      const headers = fetchCall[1].headers;
      expect(headers).not.toHaveProperty('Authorization');
    });

    it('should handle non-JSON error response gracefully', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        json: vi.fn().mockRejectedValue(new Error('Invalid JSON')),
      });

      await expect(
        client.transcribe(Buffer.from('fake-audio'), 'test.wav', 'audio/wav')
      ).rejects.toThrow('Voice engine transcription failed (502): Bad Gateway');
    });
  });

  describe('isHealthy', () => {
    it('should return true when asr_loaded is true', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          status: 'ok',
          asr_loaded: true,
          tts_loaded: true,
        }),
      });

      const result = await client.isHealthy();
      expect(result).toBe(true);
    });

    it('should return false when asr_loaded is false', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          status: 'ok',
          asr_loaded: false,
        }),
      });

      const result = await client.isHealthy();
      expect(result).toBe(false);
    });

    it('should return false on network error', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await client.isHealthy();
      expect(result).toBe(false);
    });

    it('should return false on non-200 response', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      const result = await client.isHealthy();
      expect(result).toBe(false);
    });
  });

  describe('timeout handling', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should throw descriptive error on timeout', async () => {
      const shortTimeoutClient = new VoiceEngineClient('http://voice-engine:8000', 'test-key', 100);

      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValue(abortError);

      await expect(
        shortTimeoutClient.transcribe(Buffer.from('fake-audio'), 'test.wav', 'audio/wav')
      ).rejects.toThrow('Voice engine request timed out');
    });

    it('should abort request after configured timeout delay', async () => {
      const shortTimeoutClient = new VoiceEngineClient(
        'http://voice-engine:8000',
        'test-key',
        1000
      );

      // Simulate a fetch that never resolves (hangs indefinitely)
      mockFetch.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              const abortError = new Error('The operation was aborted');
              abortError.name = 'AbortError';
              reject(abortError);
            });
          })
      );

      const promise = shortTimeoutClient.transcribe(Buffer.from('audio'), 'test.wav', 'audio/wav');
      const assertion = expect(promise).rejects.toThrow('Voice engine request timed out');
      await vi.advanceTimersByTimeAsync(1001);
      await assertion;
    });
  });

  describe('URL construction', () => {
    it('should strip trailing slashes from base URL', async () => {
      const trailingSlashClient = new VoiceEngineClient('http://voice-engine:8000/');
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ text: 'Hello' }),
      });

      await trailingSlashClient.transcribe(Buffer.from('audio'), 'test.wav', 'audio/wav');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://voice-engine:8000/v1/transcribe',
        expect.any(Object)
      );
    });
  });
});

describe('getVoiceEngineClient', () => {
  beforeEach(() => {
    resetVoiceEngineClient();
  });

  afterEach(() => {
    resetVoiceEngineClient();
    vi.restoreAllMocks();
  });

  it('should return null when VOICE_ENGINE_URL is not configured', () => {
    vi.spyOn(commonTypes, 'getConfig').mockReturnValue({
      VOICE_ENGINE_URL: undefined,
    } as unknown as EnvConfig);

    const result = getVoiceEngineClient();
    expect(result).toBeNull();
  });

  it('should return client when VOICE_ENGINE_URL is configured', () => {
    vi.spyOn(commonTypes, 'getConfig').mockReturnValue({
      VOICE_ENGINE_URL: 'http://voice-engine:8000',
      VOICE_ENGINE_API_KEY: 'test-key',
    } as unknown as EnvConfig);

    const result = getVoiceEngineClient();
    expect(result).toBeInstanceOf(VoiceEngineClient);
  });

  it('should return same instance on subsequent calls (singleton)', () => {
    vi.spyOn(commonTypes, 'getConfig').mockReturnValue({
      VOICE_ENGINE_URL: 'http://voice-engine:8000',
    } as unknown as EnvConfig);

    const first = getVoiceEngineClient();
    const second = getVoiceEngineClient();
    expect(first).toBe(second);
  });
});
