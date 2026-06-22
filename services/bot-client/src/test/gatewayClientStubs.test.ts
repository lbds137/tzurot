import { describe, it, expect } from 'vitest';
import {
  makeOk,
  makeErr,
  asUserClient,
  asOwnerClient,
  asServiceClient,
} from './gatewayClientStubs.js';

describe('makeOk', () => {
  it('returns a discriminated ok=true result with the data attached', () => {
    expect(makeOk({ shapes: [] })).toEqual({ ok: true, data: { shapes: [] } });
  });

  it('preserves the generic type at the type level (number)', () => {
    const result = makeOk(42);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe(42);
    }
  });
});

describe('makeErr', () => {
  it('returns ok=false with status + default error message, kind derived from status', () => {
    expect(makeErr(404)).toEqual({ ok: false, kind: 'http', error: 'fail', status: 404 });
  });

  it('accepts a custom error message', () => {
    expect(makeErr(500, 'database down')).toEqual({
      ok: false,
      kind: 'http',
      error: 'database down',
      status: 500,
    });
  });

  it('derives kind=network for a status-0 (non-HTTP) transport failure', () => {
    expect(makeErr(0, 'ECONNREFUSED')).toEqual({
      ok: false,
      kind: 'network',
      error: 'ECONNREFUSED',
      status: 0,
    });
  });
});

describe('client cast helpers', () => {
  // The cast helpers are type-only at runtime — they should return the
  // input unchanged. The structural-subset trick is what makes them
  // useful in tests, not any runtime behavior.

  it('asUserClient returns the input unchanged', () => {
    const stub = { listShapes: () => null };
    expect(asUserClient(stub)).toBe(stub);
  });

  it('asOwnerClient returns the input unchanged', () => {
    const stub = { cleanup: () => null };
    expect(asOwnerClient(stub)).toBe(stub);
  });

  it('asServiceClient returns the input unchanged', () => {
    const stub = { aiGenerate: () => null };
    expect(asServiceClient(stub)).toBe(stub);
  });
});
