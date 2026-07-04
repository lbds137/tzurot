import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { serviceFetch } from './serviceFetch.js';

vi.mock('@tzurot/common-types/config/config', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/config/config')>(
    '@tzurot/common-types/config/config'
  );
  return {
    ...actual,
    getConfig: () => ({ GATEWAY_URL: 'https://example.test' }),
  };
});

vi.mock('../startup.js', () => ({
  getValidatedServiceSecret: () => 'test-secret',
}));

describe('serviceFetch', () => {
  const originalFetch = globalThis.fetch;
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('GETs /health with the X-Service-Auth header', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'healthy' })));

    await serviceFetch('/health');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://example.test/health');
    expect(options.headers['X-Service-Auth']).toBe('test-secret');
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('GETs /metrics with the X-Service-Auth header', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ uptime: 100 })));

    await serviceFetch('/metrics');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('https://example.test/metrics');
  });

  it('rejects with allow-list error for paths not in InfraPath', async () => {
    // `as never` simulates a caller that bypassed the TypeScript narrowing
    // via a cast. The runtime check is defense-in-depth for exactly this case.
    await expect(serviceFetch('/api/user/personality' as never)).rejects.toThrow(
      /not in the infrastructure allow-list/
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws when GATEWAY_URL is empty', async () => {
    const commonTypes = await import('@tzurot/common-types/config/config');
    vi.spyOn(commonTypes, 'getConfig').mockReturnValueOnce({ GATEWAY_URL: '' } as never);

    await expect(serviceFetch('/health')).rejects.toThrow(/GATEWAY_URL is not configured/);
  });

  it('returns the Response object unchanged', async () => {
    const mockResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });
    mockFetch.mockResolvedValueOnce(mockResponse);

    const result = await serviceFetch('/health');

    expect(result).toBe(mockResponse);
  });
});
