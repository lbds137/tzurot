import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

import { probeShapesSession } from './ShapesPreflight.js';

const SESSION_COOKIE = '__Secure-better-auth.session_token=abcdef0123456789abcdef0123456789';

function mockResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

describe('probeShapesSession', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns "valid" when shapes.inc returns 2xx', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200));
    await expect(probeShapesSession(SESSION_COOKIE)).resolves.toBe('valid');
  });

  it('returns "valid" for non-200 2xx codes (e.g., 204)', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(204));
    await expect(probeShapesSession(SESSION_COOKIE)).resolves.toBe('valid');
  });

  it('returns "invalid" on 401 Unauthorized', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(401));
    await expect(probeShapesSession(SESSION_COOKIE)).resolves.toBe('invalid');
  });

  it('returns "invalid" on 403 Forbidden', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(403));
    await expect(probeShapesSession(SESSION_COOKIE)).resolves.toBe('invalid');
  });

  it('returns "inconclusive" on 404 (endpoint moved/missing)', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(404));
    await expect(probeShapesSession(SESSION_COOKIE)).resolves.toBe('inconclusive');
  });

  it('returns "inconclusive" on 500 server error', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(500));
    await expect(probeShapesSession(SESSION_COOKIE)).resolves.toBe('inconclusive');
  });

  it('returns "inconclusive" on 503 service unavailable', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(503));
    await expect(probeShapesSession(SESSION_COOKIE)).resolves.toBe('inconclusive');
  });

  it('returns "inconclusive" on network error (TypeError from undici)', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(probeShapesSession(SESSION_COOKIE)).resolves.toBe('inconclusive');
  });

  it('returns "inconclusive" when the fetch is aborted (AbortError)', async () => {
    const abortError = new DOMException('The user aborted a request.', 'AbortError');
    mockFetch.mockRejectedValueOnce(abortError);
    await expect(probeShapesSession(SESSION_COOKIE)).resolves.toBe('inconclusive');
  });

  it('sends the submitted cookie and a Chrome-style User-Agent', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200));
    await probeShapesSession(SESSION_COOKIE);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/session'),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Cookie: SESSION_COOKIE,
          'User-Agent': expect.stringContaining('Mozilla/5.0'),
          Accept: 'application/json',
        }),
      })
    );
  });

  it('hits shapes.inc on the HTTPS origin', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200));
    await probeShapesSession(SESSION_COOKIE);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/shapes\.inc\//),
      expect.anything()
    );
  });
});
