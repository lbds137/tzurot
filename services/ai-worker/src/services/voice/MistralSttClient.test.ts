import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mistralTranscribeAudio, MistralSttApiError } from './MistralSttClient.js';

// Same mocking pattern as MistralTtsClient.test.ts — stub global fetch.
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

function textResponse(status: number, body: string): globalThis.Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => {
      throw new Error('not json');
    },
    headers: new Headers(),
  } as unknown as globalThis.Response;
}

const baseOpts = {
  audioBuffer: Buffer.from('fake-audio'),
  filename: 'voice-message.ogg',
  contentType: 'audio/ogg',
  apiKey: 'sk-test',
};

describe('mistralTranscribeAudio', () => {
  it('returns the text on a 200 with valid shape', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { text: 'Hello, this is a test.' }));

    const result = await mistralTranscribeAudio(baseOpts);

    expect(result.text).toBe('Hello, this is a test.');
  });

  it('POSTs to /v1/audio/transcriptions with Bearer auth and multipart body', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { text: 'ok' }));

    await mistralTranscribeAudio(baseOpts);

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('/audio/transcriptions');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    // Critical: do NOT set Content-Type explicitly — fetch derives the
    // multipart boundary from FormData. Setting it manually breaks the upload.
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('uses the default model when modelId omitted', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { text: 'ok' }));

    await mistralTranscribeAudio(baseOpts);

    const init = mockFetch.mock.calls[0][1];
    const body = init.body as FormData;
    expect(body.get('model')).toBe('voxtral-mini-transcribe-latest');
  });

  it('respects an explicit modelId override', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { text: 'ok' }));

    await mistralTranscribeAudio({ ...baseOpts, modelId: 'voxtral-mini-transcribe-2507' });

    const init = mockFetch.mock.calls[0][1];
    const body = init.body as FormData;
    expect(body.get('model')).toBe('voxtral-mini-transcribe-2507');
  });

  it('throws MistralSttApiError on a 401 with body forwarded', async () => {
    mockFetch.mockResolvedValue(textResponse(401, 'invalid api key'));

    await expect(mistralTranscribeAudio(baseOpts)).rejects.toMatchObject({
      name: 'MistralSttApiError',
      status: 401,
    });
  });

  it('isAuthError true for 401 and 403, false for others', async () => {
    mockFetch.mockResolvedValue(textResponse(401, 'auth'));
    try {
      await mistralTranscribeAudio(baseOpts);
    } catch (err) {
      expect((err as MistralSttApiError).isAuthError).toBe(true);
    }

    mockFetch.mockResolvedValue(textResponse(500, 'server'));
    try {
      await mistralTranscribeAudio(baseOpts);
    } catch (err) {
      expect((err as MistralSttApiError).isAuthError).toBe(false);
    }
  });

  it('isTransient true for 429 and 5xx, false for 4xx other than 429', async () => {
    mockFetch.mockResolvedValue(textResponse(429, 'rate limited'));
    try {
      await mistralTranscribeAudio(baseOpts);
    } catch (err) {
      expect((err as MistralSttApiError).isTransient).toBe(true);
    }

    mockFetch.mockResolvedValue(textResponse(503, 'service unavailable'));
    try {
      await mistralTranscribeAudio(baseOpts);
    } catch (err) {
      expect((err as MistralSttApiError).isTransient).toBe(true);
    }

    mockFetch.mockResolvedValue(textResponse(400, 'bad request'));
    try {
      await mistralTranscribeAudio(baseOpts);
    } catch (err) {
      expect((err as MistralSttApiError).isTransient).toBe(false);
    }
  });

  it('throws MistralSttResponseShapeError on a 200 missing the text field', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { unexpected: 'body' }));

    await expect(mistralTranscribeAudio(baseOpts)).rejects.toMatchObject({
      name: 'MistralSttResponseShapeError',
    });
  });

  it('throws MistralSttResponseShapeError when text is not a string', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { text: 42 }));

    await expect(mistralTranscribeAudio(baseOpts)).rejects.toMatchObject({
      name: 'MistralSttResponseShapeError',
    });
  });

  it('wraps AbortError into MistralSttTimeoutError', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    mockFetch.mockRejectedValue(abortError);

    await expect(mistralTranscribeAudio(baseOpts)).rejects.toMatchObject({
      name: 'MistralSttTimeoutError',
    });
  });

  it('rethrows non-abort fetch errors unwrapped', async () => {
    const networkError = new Error('socket reset');
    mockFetch.mockRejectedValue(networkError);

    await expect(mistralTranscribeAudio(baseOpts)).rejects.toThrow('socket reset');
  });
});
