import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    getConfig: vi.fn(() => ({
      GATEWAY_URL: 'http://gateway.test',
      INTERNAL_SERVICE_SECRET: 'test-secret',
    })),
  };
});

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { adminFetch, adminPostJson, adminPutJson, adminPatchJson } from './adminApiClient.js';
import { TIMEOUTS } from '@tzurot/common-types';

describe('adminApiClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('signal / timeout wiring', () => {
    it('attaches an AbortSignal that fires by ADMIN_GATEWAY timeout', async () => {
      // Sanity: the test infrastructure can construct a timeout-style signal
      // and the helper forwards one to fetch. The actual timer firing is
      // covered by AbortSignal.timeout's contract; we verify the wiring.
      await adminFetch('/admin/metrics');

      expect(mockFetch).toHaveBeenCalledOnce();
      const [, init] = mockFetch.mock.calls[0];
      expect(init.signal).toBeInstanceOf(AbortSignal);
      // Pin the contract: 10s is well inside Discord's 15-min interaction
      // expiry but short enough to surface real gateway hangs.
      expect(TIMEOUTS.ADMIN_GATEWAY).toBe(10_000);
    });

    it('respects a caller-supplied signal alongside the default timeout', async () => {
      // AbortSignal.any composes signals — abort fires if EITHER the caller's
      // signal or the timeout aborts. We verify the resulting signal can be
      // aborted via the caller's controller (proving the caller's signal is
      // wired into the merged signal, not silently dropped).
      const controller = new AbortController();
      await adminFetch('/admin/metrics', { signal: controller.signal });

      const [, init] = mockFetch.mock.calls[0];
      const mergedSignal = init.signal as AbortSignal;
      expect(mergedSignal.aborted).toBe(false);
      controller.abort();
      expect(mergedSignal.aborted).toBe(true);
    });
  });

  describe('headers', () => {
    it('sends X-Service-Auth on every request', async () => {
      await adminFetch('/admin/metrics');
      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers['X-Service-Auth']).toBe('test-secret');
    });

    it('adds X-User-Id when userId is provided', async () => {
      await adminFetch('/admin/settings', { userId: 'discord-user-123' });
      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers['X-User-Id']).toBe('discord-user-123');
    });

    it('omits X-User-Id when userId is absent', async () => {
      await adminFetch('/admin/metrics');
      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers['X-User-Id']).toBeUndefined();
    });

    it('merges custom headers without losing X-Service-Auth', async () => {
      await adminFetch('/admin/db-sync', { headers: { 'X-Custom': 'value' } });
      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers['X-Service-Auth']).toBe('test-secret');
      expect(init.headers['X-Custom']).toBe('value');
    });
  });

  describe('adminPostJson', () => {
    it('serializes body as JSON with the correct content-type', async () => {
      await adminPostJson('/admin/db-sync', { dryRun: true });
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('http://gateway.test/admin/db-sync');
      expect(init.method).toBe('POST');
      expect(init.body).toBe(JSON.stringify({ dryRun: true }));
      expect(init.headers['Content-Type']).toContain('application/json');
    });
  });

  describe('adminPutJson', () => {
    it('serializes body as JSON with PUT method', async () => {
      await adminPutJson('/admin/llm-config/123', { name: 'updated' });
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('http://gateway.test/admin/llm-config/123');
      expect(init.method).toBe('PUT');
      expect(init.body).toBe(JSON.stringify({ name: 'updated' }));
    });
  });

  describe('adminPatchJson', () => {
    it('serializes body as JSON with PATCH method', async () => {
      await adminPatchJson('/admin/llm-config/123', { name: 'updated' });
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('http://gateway.test/admin/llm-config/123');
      expect(init.method).toBe('PATCH');
      expect(init.body).toBe(JSON.stringify({ name: 'updated' }));
    });
  });

  describe('error paths', () => {
    it('throws when GATEWAY_URL is not configured', async () => {
      const { getConfig } = await import('@tzurot/common-types');
      vi.mocked(getConfig).mockReturnValueOnce({} as ReturnType<typeof getConfig>);

      await expect(adminFetch('/admin/metrics')).rejects.toThrow('GATEWAY_URL is not configured');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
