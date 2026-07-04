import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateMistralKey } from './mistral.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
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

describe('validateMistralKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns valid=true for 200 (key authorizes /v1/* including audio)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: 'mistral-large-latest' }] }),
    });

    const result = await validateMistralKey('mi-valid-key');
    expect(result.valid).toBe(true);
    expect(result.errorCode).toBeUndefined();
  });

  it('returns INVALID_KEY for 401', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 });
    const result = await validateMistralKey('mi-bad-key');
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('INVALID_KEY');
  });

  it('returns INVALID_KEY for 403', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403 });
    const result = await validateMistralKey('mi-forbidden');
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('INVALID_KEY');
  });

  it('returns UNKNOWN with HTTP status for other non-2xx', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503 });
    const result = await validateMistralKey('mi-key');
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('UNKNOWN');
    expect(result.error).toBe('HTTP 503');
  });

  it('sends Authorization: Bearer header', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    await validateMistralKey('mi-test-key');

    const init = mockFetch.mock.calls[0][1];
    expect(init.headers.Authorization).toBe('Bearer mi-test-key');
  });

  it('returns TIMEOUT on AbortError', async () => {
    mockFetch.mockImplementationOnce(() => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    });

    const result = await validateMistralKey('mi-slow');
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('TIMEOUT');
  });
});
