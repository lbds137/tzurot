import { describe, it, expect } from 'vitest';
import { InfraError, GatewayClientError, nullOn404 } from './resultHelpers.js';
import type { GatewayResult } from './transport.js';

// Builders for the two GatewayResult arms. The failure arm is kind-independent
// of T, so a single set of fixtures covers every helper.
const ok = <T>(data: T): GatewayResult<T> => ({ ok: true, data });
const notFound = <T>(): GatewayResult<T> => ({
  ok: false,
  kind: 'http',
  error: 'Not Found',
  status: 404,
});
const serverError = <T>(): GatewayResult<T> => ({
  ok: false,
  kind: 'http',
  error: 'Internal Server Error',
  status: 500,
});
const timeout = <T>(): GatewayResult<T> => ({
  ok: false,
  kind: 'timeout',
  error: 'request timed out',
  status: 0,
});
const network = <T>(): GatewayResult<T> => ({
  ok: false,
  kind: 'network',
  error: 'ECONNRESET',
  status: 0,
});
const forbidden = <T>(): GatewayResult<T> => ({
  ok: false,
  kind: 'http',
  error: 'Forbidden',
  status: 403,
});
const configError = <T>(): GatewayResult<T> => ({
  ok: false,
  kind: 'config',
  error: 'Missing baseUrl',
  status: 0,
});
const schemaError = <T>(): GatewayResult<T> => ({
  ok: false,
  kind: 'schema',
  error: 'Response failed Zod validation',
  status: 0,
});

describe('InfraError', () => {
  it('is an Error carrying the failure kind + status', () => {
    const err = new InfraError({ ok: false, kind: 'timeout', error: 'boom', status: 0 });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(InfraError);
    expect(err.name).toBe('InfraError');
    expect(err.kind).toBe('timeout');
    expect(err.status).toBe(0);
    expect(err.message).toContain('timeout');
    expect(err.message).toContain('boom');
  });
});

describe('GatewayClientError', () => {
  it('is an Error carrying the 4xx status, distinct from InfraError', () => {
    const err = new GatewayClientError({
      ok: false,
      kind: 'http',
      error: 'Forbidden',
      status: 403,
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(GatewayClientError);
    expect(err).not.toBeInstanceOf(InfraError);
    expect(err.status).toBe(403);
    expect(err.message).toContain('403');
  });
});

describe('nullOn404', () => {
  it('returns the data on success', () => {
    expect(nullOn404(ok({ id: 'x' }))).toEqual({ id: 'x' });
  });

  it('returns null ONLY on a genuine 404', () => {
    expect(nullOn404(notFound())).toBeNull();
  });

  it.each([
    ['timeout', timeout()],
    ['network', network()],
    ['config', configError()],
    ['schema', schemaError()],
    ['5xx', serverError()],
  ])('throws InfraError on an infra failure (%s) — never a silent null', (_label, failure) => {
    expect(() => nullOn404(failure)).toThrow(InfraError);
  });

  it('throws GatewayClientError (not InfraError) on a non-404 4xx — no "try again"', () => {
    expect(() => nullOn404(forbidden())).toThrow(GatewayClientError);
    expect(() => nullOn404(forbidden())).not.toThrow(InfraError);
  });
});
describe('GatewayClientError — message content', () => {
  it('carries both the status and the error text in the message', () => {
    const err = new GatewayClientError({
      ok: false,
      kind: 'http',
      status: 403,
      error: 'Persona not found',
    });

    expect(err.message).toBe('Gateway client error (status 403): Persona not found');
    expect(err.name).toBe('GatewayClientError');
  });
});
