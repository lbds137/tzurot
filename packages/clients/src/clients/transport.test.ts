/**
 * Tests for the shared gateway transport.
 *
 * Uses a fetch stub instead of msw to keep the test surface small and
 * to keep common-types free of fetch-mocking dev deps.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { GATEWAY_TIMEOUTS } from '@tzurot/common-types/constants/discord';
import { buildQueryString, callGateway } from './transport.js';

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

describe('buildQueryString', () => {
  it('returns an empty string when every entry is undefined', () => {
    // Generated methods concatenate the result unconditionally, so the
    // no-params case must produce '' and not a bare '?'.
    expect(buildQueryString([['a', undefined]])).toBe('');
    expect(buildQueryString([])).toBe('');
  });

  it('skips undefined entries while keeping the defined ones', () => {
    expect(
      buildQueryString([
        ['a', '1'],
        ['b', undefined],
        ['c', '3'],
      ])
    ).toBe('?a=1&c=3');
  });

  it('serializes a number identically to its pre-stringified form', () => {
    // The point of accepting `number`: callers holding a number get the same
    // wire output as callers who stringified first, so the widening can't
    // change what the gateway receives.
    expect(buildQueryString([['sinceDays', 30]])).toBe(
      buildQueryString([['sinceDays', String(30)]])
    );
    expect(buildQueryString([['sinceDays', 30]])).toBe('?sinceDays=30');
  });

  it('keeps a zero value rather than dropping it as falsy', () => {
    // The filter tests `!== undefined`, not truthiness — `0` is a legitimate
    // value for a numeric param and must survive.
    expect(buildQueryString([['offset', 0]])).toBe('?offset=0');
  });

  it('percent-encodes values that need it', () => {
    expect(buildQueryString([['search', 'a b&c']])).toBe('?search=a+b%26c');
  });
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

  it('strips trailing slashes from baseUrl (defensive against misconfig)', async () => {
    // A misconfigured `GATEWAY_URL=https://example.test/` previously
    // produced `https://example.test//api/...`, which nginx and many CDN
    // configs reject. Normalizing here makes the transport robust against
    // the typo without changing behavior for correctly-configured URLs.
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await callGateway({ ...baseOpts, baseUrl: 'https://example.test/' });
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toBe('https://example.test/api/user/timezone');

    // Doubled-slash misconfig: ops-CLI baseUrls bypass the env schema's strip,
    // so this layer must handle the case a single-slash strip would miss.
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await callGateway({ ...baseOpts, baseUrl: 'https://example.test//' });
    const [doubledUrl] = fetchSpy.mock.calls[1] as [string];
    expect(doubledUrl).toBe('https://example.test/api/user/timezone');
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
    // A 2xx response with a non-JSON body (a CDN HTML error page) makes
    // response.json() throw. It's a contract violation, not a transport
    // failure — must surface as 'schema' so a retry loop branching on
    // 'network' doesn't retry it forever.
    fetchSpy.mockResolvedValueOnce(new Response('<html>not json</html>', { status: 200 }));
    const result = await callGateway(baseOpts);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('schema');
      expect(result.status).toBe(0);
      expect(result.error).toMatch(/not valid JSON/i);
    }
  });

  it('treats a 204 No Content as success (data: null) when no outputSchema is declared', async () => {
    // The mutation succeeded and the route promises no body — an empty body
    // is the contract, not a violation. Response.json() would throw on it.
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const result = await callGateway({ ...baseOpts, method: 'DELETE' });
    expect(result).toEqual({ ok: true, data: null });
  });

  it('keeps a 204 as kind:schema when the route declares an outputSchema', async () => {
    // A route that PROMISES a body and returns none broke its contract —
    // the schema-less success path above must not mask that.
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const result = await callGateway({
      ...baseOpts,
      outputSchema: z.object({ id: z.string() }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('schema');
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

  it('forwards the upstream error-page body to onWarn as rawText', async () => {
    // The seam this batch exists to close: parseErrorResponse can now recover
    // the body, but that only helps operators if callGateway forwards it into
    // the log fields.
    const onWarn = vi.fn();
    fetchSpy.mockResolvedValueOnce(
      new Response('<html><h1>502 Bad Gateway</h1>nginx</html>', {
        status: 502,
        headers: { 'Content-Type': 'text/html' },
      })
    );

    await callGateway({ ...baseOpts, onWarn });

    expect(onWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'http',
        status: 502,
        rawText: expect.stringContaining('nginx') as unknown as string,
      }),
      'Request failed'
    );
  });

  it('redacts the service secret if an upstream responder echoes it back', async () => {
    // The reflection case: a proxy that includes the request headers in its
    // error body would otherwise put the shared secret straight into a log.
    const onWarn = vi.fn();
    fetchSpy.mockResolvedValueOnce(
      new Response('400 Bad Request\nX-Service-Auth: secret-123\n', { status: 400 })
    );

    await callGateway({ ...baseOpts, onWarn });

    const fields = onWarn.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(fields.rawText).not.toContain('secret-123');
    expect(fields.rawText).toContain('[redacted]');
  });

  it('redacts an echoed username in both its encoded and decoded forms', async () => {
    // Username headers travel encodeURIComponent-encoded, so a responder can
    // echo either shape depending on whether it decoded before rendering.
    const onWarn = vi.fn();
    fetchSpy.mockResolvedValueOnce(
      new Response('rejected for user caf%C3%A9user and also caféuser', { status: 431 })
    );

    await callGateway({
      ...baseOpts,
      headers: { 'X-User-Username': encodeURIComponent('caféuser') },
      onWarn,
    });

    const fields = onWarn.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(fields.rawText).not.toContain('caf%C3%A9user');
    expect(fields.rawText).not.toContain('caféuser');
  });

  it('redacts a secret that straddles the truncation boundary', async () => {
    // Ordering regression: truncating first and redacting the excerpt leaves a
    // PARTIAL secret that exact-match redaction can no longer find, so the
    // fragment survives into the log. Redaction must run against the full body.
    // 505 filler chars puts the secret across the 512-char cutoff.
    const onWarn = vi.fn();
    fetchSpy.mockResolvedValueOnce(
      new Response(`${'x'.repeat(505)}secret-123 trailing`, { status: 400 })
    );

    await callGateway({ ...baseOpts, onWarn });

    const fields = onWarn.mock.calls[0]?.[0] as Record<string, unknown>;
    // Not just the whole secret — no prefix of it may survive either.
    expect(fields.rawText).not.toContain('secret-');
  });

  it('skips a never-log header that is absent or empty, leaving the body intact', async () => {
    // The skip guard is load-bearing in two ways that both mangle the log if it
    // stops working: an EMPTY value would make `split('')` explode the body
    // into single characters joined by the marker, and an ABSENT one would
    // coerce to the literal string "undefined" and redact that word wherever it
    // legitimately appears. The body contains both a plain sentence and the
    // word "undefined" so either failure is visible.
    const onWarn = vi.fn();
    fetchSpy.mockResolvedValueOnce(
      new Response('upstream reported undefined behaviour', { status: 502 })
    );

    await callGateway({
      ...baseOpts,
      headers: { 'X-User-Username': '' },
      onWarn,
    });

    const fields = onWarn.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(fields.rawText).toBe('upstream reported undefined behaviour');
  });

  it('does not split a surrogate pair at the truncation boundary', async () => {
    // An emoji straddling the cutoff would otherwise leave a lone high
    // surrogate in the logged string.
    const onWarn = vi.fn();
    fetchSpy.mockResolvedValueOnce(new Response(`${'x'.repeat(511)}😀 tail`, { status: 502 }));

    await callGateway({ ...baseOpts, onWarn });

    const fields = onWarn.mock.calls[0]?.[0] as Record<string, unknown>;
    const text = fields.rawText as string;
    const lastUnit = text.charCodeAt(text.length - 1);
    expect(lastUnit >= 0xd800 && lastUnit <= 0xdbff).toBe(false);
  });

  it('leaves non-sensitive header values intact in rawText', async () => {
    // Guards against the redaction becoming blanket: `X-User-Id` is safe to log
    // by the same rule, and redacting `application/json` or `false` would
    // corrupt the very text rawText exists to preserve.
    const onWarn = vi.fn();
    fetchSpy.mockResolvedValueOnce(
      new Response('<html>upstream said application/json was false for 123456789012345678</html>', {
        status: 502,
      })
    );

    await callGateway({
      ...baseOpts,
      method: 'POST',
      body: { a: 1 },
      headers: { 'X-User-Id': '123456789012345678', 'X-User-Is-Bot': 'false' },
      onWarn,
    });

    const fields = onWarn.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(fields.rawText).toContain('application/json');
    expect(fields.rawText).toContain('false');
    expect(fields.rawText).toContain('123456789012345678');
    expect(fields.rawText).not.toContain('[redacted]');
  });

  it('omits rawText entirely when the gateway returned a structured error', async () => {
    // Absent, not `undefined`: a key that appears only when it carries
    // information is what makes the log searchable.
    const onWarn = vi.fn();
    fetchSpy.mockResolvedValueOnce(jsonResponse({ message: 'Forbidden' }, { status: 403 }));

    await callGateway({ ...baseOpts, onWarn });

    const fields = onWarn.mock.calls[0]?.[0] as Record<string, unknown>;
    expect('rawText' in fields).toBe(false);
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
