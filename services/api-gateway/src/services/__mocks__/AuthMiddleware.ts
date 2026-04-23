/**
 * Shared mock for `services/AuthMiddleware.ts` used by the api-gateway
 * route test suites.
 *
 * vitest auto-discovers this file when a test calls
 *   vi.mock('../../services/AuthMiddleware.js');
 * (no factory), so individual test files don't duplicate the 10+ lines of
 * `vi.mock` boilerplate that would otherwise be repeated across ~29 test
 * files. Before this existed, each file had its own:
 *
 *   vi.mock('../../services/AuthMiddleware.js', async () => {
 *     const actual = await vi.importActual<...>('../../services/AuthMiddleware.js');
 *     return { ...actual, requireUserAuth: vi.fn(...), ... };
 *   });
 *
 * Centralizing here means:
 *   - `getOrCreateUserService` and other auxiliary exports pass through
 *     to the real implementation (via `export * from '../AuthMiddleware.js'`)
 *   - `requireUserAuth` and `requireProvisionedUser` are stubbed to a
 *     passthrough `(_req, _res, next) => next()` by default
 *   - Tests that need custom middleware behavior (e.g., injecting a
 *     `userId` onto the request) use `vi.mocked(requireUserAuth)
 *     .mockImplementation(...)` to override in a `beforeEach` or `it`
 *     block — the default stub doesn't get in their way
 *
 * When adding a new export to `AuthMiddleware.ts`, it passes through
 * automatically via the wildcard re-export — no change needed here.
 * When adding a new middleware factory that should be stubbed, add an
 * explicit `vi.fn(...)` export below (the explicit export wins over
 * the wildcard re-export per ES module semantics).
 */

import { vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Re-export everything from the real module so non-stubbed exports
// (getOrCreateUserService, extractOwnerId, isValidServiceSecret, etc.)
// pass through to their real implementations.
export * from '../AuthMiddleware.js';

// Default passthrough stubs for the two middleware factories most tests
// mock. The inner `vi.fn(...)` (not a plain arrow) matches the pattern
// used by pre-consolidation inline mocks so test assertions on the
// middleware invocation itself (e.g., `expect(requireUserAuth()).toHaveBeenCalled()`)
// continue to work. Tests that need custom middleware behavior override
// via `vi.mocked(requireUserAuth).mockImplementation(...)`.
export const requireUserAuth = vi.fn(() =>
  vi.fn((_req: Request, _res: Response, next: NextFunction) => next())
);
export const requireProvisionedUser = vi.fn(() =>
  vi.fn((_req: Request, _res: Response, next: NextFunction) => next())
);
