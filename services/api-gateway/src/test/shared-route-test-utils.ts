/**
 * Shared test utilities for API gateway route tests
 *
 * Extracted from personality, persona, and channel test-utils to reduce duplication.
 * Each route's test-utils imports from here and adds domain-specific mocks.
 */

import { vi } from 'vitest';
import type { Request, Response, Router } from 'express';
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

/** Create mock Express request/response pair */
export function createMockReqRes(
  body: Record<string, unknown> = {},
  params: Record<string, string> = {},
  query: Record<string, string> = {}
): { req: Request & { userId: string }; res: Response } {
  const req = {
    body,
    params,
    query,
    userId: 'discord-user-123',
  } as unknown as Request & { userId: string };

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  return { req, res };
}

/**
 * Create a mock request with `provisionedUserId` + `provisionedDefaultPersonaId`
 * already attached — the post-middleware state of a user-scoped route.
 *
 * This is the migration target for the ~35 route test files that currently
 * mock `requireProvisionedUser` as a no-op `vi.fn((_req, _res, next) => next())`
 * and therefore exercise the shadow-mode fallback branch of
 * `resolveProvisionedUserId` / `getOrCreateInternalUser` rather than the
 * common provisioned path. When the middleware is tightened from shadow-
 * mode-fallthrough to strict-400 (tracked in BACKLOG.md Phase 5c work
 * items), those no-op mocks will produce 400s at the middleware layer and
 * every one of the 35 test files will break en masse.
 *
 * To migrate a test: replace `createMockReqRes(body, params, query)` with
 * `createProvisionedMockReqRes(body, params, query)`, and the route handler
 * will see the same shape it would in prod post-middleware. Handlers that
 * call `resolveProvisionedUserId(req, userService)` will hit the
 * common-path short-circuit and return the `provisionedUserId` directly,
 * without exercising `UserService.getOrCreateUserShell`.
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
 * Create a mock `$executeRaw` implementation for UserService's
 * CTE-based user creation (Phase 5b). UserService uses a single
 * `$executeRaw` call to atomically create the user + default persona,
 * so mocks need only resolve successfully.
 */
export function createUserServiceExecuteRawMock(): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue(1);
}
