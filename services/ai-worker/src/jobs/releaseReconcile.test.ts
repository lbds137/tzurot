import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const configMock = vi.hoisted(() => ({
  value: {
    GATEWAY_URL: 'http://gateway:3001' as string | undefined,
    INTERNAL_SERVICE_SECRET: 'service-secret' as string | undefined,
  },
}));
vi.mock('@tzurot/common-types/config/config', () => ({
  getConfig: () => configMock.value,
}));

import { triggerReleaseReconcile } from './releaseReconcile.js';

const SUMMARY = {
  checked: 1,
  announced: ['v3.0.0-beta.166'],
  alreadyAnnounced: 0,
  skipped: 0,
  capped: false,
};

describe('triggerReleaseReconcile', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    configMock.value = {
      GATEWAY_URL: 'http://gateway:3001',
      INTERNAL_SERVICE_SECRET: 'service-secret',
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fails fast when GATEWAY_URL is missing (no fetch attempted)', async () => {
    configMock.value = { GATEWAY_URL: undefined, INTERNAL_SERVICE_SECRET: 'service-secret' };
    await expect(triggerReleaseReconcile()).rejects.toThrow('GATEWAY_URL not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails fast when the service secret is missing', async () => {
    configMock.value = { GATEWAY_URL: 'http://gateway:3001', INTERNAL_SERVICE_SECRET: undefined };
    await expect(triggerReleaseReconcile()).rejects.toThrow('INTERNAL_SERVICE_SECRET');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs the internal route with service auth and returns the summary', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve(SUMMARY) });

    const result = await triggerReleaseReconcile();

    expect(result).toEqual(SUMMARY);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://gateway:3001/api/internal/release-broadcast/reconcile');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Service-Auth']).toBe('service-secret');
  });

  it('surfaces a non-2xx response as an error (job fails visibly)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({}) });
    await expect(triggerReleaseReconcile()).rejects.toThrow('HTTP 503');
  });
});
