import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateOpenRouterKey } from './openrouter.js';

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

describe('validateOpenRouterKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns valid=true for valid key with credits', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { limit_remaining: 50.25 } }),
    });

    const result = await validateOpenRouterKey('sk-or-valid-key');

    expect(result.valid).toBe(true);
    expect(result.credits).toBe(50.25);
    expect(result.errorCode).toBeUndefined();
  });

  it('returns INVALID_KEY for 401', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 });
    const result = await validateOpenRouterKey('sk-or-invalid');
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('INVALID_KEY');
  });

  it('returns INVALID_KEY for 403', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403 });
    const result = await validateOpenRouterKey('sk-or-forbidden');
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('INVALID_KEY');
  });

  it('returns QUOTA_EXCEEDED for zero credits', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { limit_remaining: 0 } }),
    });
    const result = await validateOpenRouterKey('sk-or-no-credits');
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('QUOTA_EXCEEDED');
    expect(result.credits).toBe(0);
  });

  it('returns valid=true when no credit info available', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: {} }),
    });
    const result = await validateOpenRouterKey('sk-or-key');
    expect(result.valid).toBe(true);
    expect(result.credits).toBeUndefined();
  });

  it('returns valid=true when limit_remaining is null (unlimited)', async () => {
    // null <= 0 is true in JS due to coercion — guarded by typeof check
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { limit_remaining: null } }),
    });
    const result = await validateOpenRouterKey('sk-or-unlimited');
    expect(result.valid).toBe(true);
    expect(result.credits).toBeUndefined();
  });

  it('returns TIMEOUT for aborted request', async () => {
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';
    mockFetch.mockRejectedValue(abortError);

    const result = await validateOpenRouterKey('sk-or-slow');
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('TIMEOUT');
  });

  it('returns UNKNOWN for network errors', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));
    const result = await validateOpenRouterKey('sk-or-key');
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('UNKNOWN');
    expect(result.error).toBe('Network error');
  });

  it('returns UNKNOWN for non-ok status', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const result = await validateOpenRouterKey('sk-or-key');
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe('UNKNOWN');
    expect(result.error).toBe('HTTP 500');
  });
});
