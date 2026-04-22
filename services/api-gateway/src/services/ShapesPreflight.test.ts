import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Shared logger singleton so tests can assert on info/warn/error calls.
// `vi.hoisted` is required because `vi.mock` is hoisted above module-scope
// `const`, which would otherwise leave `mockLogger` in the temporal dead zone.
const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => mockLogger,
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
    vi.useFakeTimers();
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('returns "valid" when shapes.inc returns 2xx', async () => {
    mockLogger.info.mockClear();
    mockFetch.mockResolvedValueOnce(mockResponse(200));
    await expect(probeShapesSession(SESSION_COOKIE)).resolves.toBe('valid');
    // Pin the 'Preflight valid' log — observability contract for post-deploy
    // endpoint verification. Silent removal of this log would make the grep
    // procedure return nothing even when the preflight is firing correctly.
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ status: 200 }),
      'Preflight valid'
    );
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

  it('returns "inconclusive" on 429 rate limited', async () => {
    // Data endpoints (like /api/users/info) can rate-limit independently of
    // auth validity. A 429 must NOT be treated as "invalid cookie" — the
    // cookie may be perfectly good, we just hit the rate limiter. Pin this
    // so nobody later adds 429 to the 401/403 branch "for symmetry."
    mockFetch.mockResolvedValueOnce(mockResponse(429));
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

  it('returns "inconclusive" when the preflight times out (setTimeout → abort)', async () => {
    // Simulate shapes.inc hanging: fetch receives the abort signal and rejects
    // with AbortError once `controller.abort()` fires via the internal timer.
    mockFetch.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init.signal;
          if (signal !== undefined && signal !== null) {
            signal.addEventListener('abort', () => {
              reject(new DOMException('The user aborted a request.', 'AbortError'));
            });
          }
        })
    );

    const promise = probeShapesSession(SESSION_COOKIE);
    // Advance past the 5s internal timeout so the AbortController fires.
    await vi.advanceTimersByTimeAsync(6000);
    await expect(promise).resolves.toBe('inconclusive');
  });

  it('sends the submitted cookie and a Chrome-style User-Agent', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200));
    await probeShapesSession(SESSION_COOKIE);

    expect(mockFetch).toHaveBeenCalledWith(
      // Pin `shapes.inc/api/users/info` rather than the loose `/api/users/info`
      // — the former prevents a silent match against e.g. `/api/users/info-extended`
      // if someone ever reshapes PREFLIGHT_ENDPOINT.
      expect.stringContaining('shapes.inc/api/users/info'),
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
