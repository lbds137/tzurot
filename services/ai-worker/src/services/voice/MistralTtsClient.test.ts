import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildVoxtralSpeechBody,
  buildVoxtralVoiceCreateBody,
  mistralTTS,
  mistralCloneVoice,
  mistralListVoices,
  mistralDeleteVoice,
  MistralApiError,
  MistralReferenceAudioTooLongError,
  MistralResponseShapeError,
  MistralTimeoutError,
  MISTRAL_MAX_REFERENCE_AUDIO_SEC,
} from './MistralTtsClient.js';

// We mock global fetch directly — MistralTtsClient uses it without an HTTP
// client wrapper, so this is the simplest seam.
const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): globalThis.Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
    headers: new Headers(),
  } as unknown as globalThis.Response;
}

// ===== Body builders ========================================================

describe('buildVoxtralSpeechBody', () => {
  it('produces the documented JSON shape with default model + format', () => {
    const body = buildVoxtralSpeechBody({
      text: 'Hello world',
      voiceId: 'voice-uuid-abc',
      apiKey: 'sk-test',
    });
    expect(body).toEqual({
      input: 'Hello world',
      voice_id: 'voice-uuid-abc',
      model: 'voxtral-mini-tts-latest',
      response_format: 'wav',
    });
  });

  it('honors explicit modelId and responseFormat overrides', () => {
    const body = buildVoxtralSpeechBody({
      text: 'x',
      voiceId: 'v',
      apiKey: 'k',
      modelId: 'voxtral-mini-tts-2603',
      responseFormat: 'mp3',
    });
    expect(body.model).toBe('voxtral-mini-tts-2603');
    expect(body.response_format).toBe('mp3');
  });
});

describe('buildVoxtralVoiceCreateBody', () => {
  it('base64-encodes the audio buffer and only sends name + sample_audio + sample_filename', () => {
    const buffer = Buffer.from([0x52, 0x49, 0x46, 0x46]); // "RIFF"
    const body = buildVoxtralVoiceCreateBody({
      name: 'tzurot-emily',
      audioBuffer: buffer,
      contentType: 'audio/wav',
      apiKey: 'sk-test',
    });
    expect(body.name).toBe('tzurot-emily');
    expect(body.sample_audio).toBe(buffer.toString('base64'));
    expect(body.sample_filename).toBe('reference.wav');
    // Mistral silently drops these — confirm we don't send them
    expect(body).not.toHaveProperty('languages');
    expect(body).not.toHaveProperty('gender');
    expect(body).not.toHaveProperty('age');
    expect(body).not.toHaveProperty('tags');
    expect(body).not.toHaveProperty('slug');
  });

  it('maps content types to representative filenames', () => {
    const buf = Buffer.from([0]);
    const cases: [string, string][] = [
      ['audio/mpeg', 'reference.mp3'],
      ['audio/ogg', 'reference.ogg'],
      ['audio/flac', 'reference.flac'],
      ['audio/mp4', 'reference.m4a'],
      ['audio/x-m4a', 'reference.m4a'],
      ['audio/wav', 'reference.wav'],
      // Raw PCM gets its own extension so we don't silently corrupt format
      // detection by labeling unstructured PCM data as WAV.
      ['audio/pcm', 'reference.pcm'],
      ['unknown/type', 'reference.wav'],
    ];
    for (const [contentType, expectedFilename] of cases) {
      const body = buildVoxtralVoiceCreateBody({
        name: 'n',
        audioBuffer: buf,
        contentType,
        apiKey: 'k',
      });
      expect(body.sample_filename).toBe(expectedFilename);
    }
  });
});

// ===== mistralTTS ===========================================================

describe('mistralTTS', () => {
  it('decodes JSON-wrapped base64 audio_data → Buffer', async () => {
    const audioBytes = Buffer.from('the synthesized audio bytes');
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, { audio_data: audioBytes.toString('base64') })
    );

    const result = await mistralTTS({
      text: 'hi',
      voiceId: 'v-1',
      apiKey: 'sk',
    });

    expect(result.audioBuffer).toBeInstanceOf(Buffer);
    expect(result.audioBuffer.toString('utf8')).toBe('the synthesized audio bytes');
    expect(result.contentType).toBe('audio/wav');
  });

  it('maps response_format to the correct content-type', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, { audio_data: Buffer.from([0]).toString('base64') })
    );
    const result = await mistralTTS({
      text: 'hi',
      voiceId: 'v',
      apiKey: 'k',
      responseFormat: 'mp3',
    });
    expect(result.contentType).toBe('audio/mpeg');
  });

  it('sends Authorization header and JSON body', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, { audio_data: Buffer.from([0]).toString('base64') })
    );

    await mistralTTS({ text: 'x', voiceId: 'v', apiKey: 'sk-secret' });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('/v1/audio/speech');
    expect((init as RequestInit).method).toBe('POST');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-secret');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('throws MistralApiError on non-200', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(429, { error: 'rate limit' }));
    await expect(mistralTTS({ text: 'x', voiceId: 'v', apiKey: 'k' })).rejects.toBeInstanceOf(
      MistralApiError
    );
  });

  it('throws MistralResponseShapeError when audio_data is missing (NOT MistralApiError(200))', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, {}));
    const promise = mistralTTS({ text: 'x', voiceId: 'v', apiKey: 'k' });
    await expect(promise).rejects.toBeInstanceOf(MistralResponseShapeError);
    await expect(promise).rejects.toThrow(/missing audio_data/);
  });

  it('throws MistralTimeoutError when fetch aborts', async () => {
    mockFetch.mockImplementationOnce(() => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    });
    await expect(mistralTTS({ text: 'x', voiceId: 'v', apiKey: 'k' })).rejects.toBeInstanceOf(
      MistralTimeoutError
    );
  });
});

