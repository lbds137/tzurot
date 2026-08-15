/**
 * Unit tests for the reasoning-trace handler's guard branches.
 *
 * The substantive behaviour — the WHERE-clause access gate and the
 * write→read chain — is pinned in `historyReasoning.component.test.ts` against
 * a real database, because a mocked prisma can only show that SOME filter was
 * passed, never that it excludes another user's row. What is worth unit-testing
 * here is the input validation that runs BEFORE any query, plus the assertion
 * that a rejected request issues no query at all.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../types.js';
import type { RouteDeps } from '../routeDeps.js';

const { mockIsBotOwner } = vi.hoisted(() => ({ mockIsBotOwner: vi.fn(() => false) }));

vi.mock('@tzurot/common-types/utils/ownerMiddleware', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/ownerMiddleware')>(
    '@tzurot/common-types/utils/ownerMiddleware'
  );
  return { ...actual, isBotOwner: mockIsBotOwner };
});

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

import { handleGetMessageReasoning } from './historyReasoning.js';

describe('handleGetMessageReasoning guards', () => {
  const findFirst = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsBotOwner.mockReturnValue(false);
  });

  function deps(): RouteDeps {
    return { prisma: { conversationHistory: { findFirst } } } as unknown as RouteDeps;
  }

  function reqRes(userId: string | undefined, messageId: string | undefined) {
    const req = {
      userId,
      params: messageId === undefined ? {} : { messageId },
      query: {},
    } as unknown as AuthenticatedRequest;
    const json = vi.fn().mockReturnThis();
    const status = vi.fn().mockReturnThis();
    return { req, res: { status, json } as unknown as Response, json, status };
  }

  it('500s and queries nothing when the caller identity is missing', async () => {
    const { req, res, status } = reqRes(undefined, '222222222222222222');

    await handleGetMessageReasoning(deps())(req, res, () => undefined);

    expect(status).toHaveBeenCalledWith(500);
    // The fail-closed point: no query may run without an identity to filter on.
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('500s and queries nothing when the caller identity is an empty string', async () => {
    const { req, res, status } = reqRes('', '222222222222222222');

    await handleGetMessageReasoning(deps())(req, res, () => undefined);

    expect(status).toHaveBeenCalledWith(500);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('400s and queries nothing when the message ID is absent', async () => {
    const { req, res, status } = reqRes('900000000000000071', undefined);

    await handleGetMessageReasoning(deps())(req, res, () => undefined);

    expect(status).toHaveBeenCalledWith(400);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('scopes the query to the caller for a non-owner', async () => {
    findFirst.mockResolvedValue(null);
    const { req, res } = reqRes('900000000000000071', '222222222222222222');

    await handleGetMessageReasoning(deps())(req, res, () => undefined);

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          persona: { owner: { discordId: '900000000000000071' } },
        }),
      })
    );
  });

  it('omits the ownership predicate for the bot owner', async () => {
    mockIsBotOwner.mockReturnValue(true);
    findFirst.mockResolvedValue(null);
    const { req, res } = reqRes('900000000000000099', '222222222222222222');

    await handleGetMessageReasoning(deps())(req, res, () => undefined);

    const where = findFirst.mock.calls[0][0].where as Record<string, unknown>;
    expect(where.persona).toBeUndefined();
  });
});
