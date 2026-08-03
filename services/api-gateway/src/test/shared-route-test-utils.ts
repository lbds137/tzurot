/**
 * Shared test utilities for API gateway route tests
 *
 * Extracted from personality, persona, and channel test-utils to reduce duplication.
 * Each route's test-utils imports from here and adds domain-specific mocks.
 */

import { vi } from 'vitest';
import type { Request, RequestHandler, Response, Router } from 'express';
import type { ConfigCascadeResolver, LlmConfigResolver } from '@tzurot/config-resolver';
import { getRouteHandler } from './expressRouterUtils.js';

/**
 * Create a typed vi.fn mock for isBotOwner.
 * Assign the result to a module-level const so the mock is available when vi.mock factories run.
 */
export function createMockIsBotOwner(): ((...args: unknown[]) => boolean) & {
  mockReturnValue: (val: boolean) => void;
  mockReset: () => void;
} {
  return vi.fn().mockReturnValue(false) as ((...args: unknown[]) => boolean) & {
    mockReturnValue: (val: boolean) => void;
    mockReset: () => void;
  };
}

/** Mock date factories for consistent testing (factory functions avoid mutable module state) */
export const createMockCreatedAt = (): Date => new Date('2024-01-01T00:00:00.000Z');
export const createMockUpdatedAt = (): Date => new Date('2024-01-02T00:00:00.000Z');

/**
 * Create a mock request with `provisionedUserId` + `provisionedDefaultPersonaId`
 * already attached — the post-middleware state of a user-scoped route.
 *
 * `requireProvisionedUser` is strict: every failure mode (missing headers,
 * malformed URI encoding, a thrown `getOrCreateUser`) returns 400, and the
 * old shadow-mode fallthrough — along with the shell-user path it fell back
 * to — is gone. A test file that mocks the middleware as a no-op
 * `vi.fn((_req, _res, next) => next())` therefore hands the handler a request
 * with no provisioned fields, which is a shape production can no longer
 * produce.
 *
 * To migrate such a test: replace `createMockReqRes(body, params, query)` with
 * `createProvisionedMockReqRes(body, params, query)`, and the route handler
 * will see the same shape it would in prod post-middleware. Handlers that
 * call `resolveProvisionedUserId(req, userService)` hit the common-path
 * short-circuit and return the `provisionedUserId` directly.
 *
 * See `routes/user/shapes/auth.test.ts` for a reference caller using this
 * helper and the "migrate-this-file" TODO pattern.
 */
export function createProvisionedMockReqRes(
  body: Record<string, unknown> = {},
  params: Record<string, string> = {},
  query: Record<string, string> = {},
  options: { provisionedUserId?: string; provisionedDefaultPersonaId?: string } = {}
): {
  req: Request & {
    userId: string;
    provisionedUserId: string;
    provisionedDefaultPersonaId: string;
  };
  res: Response;
} {
  const req = {
    body,
    params,
    query,
    userId: 'discord-user-123',
    provisionedUserId: options.provisionedUserId ?? '00000000-0000-0000-0000-000000000001',
    provisionedDefaultPersonaId:
      options.provisionedDefaultPersonaId ?? '00000000-0000-0000-0000-000000000002',
  } as unknown as Request & {
    userId: string;
    provisionedUserId: string;
    provisionedDefaultPersonaId: string;
  };

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  return { req, res };
}

/** Typed route handler extracted from Express router */
export type RouteHandler = (req: Request & { userId: string }, res: Response) => Promise<void>;

/** Get a typed handler from an Express router by method and path */
export function getHandler(
  router: Router,
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string
): RouteHandler {
  return getRouteHandler(router, method, path) as RouteHandler;
}

/**
 * Adapt a bare `RequestHandler` export (the shape `routes/_generated/mounts.ts`
 * mounts) to the two-argument call shape used across route tests. Express
 * always supplies `next`; handlers wrapped in `asyncHandler` only reach for it
 * on a thrown error, so a `vi.fn()` stand-in is enough.
 *
 * The parameter is the plain `Request` rather than `RouteHandler`'s
 * `Request & { userId: string }` so that suites building a bare mock request
 * can call the result too; contravariance keeps it assignable to
 * `RouteHandler` for the suites that do attach `userId`.
 */
export function asRouteHandler(
  handler: RequestHandler
): (req: Request, res: Response) => Promise<void> {
  return async (req, res) => {
    await handler(req, res, vi.fn());
  };
}

/**
 * Stub resolvers for the two REQUIRED RouteDeps fields. Route tests that
 * don't exercise the cascade/LLM-resolution paths still need the fields to
 * satisfy the compile-level contract (required precisely so a test-only
 * miswiring surfaces at compile time — see routeDeps.ts). Tests that DO
 * exercise resolution keep providing their own real or per-test mocks.
 */
export function stubRouteResolvers(): {
  cascadeResolver: ConfigCascadeResolver;
  llmConfigResolver: LlmConfigResolver;
} {
  return {
    // Method names mirror the REAL classes — the `as unknown` cast means the
    // compiler can't verify this, so a rename there must be mirrored here or
    // the first test exercising the stub gets a TypeError instead of a
    // useful assertion failure.
    cascadeResolver: {
      resolveOverrides: vi.fn().mockResolvedValue({}),
      invalidateUserCache: vi.fn(),
      invalidatePersonalityCache: vi.fn(),
      invalidateChannelCache: vi.fn(),
      clearCache: vi.fn(),
      stopCleanup: vi.fn(),
    } as unknown as ConfigCascadeResolver,
    llmConfigResolver: {
      resolveConfig: vi.fn().mockResolvedValue(null),
    } as unknown as LlmConfigResolver,
  };
}
