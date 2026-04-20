/**
 * Tests for VoiceEngineClient
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  VoiceEngineClient,
  VoiceEngineError,
  getVoiceEngineClient,
  resetVoiceEngineClient,
  isTransientVoiceEngineError,
} from './VoiceEngineClient.js';
import * as commonTypes from '@tzurot/common-types';
import type { EnvConfig } from '@tzurot/common-types';
import { TimeoutError } from '../../utils/retry.js';

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

    it('should throw VoiceEngineError with isAuthError on 401', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: vi.fn().mockResolvedValue({ detail: 'Invalid or missing API key' }),
      });

      await expect(
        client.transcribe(Buffer.from('fake-audio'), 'test.wav', 'audio/wav')
      ).rejects.toMatchObject({
        name: 'VoiceEngineError',
        status: 401,
        isAuthError: true,
        message: expect.stringContaining('(401)'),
      });
    });

    it('should throw VoiceEngineError without isAuthError on 503', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: vi.fn().mockResolvedValue({ detail: 'STT model not loaded' }),
      });

      await expect(
        client.transcribe(Buffer.from('fake-audio'), 'test.wav', 'audio/wav')
      ).rejects.toMatchObject({
        name: 'VoiceEngineError',
        status: 503,
        isAuthError: false,
      });
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
      ).rejects.toThrow('Voice engine request failed (502): Bad Gateway');
    });
  });

  describe('getHealth', () => {
    it('should return both true when both models are loaded', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          status: 'ok',
          asr_loaded: true,
          tts_loaded: true,
        }),
      });

      const result = await client.getHealth();
      expect(result).toEqual({ asr: true, tts: true });
    });

    it('should return asr false when asr_loaded is false', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          status: 'ok',
          asr_loaded: false,
          tts_loaded: true,
        }),
      });

      const result = await client.getHealth();
      expect(result).toEqual({ asr: false, tts: true });
    });

    it('should return tts false when tts_loaded is false', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          status: 'ok',
          asr_loaded: true,
          tts_loaded: false,
        }),
      });

      const result = await client.getHealth();
      expect(result).toEqual({ asr: true, tts: false });
    });

    it('should return both false on network error', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await client.getHealth();
      expect(result).toEqual({ asr: false, tts: false });
    });

    it('should return both false on non-200 response', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      const result = await client.getHealth();
      expect(result).toEqual({ asr: false, tts: false });
    });
  });

  describe('isHealthy', () => {
    it('should return true when both models are loaded', async () => {
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

    it('should return false when either model is not loaded', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          status: 'ok',
          asr_loaded: true,
          tts_loaded: false,
        }),
      });

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

    it('should throw TimeoutError on abort', async () => {
      const shortTimeoutClient = new VoiceEngineClient('http://voice-engine:8000', 'test-key', 100);

      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValue(abortError);

      const error = await shortTimeoutClient
        .transcribe(Buffer.from('fake-audio'), 'test.wav', 'audio/wav')
        .catch(e => e);
      expect(error).toBeInstanceOf(TimeoutError);
      expect(error.timeoutMs).toBe(100);
      expect(error.operationName).toBe('voice engine request');
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
      const assertion = expect(promise).rejects.toThrow(TimeoutError);
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

  describe('synthesize', () => {
    it('should return audioBuffer and contentType on success', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(100)),
        headers: { get: vi.fn().mockReturnValue('audio/wav') },
      });

      const result = await client.synthesize('Hello world', 'voice-1');

      expect(result.audioBuffer).toBeInstanceOf(Buffer);
      expect(result.audioBuffer.byteLength).toBe(100);
      expect(result.contentType).toBe('audio/wav');
    });

    it('should throw VoiceEngineError on non-OK response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: vi.fn().mockResolvedValue({ detail: 'Invalid or missing API key' }),
      });

      await expect(client.synthesize('Hello', 'voice-1')).rejects.toMatchObject({
        name: 'VoiceEngineError',
        status: 401,
        isAuthError: true,
        message: expect.stringContaining('(401)'),
      });
    });

    it('should send correct FormData fields to /v1/tts', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(10)),
        headers: { get: vi.fn().mockReturnValue('audio/wav') },
      });

      await client.synthesize('Test text', 'my-voice');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://voice-engine:8000/v1/tts',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should fall back to audio/wav when content-type header is missing', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(50)),
        headers: { get: vi.fn().mockReturnValue(null) },
      });

      const result = await client.synthesize('Hello', 'voice-1');

      expect(result.contentType).toBe('audio/wav');
    });

    it('should default format to opus in FormData when caller omits it', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(10)),
        headers: { get: vi.fn().mockReturnValue('audio/ogg') },
      });

      await client.synthesize('Hello', 'voice-1');

      const [, init] = mockFetch.mock.calls[0];
      const body = init.body as FormData;
      expect(body.get('format')).toBe('opus');
    });

    it('should pass format=wav in FormData when requested by caller (multi-chunk path)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(10)),
        headers: { get: vi.fn().mockReturnValue('audio/wav') },
      });

      await client.synthesize('Hello', 'voice-1', { format: 'wav' });

      const [, init] = mockFetch.mock.calls[0];
      const body = init.body as FormData;
      expect(body.get('format')).toBe('wav');
    });
  });

  describe('registerVoice', () => {
    it('should succeed without throwing on 200', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      await expect(
        client.registerVoice('voice-1', Buffer.from('audio-data'), 'audio/wav')
      ).resolves.toBeUndefined();
    });

    it('should throw VoiceEngineError on failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        json: vi.fn().mockResolvedValue({ detail: 'Failed' }),
      });

      await expect(
        client.registerVoice('voice-1', Buffer.from('audio-data'), 'audio/wav')
      ).rejects.toMatchObject({
        name: 'VoiceEngineError',
        status: 500,
      });
    });

    it('should send request to /v1/voices/register', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      await client.registerVoice('voice-1', Buffer.from('audio-data'), 'audio/wav');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://voice-engine:8000/v1/voices/register',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('listVoices', () => {
    it('should return array of voice IDs', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ voices: [{ id: 'voice-1' }, { id: 'voice-2' }] }),
      });

      const result = await client.listVoices();

      expect(result).toEqual(['voice-1', 'voice-2']);
    });

    it('should throw VoiceEngineError on failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: vi.fn().mockResolvedValue({ detail: 'TTS not loaded' }),
      });

      await expect(client.listVoices()).rejects.toMatchObject({
        name: 'VoiceEngineError',
        status: 503,
      });
    });

    it('should send request to /v1/voices', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ voices: [] }),
      });

      await client.listVoices();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://voice-engine:8000/v1/voices',
        expect.objectContaining({ method: 'GET' })
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

describe('isTransientVoiceEngineError', () => {
  it('should return true for TimeoutError', () => {
    expect(isTransientVoiceEngineError(new TimeoutError(5000, 'test'))).toBe(true);
  });

  it('should return true for VoiceEngineError 502', () => {
    expect(isTransientVoiceEngineError(new VoiceEngineError(502, 'Bad Gateway'))).toBe(true);
  });

  it('should return true for VoiceEngineError 503', () => {
    expect(isTransientVoiceEngineError(new VoiceEngineError(503, 'Service Unavailable'))).toBe(
      true
    );
  });

  it('should return true for VoiceEngineError 504', () => {
    expect(isTransientVoiceEngineError(new VoiceEngineError(504, 'Gateway Timeout'))).toBe(true);
  });

  it('should return false for VoiceEngineError 400', () => {
    expect(isTransientVoiceEngineError(new VoiceEngineError(400, 'Bad Request'))).toBe(false);
  });

  it('should return false for VoiceEngineError 401', () => {
    expect(isTransientVoiceEngineError(new VoiceEngineError(401, 'Unauthorized'))).toBe(false);
  });

  it('should return false for VoiceEngineError 404', () => {
    expect(isTransientVoiceEngineError(new VoiceEngineError(404, 'Not Found'))).toBe(false);
  });

  it('should return true for TypeError("fetch failed")', () => {
    expect(isTransientVoiceEngineError(new TypeError('fetch failed'))).toBe(true);
  });

  it('should return true for TypeError with ECONNREFUSED cause', () => {
    const cause = new Error('connect ECONNREFUSED') as NodeJS.ErrnoException;
    cause.code = 'ECONNREFUSED';
    const error = new TypeError('other message', { cause });
    expect(isTransientVoiceEngineError(error)).toBe(true);
  });

  it('should return true for TypeError with ECONNRESET cause', () => {
    const cause = new Error('connection reset') as NodeJS.ErrnoException;
    cause.code = 'ECONNRESET';
    const error = new TypeError('other message', { cause });
    expect(isTransientVoiceEngineError(error)).toBe(true);
  });

  it('should return true for TypeError with ETIMEDOUT cause', () => {
    const cause = new Error('connection timed out') as NodeJS.ErrnoException;
    cause.code = 'ETIMEDOUT';
    const error = new TypeError('other message', { cause });
    expect(isTransientVoiceEngineError(error)).toBe(true);
  });

  it('should return false for generic Error', () => {
    expect(isTransientVoiceEngineError(new Error('something went wrong'))).toBe(false);
  });

  it('should return false for non-error values', () => {
    expect(isTransientVoiceEngineError(null)).toBe(false);
    expect(isTransientVoiceEngineError(undefined)).toBe(false);
    expect(isTransientVoiceEngineError('string error')).toBe(false);
  });
});
