import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listElevenLabsTzurotVoices,
  getElevenLabsVoice,
  deleteElevenLabsVoice,
} from './elevenLabsVoicesClient.js';

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
    statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('listElevenLabsTzurotVoices', () => {
  it('returns only tzurot-prefixed voices and the unfiltered total count', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        voices: [
          { voice_id: 'v1', name: 'tzurot-alice' },
          { voice_id: 'v2', name: 'random-other' },
          { voice_id: 'v3', name: 'tzurot-bob' },
        ],
      })
    );

    const result = await listElevenLabsTzurotVoices('el-key');

    expect('voices' in result).toBe(true);
    if ('voices' in result) {
      expect(result.voices).toHaveLength(2);
      expect(result.totalVoices).toBe(3);
      expect(result.voices.map(v => v.name)).toEqual(['tzurot-alice', 'tzurot-bob']);
    }
  });

  it('returns errorResponse on 401', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    } as unknown as Response);

    const result = await listElevenLabsTzurotVoices('bad-key');

    expect('errorResponse' in result).toBe(true);
    if ('errorResponse' in result) {
      expect(result.errorResponse.error).toBe('UNAUTHORIZED');
    }
  });
});

describe('getElevenLabsVoice', () => {
  it('returns voice on 200', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { voice_id: 'v1', name: 'tzurot-alice' }));

    const result = await getElevenLabsVoice('el-key', 'v1');

    expect('voice' in result).toBe(true);
    if ('voice' in result) {
      expect(result.voice.voice_id).toBe('v1');
      expect(result.voice.name).toBe('tzurot-alice');
    }
  });

  it('returns 404 errorResponse for nonexistent voice', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    } as unknown as Response);

    const result = await getElevenLabsVoice('el-key', 'nonexistent');

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

    const result = await getElevenLabsVoice('bad-key', 'v1');

    expect('errorResponse' in result).toBe(true);
    if ('errorResponse' in result) {
      expect(result.errorResponse.error).toBe('UNAUTHORIZED');
    }
  });

  it('returns errorResponse when response shape is malformed', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { unexpected: 'shape' }));

    const result = await getElevenLabsVoice('el-key', 'v1');

    expect('errorResponse' in result).toBe(true);
  });
});

describe('deleteElevenLabsVoice', () => {
  it('issues DELETE with the voice id encoded in the path', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 } as unknown as Response);

    await deleteElevenLabsVoice('el-key', 'voice-id-abc');

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('/v1/voices/voice-id-abc');
    expect((init as RequestInit).method).toBe('DELETE');
    expect((init as RequestInit).headers).toMatchObject({ 'xi-api-key': 'el-key' });
  });

  it('encodes special characters (defense against weird ids)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 } as unknown as Response);

    await deleteElevenLabsVoice('el-key', 'weird/id space');

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('weird%2Fid%20space');
  });
});
