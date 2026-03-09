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
  elevenLabsDeleteVoice,
  ElevenLabsApiError,
} from './ElevenLabsClient.js';

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

    it('should throw timeout error on abort', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValue(abortError);

      await expect(
        elevenLabsTTS({ text: 'test', voiceId: 'v1', apiKey: 'sk_test' })
      ).rejects.toThrow('timed out');
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
      expect(error.name).toBe('ElevenLabsApiError');
      expect(error.isAuthError).toBe(false);
      expect(error.isRateLimited).toBe(false);
    });
  });
});