// ===== mistralCloneVoice ====================================================

describe('mistralCloneVoice', () => {
  it('returns the assigned id, surviving name, and user_id from the response', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        id: 'voice-uuid-xyz',
        name: 'tzurot-emily',
        user_id: 'user-uuid-abc',
      })
    );

    const result = await mistralCloneVoice({
      name: 'tzurot-emily',
      audioBuffer: Buffer.from([0]),
      contentType: 'audio/wav',
      apiKey: 'k',
    });

    expect(result).toEqual({
      id: 'voice-uuid-xyz',
      name: 'tzurot-emily',
      userId: 'user-uuid-abc',
    });
  });

  it('falls back to caller-provided name if response omits it (defensive)', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { id: 'v', user_id: null }));

    const result = await mistralCloneVoice({
      name: 'fallback-name',
      audioBuffer: Buffer.from([0]),
      contentType: 'audio/wav',
      apiKey: 'k',
    });

    expect(result.name).toBe('fallback-name');
    expect(result.userId).toBeNull();
  });

  it('throws MistralResponseShapeError when response missing id', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { name: 'x' }));
    const promise = mistralCloneVoice({
      name: 'x',
      audioBuffer: Buffer.from([0]),
      contentType: 'audio/wav',
      apiKey: 'k',
    });
    await expect(promise).rejects.toBeInstanceOf(MistralResponseShapeError);
    await expect(promise).rejects.toThrow(/missing id/);
  });

  it('throws MistralApiError on non-200', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(401, { error: 'auth' }));
    await expect(
      mistralCloneVoice({
        name: 'x',
        audioBuffer: Buffer.from([0]),
        contentType: 'audio/wav',
        apiKey: 'k',
      })
    ).rejects.toBeInstanceOf(MistralApiError);
  });
});

// ===== mistralListVoices ====================================================

/** Build a full window (50 items) of unique voices with the given id prefix. */
function fullVoicesPage(idPrefix: string): { id: string; name: string; user_id: null }[] {
  return Array.from({ length: 50 }, (_, i) => ({
    id: `${idPrefix}-${i}`,
    name: `voice-${idPrefix}-${i}`,
    user_id: null,
  }));
}

describe('mistralListVoices', () => {
  it('returns the items array mapped to MistralVoiceInfo shape', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        items: [
          { id: 'v1', name: 'preset', user_id: null },
          { id: 'v2', name: 'tzurot-emily', user_id: 'user-1' },
        ],
        total: 2,
        total_pages: 1,
        page: 1,
        page_size: 50,
      })
    );

    const result = await mistralListVoices('k');

    expect(result.voices).toEqual([
      { id: 'v1', name: 'preset', userId: null },
      { id: 'v2', name: 'tzurot-emily', userId: 'user-1' },
    ]);
    expect(result.truncated).toBe(false);
  });

  it('uses limit=50 and offset=0 in the query string', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { items: [] }));
    await mistralListVoices('k');
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('limit=50');
    expect(url).toContain('offset=0');
  });

  it('throws MistralResponseShapeError when items is missing', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { total: 0 }));
    const promise = mistralListVoices('k');
    await expect(promise).rejects.toBeInstanceOf(MistralResponseShapeError);
    await expect(promise).rejects.toThrow(/missing items/);
  });

  it('walks pagination via offset and aggregates results', async () => {
    // Full first window (50) then a short second window (2) = 52 total
    mockFetch
      .mockResolvedValueOnce(jsonResponse(200, { items: fullVoicesPage('p1') }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          items: [
            { id: 'p2-v1', name: 'c', user_id: null },
            { id: 'p2-v2', name: 'd', user_id: null },
          ],
        })
      );

    const result = await mistralListVoices('k');

    expect(result.voices).toHaveLength(52);
    expect(result.voices.at(-1)?.id).toBe('p2-v2');
    expect(result.truncated).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toContain('limit=50&offset=0');
    expect(mockFetch.mock.calls[1][0]).toContain('limit=50&offset=50');
  });

  it('stops fetching after a single short window', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        items: [{ id: 'v1', name: 'only', user_id: null }],
      })
    );

    await mistralListVoices('k');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('dedupes and treats a repeated full window as exhaustive (truncated: false)', async () => {
    // Provider ignores offset and returns the identical window on every
    // request. The walker must dedupe by id, stop after the first
    // no-new-ids window, and NOT set `truncated` — marking it truncated
    // would make find-by-name refuse to clone permanently.
    mockFetch.mockResolvedValue(jsonResponse(200, { items: fullVoicesPage('rep') }));

    const result = await mistralListVoices('k');

    expect(result.voices).toHaveLength(50);
    expect(new Set(result.voices.map(v => v.id)).size).toBe(50);
    expect(result.truncated).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('returns truncated: true when pagination cap (VOICE_LIST_MAX_PAGES = 20) is reached', async () => {
    // Each of 20 windows returns 50 NEW items, so the walker keeps making
    // progress until it runs out the cap. The provider's find-by-name path
    // uses `truncated: true` to refuse cloning when no match is found in
    // the prefix — this test pins the producer side of that contract.
    for (let i = 0; i < 20; i++) {
      mockFetch.mockResolvedValueOnce(jsonResponse(200, { items: fullVoicesPage(`w${i}`) }));
    }

    const result = await mistralListVoices('k');

    expect(result.voices).toHaveLength(1000);
    expect(result.truncated).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(20);
  });
});

