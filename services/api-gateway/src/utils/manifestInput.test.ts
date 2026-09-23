/**
 * Tests for the manifest-driven request-input wrapper.
 *
 * Drives `withManifestInput` with a fake req/res (the codebase's standard
 * unit-tier shape — see `routes/user/memoryFacts.test.ts` `reqRes`) against a
 * synthetic manifest route built in-file, since this module has no route of
 * its own to borrow. Every test asserts the SEAM: what the handler receives,
 * or what response the wrapper sends when it never reaches the handler.
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import type { Request, Response } from 'express';
import type { RouteDef } from '@tzurot/clients';
import { withManifestInput, getManifestValidatedRouteId } from './manifestInput.js';

const route = {
  audience: 'user',
  method: 'get',
  path: '/x/:id',
  id: 'testRoute',
  params: { id: z.string().min(2) },
  query: { name: z.string().trim().max(5), n: z.string().optional() },
  output: z.object({}),
} as const satisfies RouteDef;

/** Exercises the ZodObject "schema" form of `query` (vs. the "spread" record form above). */
const zodObjectQueryRoute = {
  audience: 'user',
  method: 'get',
  path: '/y',
  id: 'zodObjectQueryRoute',
  query: z.object({ q: z.string() }),
  output: z.object({}),
} as const satisfies RouteDef;

/** A route with no declared query/params. */
const bareRoute = {
  audience: 'user',
  method: 'get',
  path: '/z',
  id: 'bareRoute',
  output: z.object({}),
} as const satisfies RouteDef;

/** A route whose ZodObject query carries an object-level `.refine()` — the
 *  form `resolveQueryShape`'s `.shape` extraction would silently drop. */
const refinedQueryRoute = {
  audience: 'user',
  method: 'get',
  path: '/w',
  id: 'refinedQueryRoute',
  query: z
    .object({ a: z.string().optional(), b: z.string().optional() })
    .refine(v => v.a !== undefined || v.b !== undefined, { message: 'a or b is required' }),
  output: z.object({}),
} as const satisfies RouteDef;

function reqRes(params: Record<string, unknown> = {}, query: Record<string, unknown> = {}) {
  const req = { params, query } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

describe('withManifestInput', () => {
  it('calls the handler once with parsed query and params on valid input', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const wrapped = withManifestInput(route, handler);
    const { req, res } = reqRes({ id: 'ab12' }, { name: '  ab  ' });

    await wrapped(req, res, () => undefined);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(req, res, {
      query: { name: 'ab' },
      params: { id: 'ab12' },
    });
  });

  it('strips unknown query keys from the parsed query', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const wrapped = withManifestInput(route, handler);
    const { req, res } = reqRes({ id: 'ab12' }, { name: 'ab', extra: '1' });

    await wrapped(req, res, () => undefined);

    expect(handler).toHaveBeenCalledWith(req, res, {
      query: { name: 'ab' },
      params: { id: 'ab12' },
    });
  });

  it('400s with VALIDATION_ERROR and a name-prefixed message on invalid query, and never calls the handler', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const wrapped = withManifestInput(route, handler);
    const { req, res } = reqRes({ id: 'ab12' }, { name: 'toolong' });

    await wrapped(req, res, () => undefined);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'VALIDATION_ERROR',
        message: expect.stringMatching(/^name:/),
      })
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('400s and never calls the handler when a query key arrives array-valued', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const wrapped = withManifestInput(route, handler);
    const { req, res } = reqRes({ id: 'ab12' }, { name: ['a', 'b'] });

    await wrapped(req, res, () => undefined);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(handler).not.toHaveBeenCalled();
  });

  it('400s with the params message (not the query one) when both params and query are invalid', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const wrapped = withManifestInput(route, handler);
    const { req, res } = reqRes({ id: 'a' }, { name: 'toolong' });

    await wrapped(req, res, () => undefined);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/^id:/) })
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('validates a ZodObject-form query schema the same way as the spread form', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const wrapped = withManifestInput(zodObjectQueryRoute, handler);

    const valid = reqRes({}, { q: 'hi' });
    await wrapped(valid.req, valid.res, () => undefined);
    expect(handler).toHaveBeenCalledWith(valid.req, valid.res, {
      query: { q: 'hi' },
      params: {},
    });

    const missing = reqRes({}, {});
    await wrapped(missing.req, missing.res, () => undefined);
    expect(missing.res.status).toHaveBeenCalledWith(400);
  });

  it('preserves an object-level .refine() on a ZodObject query: rejects when neither key is present', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const wrapped = withManifestInput(refinedQueryRoute, handler);
    const { req, res } = reqRes({}, {});

    await wrapped(req, res, () => undefined);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(handler).not.toHaveBeenCalled();
  });

  it('preserves an object-level .refine() on a ZodObject query: calls the handler when one key is present', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const wrapped = withManifestInput(refinedQueryRoute, handler);
    const { req, res } = reqRes({}, { a: 'x' });

    await wrapped(req, res, () => undefined);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(req, res, {
      query: { a: 'x' },
      params: {},
    });
  });

  it('hands the handler empty query/params objects when the route declares neither', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const wrapped = withManifestInput(bareRoute, handler);
    const { req, res } = reqRes();

    await wrapped(req, res, () => undefined);

    expect(handler).toHaveBeenCalledWith(req, res, { query: {}, params: {} });
  });

  describe('getManifestValidatedRouteId', () => {
    it('returns the manifest route id for a wrapped handler', () => {
      const wrapped = withManifestInput(route, vi.fn());
      expect(getManifestValidatedRouteId(wrapped)).toBe('testRoute');
    });

    it('returns undefined for a plain (unwrapped) function', () => {
      expect(getManifestValidatedRouteId(() => undefined)).toBeUndefined();
    });

    it('returns undefined for a non-function value', () => {
      expect(getManifestValidatedRouteId({})).toBeUndefined();
    });
  });

  it('sends a 500 via the asyncHandler error path when the handler throws', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('boom'));
    const wrapped = withManifestInput(route, handler);
    const { req, res } = reqRes({ id: 'ab12' }, { name: 'ab' });

    await wrapped(req, res, () => undefined);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
