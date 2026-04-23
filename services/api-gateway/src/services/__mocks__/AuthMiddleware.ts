// Auto-discovered by vitest when a test calls `vi.mock('../../services/AuthMiddleware.js')`
// with no factory. `export *` passes non-stubbed exports (getOrCreateUserService, etc.)
// through to the real module; requireUserAuth / requireProvisionedUser are stubbed as
// passthrough — tests override via `vi.mocked(fn).mockImplementation(...)` when needed.

import { vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

export * from '../AuthMiddleware.js';

export const requireUserAuth = vi.fn(() =>
  vi.fn((_req: Request, _res: Response, next: NextFunction) => next())
);
export const requireProvisionedUser = vi.fn(() =>
  vi.fn((_req: Request, _res: Response, next: NextFunction) => next())
);
