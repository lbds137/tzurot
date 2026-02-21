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
 * Must be called at module scope (before vi.mock) to be hoisted.
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
 * Create a mock $transaction implementation with UserService dependencies.
 *
 * @param mockUserId - User UUID returned by transaction mocks
 * @param mockPersonaId - Persona UUID returned by transaction mocks
 */
export function createUserServiceTransactionMock(
  mockUserId: string,
  mockPersonaId: string
): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation(async (callback: (tx: unknown) => Promise<void>) => {
    const mockTx = {
      user: {
        create: vi.fn().mockResolvedValue({ id: mockUserId }),
        update: vi.fn().mockResolvedValue({ id: mockUserId }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({ defaultPersonaId: null }),
      },
      persona: {
        create: vi.fn().mockResolvedValue({ id: mockPersonaId }),
      },
    };
    await callback(mockTx);
  });
}
