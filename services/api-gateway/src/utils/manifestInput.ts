/**
 * Manifest-driven request-input validation for gateway route handlers.
 *
 * The route manifest (`@tzurot/clients`) declares a Zod schema per `?query`
 * param and per `:path` param. `withManifestInput` runs those schemas at the
 * handler boundary, so the manifest is the single definition of what a route
 * accepts: a request that fails either schema gets the standard `sendZodError`
 * 400 and the handler never runs; a request that passes reaches the handler
 * with the PARSED values (trimmed, defaulted, narrowed) rather than a cast of
 * `req.query`.
 *
 * Params are validated before query. Unknown query keys are stripped from the
 * parsed object (Zod's default object mode); a handler that reads a key the
 * manifest does not declare (the `?userId=` subject convention) still reads it
 * from `req.query` directly.
 */

import type { Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { resolveQueryShape, type RouteDef } from '@tzurot/clients';
import { asyncHandler } from './asyncHandler.js';
import { sendZodError } from './zodHelpers.js';

type Shape = Record<string, z.ZodTypeAny>;

type QueryShapeOf<Q> = Q extends z.ZodObject<infer S> ? S : Q extends Shape ? Q : never;

/** Parsed `?query` object for a manifest entry (empty object when none is declared). */
export type ManifestQuery<R> = R extends { readonly query: infer Q }
  ? z.infer<z.ZodObject<QueryShapeOf<Q>>>
  : Record<string, never>;

/** Parsed `:params` object for a manifest entry (empty object when none is declared). */
export type ManifestParams<R> = R extends { readonly params: infer P extends Shape }
  ? z.infer<z.ZodObject<P>>
  : Record<string, never>;

export interface ManifestInput<R> {
  readonly query: ManifestQuery<R>;
  readonly params: ManifestParams<R>;
}

const VALIDATED_ROUTE_ID = Symbol('manifestValidatedRouteId');

/**
 * Wrap a handler so the manifest entry's query (and params, where declared)
 * schemas run before it. Returns an Express handler tagged with the entry's
 * id, which the drift guard reads to prove the mounted handler validates
 * against the right manifest entry.
 */
export function withManifestInput<R extends RouteDef, Req extends Request = Request>(
  route: R,
  handler: (req: Req, res: Response, input: ManifestInput<R>) => Promise<void>
): RequestHandler {
  // A manifest ZodObject query carries its own object-level modes (.refine,
  // .superRefine, .strict, .passthrough) — rebuilding via resolveQueryShape's
  // `.shape` extraction would silently drop them. Use it as-is; only the
  // "spread" record form (or no query at all) needs wrapping in z.object().
  const querySchema =
    route.query instanceof z.ZodObject
      ? route.query
      : z.object(resolveQueryShape(route.query) ?? {});
  const paramsSchema = z.object(route.params ?? {});
  const wrapped = asyncHandler<Req>(async (req, res) => {
    const params = paramsSchema.safeParse(req.params);
    if (!params.success) {
      sendZodError(res, params.error);
      return;
    }
    const query = querySchema.safeParse(req.query);
    if (!query.success) {
      sendZodError(res, query.error);
      return;
    }
    await handler(req, res, {
      query: query.data as ManifestQuery<R>,
      params: params.data as ManifestParams<R>,
    });
  });
  Object.defineProperty(wrapped, VALIDATED_ROUTE_ID, { value: route.id });
  return wrapped;
}

/** The manifest route id a handler was wrapped with, or undefined if unwrapped. */
export function getManifestValidatedRouteId(handler: unknown): string | undefined {
  if (typeof handler !== 'function') {
    return undefined;
  }
  const id: unknown = (handler as unknown as Record<symbol, unknown>)[VALIDATED_ROUTE_ID];
  return typeof id === 'string' ? id : undefined;
}
