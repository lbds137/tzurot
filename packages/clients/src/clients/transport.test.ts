/**
 * Tests for the shared gateway transport.
 *
 * Uses a fetch stub instead of msw to keep the test surface small and
 * to keep common-types free of fetch-mocking dev deps.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { GATEWAY_TIMEOUTS } from '@tzurot/common-types/constants/discord';
import { callGateway, callGatewayOrThrow } from './transport.js';
import { GatewayApiError } from './errors.js';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

const baseOpts = {
  baseUrl: 'https://example.test',
  serviceSecret: 'secret-123',
  method: 'GET' as const,
  path: '/api/user/timezone',
};

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('callGateway', () => {
  it('returns ok: false when baseUrl is empty (no fetch issued)', async () => {
    const result = await callGateway({ ...baseOpts, baseUrl: '' });
    expect(result).toEqual({ ok: false, kind: 'config', error: 'baseUrl is empty', status: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('attaches the service-secret header on every request', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await callGateway(baseOpts);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['X-Service-Auth']).toBe('secret-123');
  });

  it('passes additional headers through', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await callGateway({
      ...baseOpts,
      headers: { 'X-User-Id': '123', 'X-Request-ID': 'req-abc' },
    });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-User-Id']).toBe('123');
    expect(headers['X-Request-ID']).toBe('req-abc');
  });

  it('sets Content-Type and serializes body when body is defined', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await callGateway({
      ...baseOpts,
      method: 'POST',
      body: { name: 'Alice' },
    });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.body).toBe('{"name":"Alice"}');
  });

  it('omits body + Content-Type when body is undefined', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await callGateway(baseOpts);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it('composes path onto baseUrl', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await callGateway(baseOpts);
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toBe('https://example.test/api/user/timezone');
  });

  it('strips a single trailing slash from baseUrl (defensive against misconfig)', async () => {
    // A misconfigured `GATEWAY_URL=https://example.test/` previously
    // produced `https://example.test//api/...`, which nginx and many CDN
    // configs reject. Normalizing here makes the transport robust against
    // the typo without changing behavior for correctly-configured URLs.
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await callGateway({ ...baseOpts, baseUrl: 'https://example.test/' });
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toBe('https://example.test/api/user/timezone');
  });

  it('defaults write methods (POST/PUT/PATCH/DELETE) to the WRITE timeout', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      timeoutSpy.mockClear();
      fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }));
      await callGateway({ ...baseOpts, method });
      expect(timeoutSpy).toHaveBeenCalledWith(GATEWAY_TIMEOUTS.WRITE);
    }
  });

  it('defaults read methods (GET) to the DEFERRED timeout (safe for post-defer reads)', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await callGateway(baseOpts);
    expect(timeoutSpy).toHaveBeenCalledWith(GATEWAY_TIMEOUTS.DEFERRED);
  });

  it('lets an explicit timeoutMs override the method-aware default', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await callGateway({ ...baseOpts, method: 'POST', timeoutMs: 1234 });
    expect(timeoutSpy).toHaveBeenCalledWith(1234);
  });

  it('returns ok: true with the parsed data on 2xx', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ tz: 'America/New_York' }));
    const result = await callGateway<{ tz: string }>(baseOpts);
    expect(result).toEqual({ ok: true, data: { tz: 'America/New_York' } });
  });

  it('returns ok: false with parsed error fields on non-2xx', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ message: 'Not found', code: 'NOT_FOUND' }, { status: 404 })
    );
    const result = await callGateway(baseOpts);
    expect(result).toEqual({
      ok: false,
      kind: 'http',
      error: 'Not found',
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  it('validates response body with outputSchema when supplied', async () => {
    const schema = z.object({ tz: z.string() });
    fetchSpy.mockResolvedValueOnce(jsonResponse({ tz: 'America/New_York' }));
    const result = await callGateway({ ...baseOpts, outputSchema: schema });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ tz: 'America/New_York' });
    }
  });

  it('returns kind:schema with the raw Zod issues when outputSchema fails validation', async () => {
    const schema = z.object({ tz: z.string() });
    fetchSpy.mockResolvedValueOnce(jsonResponse({ wrong: 'shape' }));
    const result = await callGateway({ ...baseOpts, outputSchema: schema });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('schema');
      expect(result.status).toBe(0);
      expect(result.error).toMatch(/schema validation failed/i);
      // The raw Zod issues ride along so callers can debug contract drift
      // without re-parsing the stringified message.
      expect(result.issues).toEqual(expect.any(Array));
      expect(result.issues?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('returns kind:schema (not network) when a 2xx body is not valid JSON', async () => {
    // A 2xx response with a non-JSON body (204 No Content, a CDN HTML error
    // page) makes response.json() throw. It's a contract violation, not a
    // transport failure — must surface as 'schema' so a retry loop branching
    // on 'network' doesn't retry it forever.
    fetchSpy.mockResolvedValueOnce(new Response('<html>not json</html>', { status: 200 }));
    const result = await callGateway(baseOpts);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('schema');
      expect(result.status).toBe(0);
      expect(result.error).toMatch(/not valid JSON/i);
    }
  });

  it('returns kind:network when fetch rejects with a non-abort error', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await callGateway(baseOpts);
    expect(result).toEqual({ ok: false, kind: 'network', error: 'ECONNREFUSED', status: 0 });
  });

  it('returns kind:timeout with the timeout-specific message on AbortError', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'TimeoutError';
    fetchSpy.mockRejectedValueOnce(abortError);
    const result = await callGateway(baseOpts);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('timeout');
      expect(result.error).toBe('Request timeout (gateway slow or unavailable)');
    }
  });

  it('invokes onWarn for non-2xx responses with kind:http', async () => {
    const onWarn = vi.fn();
    fetchSpy.mockResolvedValueOnce(jsonResponse({ message: 'Forbidden' }, { status: 403 }));
    await callGateway({ ...baseOpts, onWarn });
    expect(onWarn).toHaveBeenCalledWith(
      expect.objectContaining({ path: baseOpts.path, method: 'GET', kind: 'http', status: 403 }),
      'Request failed'
    );
  });

  it('invokes onWarn for schema-validation failures with kind:schema', async () => {
    const onWarn = vi.fn();
    const schema = z.object({ tz: z.string() });
    fetchSpy.mockResolvedValueOnce(jsonResponse({ wrong: 'shape' }));
    await callGateway({ ...baseOpts, outputSchema: schema, onWarn });
    expect(onWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        path: baseOpts.path,
        method: 'GET',
        kind: 'schema',
        issues: expect.any(Array),
      }),
      'Response schema validation failed'
    );
  });

  it('invokes onWarn on the catch branch with kind and the error message', async () => {
    // The thrown-error path (network/timeout) logs `kind` + `error` so an operator
    // can filter by failure category, consistent with the result envelope.
    const onWarn = vi.fn();
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await callGateway({ ...baseOpts, onWarn });
    expect(onWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        path: baseOpts.path,
        method: 'GET',
        kind: 'network',
        error: 'ECONNREFUSED',
      }),
      'Request error'
    );
  });
});

describe('callGatewayOrThrow', () => {
  it('returns data on success', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ tz: 'UTC' }));
    const data = await callGatewayOrThrow<{ tz: string }>(baseOpts);
    expect(data).toEqual({ tz: 'UTC' });
  });

  it('throws GatewayApiError on non-2xx', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ message: 'Forbidden', code: 'AUTH_REQUIRED' }, { status: 403 })
    );
    await expect(callGatewayOrThrow(baseOpts)).rejects.toMatchObject({
      name: 'GatewayApiError',
      message: 'Forbidden',
      status: 403,
      code: 'AUTH_REQUIRED',
      kind: 'http',
    });
  });

  it('throws GatewayApiError carrying kind:network on a network failure', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    // kind propagates to the throw path so try/catch callers get the same
    // network-vs-timeout distinction the result path has.
    const error = await callGatewayOrThrow(baseOpts).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayApiError);
    expect(error).toMatchObject({ status: 0, kind: 'network' });
  });

  it('throws GatewayApiError carrying kind:timeout on a TimeoutError', async () => {
    // The most user-relevant failure on a slow gateway — callGatewayOrThrow is a
    // separate code path from callGateway, so assert the kind propagates here too.
    const abortError = new Error('aborted');
    abortError.name = 'TimeoutError';
    fetchSpy.mockRejectedValueOnce(abortError);
    const error = await callGatewayOrThrow(baseOpts).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayApiError);
    expect(error).toMatchObject({ status: 0, kind: 'timeout' });
  });

  it('throws GatewayApiError carrying kind:schema + the Zod issues on contract drift', async () => {
    // The raw Zod issues forward to the throw path too, so try/catch callers can
    // inspect contract drift structurally instead of re-parsing the message.
    const schema = z.object({ tz: z.string() });
    fetchSpy.mockResolvedValueOnce(jsonResponse({ wrong: 'shape' }));
    const error = await callGatewayOrThrow({ ...baseOpts, outputSchema: schema }).catch(
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(GatewayApiError);
    expect(error).toMatchObject({ status: 0, kind: 'schema' });
    expect((error as GatewayApiError).issues).toEqual(expect.any(Array));
    expect((error as GatewayApiError).issues?.length ?? 0).toBeGreaterThan(0);
  });
});
