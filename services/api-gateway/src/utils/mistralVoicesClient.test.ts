import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listMistralTzurotVoices,
  getMistralVoice,
  deleteMistralVoice,
} from './mistralVoicesClient.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
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

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/** Build a full page (50 items) of unique voices with the given id prefix. */
function fullPage(
  idPrefix: string,
  namer: (i: number) => string
): { id: string; name: string; user_id: string }[] {
  return Array.from({ length: 50 }, (_, i) => ({
    id: `${idPrefix}-${i}`,
    name: namer(i),
    user_id: 'u',
  }));
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('listMistralTzurotVoices', () => {
  it('returns only tzurot-prefixed voices, plus the unfiltered total count', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        items: [
          { id: 'v1', name: 'tzurot-alice', user_id: 'u' },
          { id: 'v2', name: 'random-other', user_id: 'u' },
          { id: 'v3', name: 'tzurot-bob', user_id: 'u' },
        ],
      })
    );

    const result = await listMistralTzurotVoices('mi-key', 'tzurot-');

    expect('voices' in result).toBe(true);
    if ('voices' in result) {
      expect(result.voices).toHaveLength(2);
      expect(result.totalVoices).toBe(3); // unfiltered count
      expect(result.voices.map(v => v.name)).toEqual(['tzurot-alice', 'tzurot-bob']);
    }
    // Single short page → no second request
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('walks pagination via limit/offset and aggregates filtered results', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse(200, {
          items: fullPage('p1', i => (i === 0 ? 'tzurot-alice' : `other-${i}`)),
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          items: [{ id: 'p2-0', name: 'tzurot-bob', user_id: 'u' }],
        })
      );

    const result = await listMistralTzurotVoices('mi-key', 'tzurot-');

    expect('voices' in result).toBe(true);
    if ('voices' in result) {
      expect(result.voices.map(v => v.name)).toEqual(['tzurot-alice', 'tzurot-bob']);
      expect(result.totalVoices).toBe(51);
    }
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toContain('limit=50&offset=0');
    expect(mockFetch.mock.calls[1][0]).toContain('limit=50&offset=50');
  });

  it('stops walking and dedupes when the provider repeats a full page', async () => {
    // Provider ignores offset and returns the identical window on every
    // request. The walker must dedupe by id and stop after the first
    // no-new-ids page instead of collecting 20 copies of each voice.
    const repeatedWindow = fullPage('rep', i => `tzurot-voice-${i}`);
    mockFetch.mockResolvedValue(jsonResponse(200, { items: repeatedWindow }));

    const result = await listMistralTzurotVoices('mi-key', 'tzurot-');

    expect('voices' in result).toBe(true);
    if ('voices' in result) {
      expect(result.voices).toHaveLength(50);
      expect(result.totalVoices).toBe(50);
      expect(new Set(result.voices.map(v => v.voiceId)).size).toBe(50);
    }
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('returns after the pagination cap when every window keeps producing new ids', async () => {
    let call = 0;
    mockFetch.mockImplementation(() => {
      const window = call++;
      return Promise.resolve(
        jsonResponse(200, { items: fullPage(`w${window}`, i => `tzurot-w${window}-${i}`) })
      );
    });

    const result = await listMistralTzurotVoices('mi-key', 'tzurot-');

    expect(mockFetch).toHaveBeenCalledTimes(20);
    expect('voices' in result).toBe(true);
    if ('voices' in result) {
      expect(result.voices).toHaveLength(1000);
      expect(result.totalVoices).toBe(1000);
    }
  });

  it('returns errorResponse on 401', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    } as unknown as Response);

    const result = await listMistralTzurotVoices('bad-key', 'tzurot-');

    expect('errorResponse' in result).toBe(true);
    if ('errorResponse' in result) {
      expect(result.errorResponse.error).toBe('UNAUTHORIZED');
    }
  });

  it('returns errorResponse on non-auth API error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    } as unknown as Response);

    const result = await listMistralTzurotVoices('mi-key', 'tzurot-');

    expect('errorResponse' in result).toBe(true);
    if ('errorResponse' in result) {
      expect(result.errorResponse.error).toBe('INTERNAL_ERROR');
    }
  });

  it('returns errorResponse when response shape is malformed', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { unexpected: 'shape' }));

    const result = await listMistralTzurotVoices('mi-key', 'tzurot-');

    expect('errorResponse' in result).toBe(true);
  });
});

describe('getMistralVoice', () => {
  it('returns voice on 200', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, { id: 'v1', name: 'tzurot-alice', user_id: 'u' })
    );

    const result = await getMistralVoice('mi-key', 'v1');

    expect('voice' in result).toBe(true);
    if ('voice' in result) {
      expect(result.voice.voiceId).toBe('v1');
      expect(result.voice.name).toBe('tzurot-alice');
    }
  });

  it('returns 404 errorResponse for nonexistent voice', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    } as unknown as Response);

    const result = await getMistralVoice('mi-key', 'nonexistent');

    expect('errorResponse' in result).toBe(true);
    if ('errorResponse' in result) {
      expect(result.errorResponse.error).toBe('NOT_FOUND');
    }
  });

  it('returns 401 as UNAUTHORIZED', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    } as unknown as Response);

    const result = await getMistralVoice('bad-key', 'v1');

    expect('errorResponse' in result).toBe(true);
    if ('errorResponse' in result) {
      expect(result.errorResponse.error).toBe('UNAUTHORIZED');
    }
  });
});

describe('deleteMistralVoice', () => {
  it('issues DELETE with the voice id encoded in the path', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 } as unknown as Response);

    await deleteMistralVoice('mi-key', 'voice-uuid-abc');

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('/v1/audio/voices/voice-uuid-abc');
    expect((init as RequestInit).method).toBe('DELETE');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer mi-key' });
  });

  it('encodes special characters (defense against weird ids)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 } as unknown as Response);

    await deleteMistralVoice('mi-key', 'weird/id space');

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('weird%2Fid%20space');
  });
});