// ===== mistralDeleteVoice ==================================================

describe('mistralDeleteVoice', () => {
  it('issues DELETE with the voice id in the path', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { id: 'v', name: 'x' }));
    await mistralDeleteVoice('voice-uuid-abc', 'k');
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('/v1/audio/voices/voice-uuid-abc');
    expect((init as RequestInit).method).toBe('DELETE');
  });

  it('throws MistralApiError on non-200', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(404, { error: 'not found' }));
    await expect(mistralDeleteVoice('v', 'k')).rejects.toBeInstanceOf(MistralApiError);
  });

  it('encodes the voice id (defense against malformed inputs)', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, {}));
    await mistralDeleteVoice('weird/id with space', 'k');
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('weird%2Fid%20with%20space');
  });
});

// ===== MistralApiError ======================================================

describe('MistralApiError', () => {
  it('flags 401/403 as auth error', () => {
    expect(new MistralApiError(401, '').isAuthError).toBe(true);
    expect(new MistralApiError(403, '').isAuthError).toBe(true);
    expect(new MistralApiError(429, '').isAuthError).toBe(false);
  });

  it('flags 429 as rate limited and transient', () => {
    const err = new MistralApiError(429, '');
    expect(err.isRateLimited).toBe(true);
    expect(err.isTransient).toBe(true);
  });

  it('flags 5xx as transient', () => {
    expect(new MistralApiError(500, '').isTransient).toBe(true);
    expect(new MistralApiError(502, '').isTransient).toBe(true);
    expect(new MistralApiError(503, '').isTransient).toBe(true);
  });

  it('flags 4xx (non-429) as non-transient', () => {
    expect(new MistralApiError(400, '').isTransient).toBe(false);
    expect(new MistralApiError(404, '').isTransient).toBe(false);
  });
});

// ===== MistralResponseShapeError ============================================

describe('MistralResponseShapeError', () => {
  it('carries endpoint and missingField on the error instance', () => {
    const err = new MistralResponseShapeError('/v1/audio/speech', 'audio_data');
    expect(err.endpoint).toBe('/v1/audio/speech');
    expect(err.missingField).toBe('audio_data');
    expect(err.message).toMatch(/\/v1\/audio\/speech/);
    expect(err.message).toMatch(/missing audio_data/);
  });

  it('flags as transient (response shape may stabilize on retry)', () => {
    expect(new MistralResponseShapeError('/v1/audio/voices', 'items').isTransient).toBe(true);
  });

  it('is a separate class from MistralApiError (instanceof discrimination)', () => {
    const shape = new MistralResponseShapeError('/v1/audio/speech', 'audio_data');
    expect(shape).toBeInstanceOf(MistralResponseShapeError);
    expect(shape).not.toBeInstanceOf(MistralApiError);
  });
});

// ===== MistralReferenceAudioTooLongError ====================================

describe('MistralReferenceAudioTooLongError', () => {
  it('carries durationSec and limitSec on the error instance', () => {
    const err = new MistralReferenceAudioTooLongError(31.78);
    expect(err.durationSec).toBeCloseTo(31.78, 5);
    expect(err.limitSec).toBe(MISTRAL_MAX_REFERENCE_AUDIO_SEC);
    expect(err.message).toMatch(/31\.8s/);
    expect(err.message).toMatch(/30\.0s/);
  });

  it('flags as non-transient (deterministic from input — retry would fail again)', () => {
    expect(new MistralReferenceAudioTooLongError(35).isTransient).toBe(false);
  });

  it('is a separate class from MistralApiError (instanceof discrimination)', () => {
    const tooLong = new MistralReferenceAudioTooLongError(40);
    expect(tooLong).toBeInstanceOf(MistralReferenceAudioTooLongError);
    expect(tooLong).not.toBeInstanceOf(MistralApiError);
    expect(tooLong).not.toBeInstanceOf(MistralResponseShapeError);
  });
});
