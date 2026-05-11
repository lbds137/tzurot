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
    expect(body.get('model')).toBe('voxtral-mini-latest');
  });

  it('respects an explicit modelId override', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { text: 'ok' }));

    // Pinned dated model ID for the dedicated transcription endpoint
    // (*-latest aliases live on the broader voxtral-mini family;
    // voxtral-mini-transcribe-* only ships dated IDs).
    await mistralTranscribeAudio({ ...baseOpts, modelId: 'voxtral-mini-transcribe-26-02' });

    const init = mockFetch.mock.calls[0][1];
    const body = init.body as FormData;
    expect(body.get('model')).toBe('voxtral-mini-transcribe-26-02');
  });

  it('throws MistralSttApiError on a 401 with body forwarded', async () => {
    mockFetch.mockResolvedValue(textResponse(401, 'invalid api key'));

    await expect(mistralTranscribeAudio(baseOpts)).rejects.toMatchObject({
      name: 'MistralSttApiError',
      status: 401,
    });
  });

  it('isAuthError true for 401 and 403, false for others', async () => {
    // Pattern: capture-the-error rather than try/catch with assertions in
    // the catch block. The earlier shape silently passed if the function
    // didn't throw — `expect` ran zero times. `.catch(e => e)` forces the
    // test to surface either the real error or a clearly-typed undefined.
    mockFetch.mockResolvedValueOnce(textResponse(401, 'auth'));
    const err401 = (await mistralTranscribeAudio(baseOpts).catch(e => e)) as MistralSttApiError;
    expect(err401).toBeInstanceOf(MistralSttApiError);
    expect(err401.isAuthError).toBe(true);

    mockFetch.mockResolvedValueOnce(textResponse(403, 'forbidden'));
    const err403 = (await mistralTranscribeAudio(baseOpts).catch(e => e)) as MistralSttApiError;
    expect(err403).toBeInstanceOf(MistralSttApiError);
    expect(err403.isAuthError).toBe(true);

    mockFetch.mockResolvedValueOnce(textResponse(500, 'server'));
    const err500 = (await mistralTranscribeAudio(baseOpts).catch(e => e)) as MistralSttApiError;
    expect(err500).toBeInstanceOf(MistralSttApiError);
    expect(err500.isAuthError).toBe(false);
  });

  it('isTransient true for 429 and 5xx, false for 4xx other than 429', async () => {
    mockFetch.mockResolvedValueOnce(textResponse(429, 'rate limited'));
    const err429 = (await mistralTranscribeAudio(baseOpts).catch(e => e)) as MistralSttApiError;
    expect(err429).toBeInstanceOf(MistralSttApiError);
    expect(err429.isTransient).toBe(true);

    mockFetch.mockResolvedValueOnce(textResponse(503, 'service unavailable'));
    const err503 = (await mistralTranscribeAudio(baseOpts).catch(e => e)) as MistralSttApiError;
    expect(err503).toBeInstanceOf(MistralSttApiError);
    expect(err503.isTransient).toBe(true);

    mockFetch.mockResolvedValueOnce(textResponse(400, 'bad request'));
    const err400 = (await mistralTranscribeAudio(baseOpts).catch(e => e)) as MistralSttApiError;
    expect(err400).toBeInstanceOf(MistralSttApiError);
    expect(err400.isTransient).toBe(false);
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
