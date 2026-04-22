/**
 * Tests for ElevenLabsClient
 *
 * Covers all stateless API functions: TTS, STT, voice cloning,
 * voice listing, voice deletion. All tests mock global fetch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  elevenLabsTTS,
  elevenLabsSTT,
  elevenLabsCloneVoice,
  elevenLabsListVoices,
  elevenLabsListModels,
  elevenLabsDeleteVoice,
  ElevenLabsApiError,
  ElevenLabsTimeoutError,
} from './ElevenLabsClient.js';
import { TimeoutError } from '@tzurot/common-types';

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
  };
});

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('ElevenLabsClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('elevenLabsTTS', () => {
    it('should synthesize text and return MP3 audio', async () => {
      const audioData = new ArrayBuffer(100);
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(audioData),
        headers: { get: vi.fn().mockReturnValue('audio/mpeg') },
      });

      const result = await elevenLabsTTS({
        text: 'Hello world',
        voiceId: 'voice-123',
        apiKey: 'sk_test',
      });

      expect(result.audioBuffer).toBeInstanceOf(Buffer);
      expect(result.audioBuffer.length).toBe(100);
      expect(result.contentType).toBe('audio/mpeg');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/text-to-speech/voice-123',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'xi-api-key': 'sk_test',
            'content-type': 'application/json',
          }),
        })
      );
    });

    it('should URL-encode voiceId for SSRF prevention', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(10)),
        headers: { get: vi.fn().mockReturnValue('audio/mpeg') },
      });

      await elevenLabsTTS({
        text: 'test',
        voiceId: '../admin',
        apiKey: 'sk_test',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/text-to-speech/..%2Fadmin',
        expect.any(Object)
      );
    });

    it('should throw ElevenLabsApiError on 401', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: vi.fn().mockResolvedValue({ detail: 'Invalid API key' }),
      });

      await expect(elevenLabsTTS({ text: 'test', voiceId: 'v1', apiKey: 'bad' })).rejects.toThrow(
        ElevenLabsApiError
      );
    });

    it('should throw ElevenLabsApiError on 429 rate limit', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: vi.fn().mockResolvedValue({ detail: 'Rate limited' }),
      });

      const error = await elevenLabsTTS({
        text: 'test',
        voiceId: 'v1',
        apiKey: 'sk_test',
      }).catch(e => e);

      expect(error).toBeInstanceOf(ElevenLabsApiError);
      expect((error as ElevenLabsApiError).isRateLimited).toBe(true);
    });

    it('should throw ElevenLabsTimeoutError on abort', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValue(abortError);

      await expect(
        elevenLabsTTS({ text: 'test', voiceId: 'v1', apiKey: 'sk_test' })
      ).rejects.toThrow(ElevenLabsTimeoutError);
    });

    it('should throw error that is also instanceof TimeoutError (base class)', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValue(abortError);

      const error = await elevenLabsTTS({
        text: 'test',
        voiceId: 'v1',
        apiKey: 'sk_test',
      }).catch(e => e);

      expect(error).toBeInstanceOf(ElevenLabsTimeoutError);
      expect(error).toBeInstanceOf(TimeoutError);
      expect(error.timeoutMs).toBe(60_000);
      expect(error.operationName).toBe('ElevenLabs /text-to-speech/v1');
    });

    it('should throw ElevenLabsTimeoutError when abort fires during response.arrayBuffer()', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'audio/mpeg' }),
        arrayBuffer: vi.fn().mockRejectedValue(abortError),
      });

      await expect(
        elevenLabsTTS({ text: 'test', voiceId: 'v1', apiKey: 'sk_test' })
      ).rejects.toThrow(ElevenLabsTimeoutError);
    });
  });

  describe('elevenLabsSTT', () => {
    it('should transcribe audio and return text', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ text: 'Hello world' }),
      });

      const result = await elevenLabsSTT({
        audioBuffer: Buffer.from('audio-data'),
        filename: 'test.wav',
        contentType: 'audio/wav',
        apiKey: 'sk_test',
      });

      expect(result.text).toBe('Hello world');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/speech-to-text',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should return empty string when text is missing', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({}),
      });

      const result = await elevenLabsSTT({
        audioBuffer: Buffer.from('audio'),
        filename: 'test.wav',
        contentType: 'audio/wav',
        apiKey: 'sk_test',
      });

      expect(result.text).toBe('');
    });

    it('should throw ElevenLabsTimeoutError when abort fires during response.json()', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockRejectedValue(abortError),
      });

      await expect(
        elevenLabsSTT({
          audioBuffer: Buffer.from('audio'),
          filename: 'test.wav',
          contentType: 'audio/wav',
          apiKey: 'sk_test',
        })
      ).rejects.toThrow(ElevenLabsTimeoutError);
    });
  });

  describe('elevenLabsCloneVoice', () => {
    it('should clone a voice and return the voice ID', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ voice_id: 'cloned-voice-123' }),
      });

      const result = await elevenLabsCloneVoice({
        name: 'tzurot-testbot',
        audioBuffer: Buffer.from('reference-audio'),
        contentType: 'audio/wav',
        apiKey: 'sk_test',
      });

      expect(result.voiceId).toBe('cloned-voice-123');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/voices/add',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should throw when response is missing voice_id', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({}),
      });

      await expect(
        elevenLabsCloneVoice({
          name: 'test',
          audioBuffer: Buffer.from('audio'),
          contentType: 'audio/wav',
          apiKey: 'sk_test',
        })
      ).rejects.toThrow('missing voice_id');
    });

    it('should throw ElevenLabsApiError on failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: vi.fn().mockResolvedValue({ detail: 'Audio too short' }),
      });

      await expect(
        elevenLabsCloneVoice({
          name: 'test',
          audioBuffer: Buffer.from('short'),
          contentType: 'audio/wav',
          apiKey: 'sk_test',
        })
      ).rejects.toThrow(ElevenLabsApiError);
    });

    it('should throw ElevenLabsTimeoutError when abort fires during response.json()', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockRejectedValue(abortError),
      });

      await expect(
        elevenLabsCloneVoice({
          name: 'test',
          audioBuffer: Buffer.from('audio'),
          contentType: 'audio/wav',
          apiKey: 'sk_test',
        })
      ).rejects.toThrow(ElevenLabsTimeoutError);
    });
  });

  describe('elevenLabsListVoices', () => {
    it('should return list of voices', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          voices: [
            { voice_id: 'v1', name: 'Voice One' },
            { voice_id: 'v2', name: 'tzurot-testbot' },
          ],
        }),
      });

      const voices = await elevenLabsListVoices('sk_test');

      expect(voices).toEqual([
        { voiceId: 'v1', name: 'Voice One' },
        { voiceId: 'v2', name: 'tzurot-testbot' },
      ]);
    });

    it('should return empty array when no voices', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({}),
      });

      const voices = await elevenLabsListVoices('sk_test');
      expect(voices).toEqual([]);
    });

    it('should send xi-api-key header', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ voices: [] }),
      });

      await elevenLabsListVoices('sk_my_key');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/voices',
        expect.objectContaining({
          headers: expect.objectContaining({ 'xi-api-key': 'sk_my_key' }),
        })
      );
    });

    it('should throw ElevenLabsTimeoutError when abort fires during response.json()', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockRejectedValue(abortError),
      });

      await expect(elevenLabsListVoices('sk_test')).rejects.toThrow(ElevenLabsTimeoutError);
    });
  });

  describe('elevenLabsDeleteVoice', () => {
    it('should delete a voice by ID', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      await elevenLabsDeleteVoice('voice-to-delete', 'sk_test');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/voices/voice-to-delete',
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('should URL-encode voiceId for SSRF prevention', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      await elevenLabsDeleteVoice('../admin', 'sk_test');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/voices/..%2Fadmin',
        expect.any(Object)
      );
    });

    it('should throw on failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: vi.fn().mockResolvedValue({ detail: 'Voice not found' }),
      });

      await expect(elevenLabsDeleteVoice('bad-id', 'sk_test')).rejects.toThrow(ElevenLabsApiError);
    });
  });

  describe('elevenLabsListModels', () => {
    it('should return TTS-capable models', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue([
          {
            model_id: 'eleven_multilingual_v2',
            name: 'Multilingual v2',
            can_do_text_to_speech: true,
          },
          { model_id: 'eleven_turbo_v2_5', name: 'Turbo v2.5', can_do_text_to_speech: true },
          { model_id: 'scribe_v1', name: 'Scribe v1', can_do_text_to_speech: false },
        ]),
      });

      const models = await elevenLabsListModels('sk_test');

      expect(models).toEqual([
        { modelId: 'eleven_multilingual_v2', name: 'Multilingual v2' },
        { modelId: 'eleven_turbo_v2_5', name: 'Turbo v2.5' },
      ]);
    });

    it('should return empty array when no TTS models', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi
          .fn()
          .mockResolvedValue([
            { model_id: 'scribe_v1', name: 'Scribe v1', can_do_text_to_speech: false },
          ]),
      });

      const models = await elevenLabsListModels('sk_test');
      expect(models).toEqual([]);
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: vi.fn().mockResolvedValue({ detail: 'Invalid key' }),
      });

      await expect(elevenLabsListModels('bad_key')).rejects.toThrow(ElevenLabsApiError);
    });

    it('should throw ElevenLabsTimeoutError when abort fires during response.json()', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockRejectedValue(abortError),
      });

      await expect(elevenLabsListModels('sk_test')).rejects.toThrow(ElevenLabsTimeoutError);
    });
  });

  describe('ElevenLabsApiError', () => {
    it('should have correct isAuthError for 401', () => {
      const error = new ElevenLabsApiError(401, 'Unauthorized');
      expect(error.isAuthError).toBe(true);
      expect(error.isRateLimited).toBe(false);
    });

    it('should have correct isRateLimited for 429', () => {
      const error = new ElevenLabsApiError(429, 'Too Many Requests');
      expect(error.isRateLimited).toBe(true);
      expect(error.isAuthError).toBe(false);
    });

    it('should have correct properties for generic error', () => {
      const error = new ElevenLabsApiError(500, 'Server Error');
      expect(error.status).toBe(500);
      expect(error.detail).toBe('Server Error');
      expect(error.name).toBe('ElevenLabsApiError');
      expect(error.isAuthError).toBe(false);
      expect(error.isRateLimited).toBe(false);
    });

    describe('isTransient', () => {
      it('returns true for 429 rate limit', () => {
        expect(new ElevenLabsApiError(429, 'Rate limited').isTransient).toBe(true);
      });

      it('returns true for 500 internal server error', () => {
        expect(new ElevenLabsApiError(500, 'Internal Server Error').isTransient).toBe(true);
      });

      it('returns true for 502 bad gateway', () => {
        expect(new ElevenLabsApiError(502, 'Bad Gateway').isTransient).toBe(true);
      });

      it('returns true for 503 service unavailable', () => {
        expect(new ElevenLabsApiError(503, 'Service Unavailable').isTransient).toBe(true);
      });

      it('returns false for 401 unauthorized', () => {
        expect(new ElevenLabsApiError(401, 'Unauthorized').isTransient).toBe(false);
      });

      it('returns false for 400 bad request', () => {
        expect(new ElevenLabsApiError(400, 'Bad Request').isTransient).toBe(false);
      });

      it('returns false for 404 not found', () => {
        expect(new ElevenLabsApiError(404, 'Not Found').isTransient).toBe(false);
      });
    });

    describe('isVoiceLimitError', () => {
      it('returns true for 400 with "maximum number of voices" message', () => {
        expect(
          new ElevenLabsApiError(400, 'You have reached the maximum number of voices')
            .isVoiceLimitError
        ).toBe(true);
      });

      it('returns true for 422 with "voice limit" message', () => {
        expect(
          new ElevenLabsApiError(422, 'voice limit reached for your plan').isVoiceLimitError
        ).toBe(true);
      });

      it('returns true for 400 with "too many voices" message', () => {
        expect(
          new ElevenLabsApiError(400, 'too many voices in your account').isVoiceLimitError
        ).toBe(true);
      });

      it('returns true for 422 with "too many voices" message', () => {
        expect(
          new ElevenLabsApiError(422, 'too many voices in your account').isVoiceLimitError
        ).toBe(true);
      });

      it('returns false for 400 with unrelated message', () => {
        expect(new ElevenLabsApiError(400, 'Audio too short').isVoiceLimitError).toBe(false);
      });

      it('returns false for 500 even with matching message', () => {
        expect(new ElevenLabsApiError(500, 'maximum number of voices').isVoiceLimitError).toBe(
          false
        );
      });

      it('returns false for 401 auth error', () => {
        expect(new ElevenLabsApiError(401, 'Unauthorized').isVoiceLimitError).toBe(false);
      });
    });
  });
});
