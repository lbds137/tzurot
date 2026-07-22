/**
 * Tests for the account-deletion route handlers (unit; the full flow runs
 * for real in delete.component.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const loggerWarnMock = vi.hoisted(() => vi.fn());
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: loggerWarnMock, error: vi.fn() }),
  };
});

vi.mock('../../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
}));

const tokenServiceMock = vi.hoisted(() => ({
  issueAccountDeleteToken: vi.fn(),
  peekAccountDeleteToken: vi.fn(),
  consumeAccountDeleteToken: vi.fn(),
}));
vi.mock('../../../services/MemoryActionTokenService.js', () => ({
  // Plain function: constructable (arrows are not), returns the shared stub.
  MemoryActionTokenService: function MockTokenService() {
    return tokenServiceMock;
  },
}));

const deletionServiceMock = vi.hoisted(() => ({
  preview: vi.fn(),
  deleteAccount: vi.fn(),
}));
vi.mock('../../../services/AccountDeletionService.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../../services/AccountDeletionService.js')
  >('../../../services/AccountDeletionService.js');
  return {
    SuperuserDeletionError: actual.SuperuserDeletionError,
    AccountDeletionService: function MockDeletionService() {
      return deletionServiceMock;
    },
  };
});

const memoryModeMock = vi.hoisted(() => ({ disableAll: vi.fn().mockResolvedValue(0) }));
vi.mock('../../../services/MemoryModeSessionManager.js', () => ({
  MemoryModeSessionManager: function MockMemoryModeManager() {
    return memoryModeMock;
  },
}));

const deleteAvatarsMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../../../utils/avatarPaths.js', () => ({
  deleteAllAvatarVersions: deleteAvatarsMock,
}));

const invalidateUserMock = vi.hoisted(() => vi.fn());
vi.mock('../../../services/AuthMiddleware.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../services/AuthMiddleware.js')>();
  return {
    ...actual,
    getOrCreateUserService: () => ({ invalidateUser: invalidateUserMock }),
  };
});

const broadcastInvalidateMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@tzurot/cache-invalidation', () => ({
  UserCacheInvalidationService: function MockUserCacheInvalidation() {
    return { invalidateUser: broadcastInvalidateMock };
  },
}));

import {
  handlePreviewAccountDelete,
  handleIssueAccountDeleteToken,
  handleDeleteAccount,
} from './delete.js';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { stubRouteResolvers } from '../../../test/shared-route-test-utils.js';
import type { RouteDeps } from '../../routeDeps.js';

const mockPrisma = {
  user: { findUnique: vi.fn().mockResolvedValue({ isSuperuser: false }) },
};

function makeDeps(overrides: Partial<RouteDeps> = {}): RouteDeps {
  return {
    ...stubRouteResolvers(),
    prisma: mockPrisma as unknown as PrismaClient,
    redis: {} as RouteDeps['redis'],
    cacheInvalidationService: {
      invalidatePersonality: vi.fn().mockResolvedValue(undefined),
    } as unknown as RouteDeps['cacheInvalidationService'],
    ...overrides,
  } as RouteDeps;
}

function createMockReqRes(body: Record<string, unknown> = {}) {
  const req = {
    body,
    query: {},
    userId: 'discord-user-123',
    provisionedUserId: 'user-uuid-123',
    provisionedDefaultPersonaId: 'persona-uuid-default',
  } as unknown as Request & { userId: string };

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  return { req, res };
}

const SUMMARY = {
  personas: 1,
  characters: 1,
  conversationMessages: 2,
  memories: 3,
  facts: 1,
  factsSweptByTag: 2,
  pendingMemories: 1,
  diagnosticLogs: 1,
  characterNames: ['XBot'],
  characterSlugs: ['xbot'],
  characterIds: ['x1'],
};

describe('Account Deletion Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user.findUnique.mockResolvedValue({ isSuperuser: false });
    tokenServiceMock.peekAccountDeleteToken.mockResolvedValue(true);
    tokenServiceMock.consumeAccountDeleteToken.mockResolvedValue(true);
    tokenServiceMock.issueAccountDeleteToken.mockResolvedValue('acctdel_test-token-value');
    deletionServiceMock.preview.mockResolvedValue({
      confirmationPhrase: 'DELETE MY ACCOUNT',
      ownedCharacters: [],
      counts: { personas: 1, characters: 0, conversationMessages: 0, memories: 0, facts: 0 },
      hasActiveExport: false,
    });
    deletionServiceMock.deleteAccount.mockResolvedValue(SUMMARY);
  });

  describe('GET /account/delete/preview', () => {
    it('403s superuser accounts before computing anything', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ isSuperuser: true });
      const { req, res } = createMockReqRes();
      await handlePreviewAccountDelete(makeDeps())(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(403);
      expect(deletionServiceMock.preview).not.toHaveBeenCalled();
    });

    it('returns the service preview for ordinary users', async () => {
      const { req, res } = createMockReqRes();
      await handlePreviewAccountDelete(makeDeps())(req, res, vi.fn());

      expect(deletionServiceMock.preview).toHaveBeenCalledWith('user-uuid-123');
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ confirmationPhrase: 'DELETE MY ACCOUNT' })
      );
    });
  });

  describe('POST /account/delete/token', () => {
    it('rejects a wrong phrase without minting a token', async () => {
      const { req, res } = createMockReqRes({ confirmationPhrase: 'delete my stuff' });
      await handleIssueAccountDeleteToken(makeDeps())(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(tokenServiceMock.issueAccountDeleteToken).not.toHaveBeenCalled();
    });

    it('accepts the phrase case-insensitively and mints for the DISCORD id', async () => {
      const { req, res } = createMockReqRes({ confirmationPhrase: '  delete my account ' });
      await handleIssueAccountDeleteToken(makeDeps())(req, res, vi.fn());

      expect(tokenServiceMock.issueAccountDeleteToken).toHaveBeenCalledWith('discord-user-123');
      expect(res.json).toHaveBeenCalledWith({ deleteToken: 'acctdel_test-token-value' });
    });

    it('403s superusers before the phrase check can mint', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ isSuperuser: true });
      const { req, res } = createMockReqRes({ confirmationPhrase: 'DELETE MY ACCOUNT' });
      await handleIssueAccountDeleteToken(makeDeps())(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(403);
      expect(tokenServiceMock.issueAccountDeleteToken).not.toHaveBeenCalled();
    });
  });

  describe('POST /account/delete', () => {
    const VALID_BODY = { deleteToken: 'acctdel_0123456789abcdef' };

    it('400s an unknown token at the peek without consuming', async () => {
      tokenServiceMock.peekAccountDeleteToken.mockResolvedValue(false);
      const { req, res } = createMockReqRes(VALID_BODY);
      await handleDeleteAccount(makeDeps())(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(tokenServiceMock.consumeAccountDeleteToken).not.toHaveBeenCalled();
      expect(deletionServiceMock.deleteAccount).not.toHaveBeenCalled();
    });

    it('403s superusers AFTER peek but before consuming (token not burned)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ isSuperuser: true });
      const { req, res } = createMockReqRes(VALID_BODY);
      await handleDeleteAccount(makeDeps())(req, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(403);
      expect(tokenServiceMock.consumeAccountDeleteToken).not.toHaveBeenCalled();
    });

    it('deletes, runs post-tx cleanup, and strips slugs/ids from the response', async () => {
      const deps = makeDeps();
      const { req, res } = createMockReqRes(VALID_BODY);
      await handleDeleteAccount(deps)(req, res, vi.fn());

      expect(deletionServiceMock.deleteAccount).toHaveBeenCalledWith(
        'user-uuid-123',
        'discord-user-123'
      );
      // Both memory modes (incognito + fresh) get their sessions swept
      expect(memoryModeMock.disableAll).toHaveBeenCalledTimes(2);
      expect(memoryModeMock.disableAll).toHaveBeenCalledWith('discord-user-123');
      expect(deps.cacheInvalidationService?.invalidatePersonality).toHaveBeenCalledWith('x1');
      expect(deleteAvatarsMock).toHaveBeenCalledWith('xbot', 'Account delete');
      // The provisioning cache must be evicted so the next request re-creates
      // the row instead of returning the dead userId (FK-violation guard):
      // (1) this process synchronously, (2) every other process via broadcast.
      expect(invalidateUserMock).toHaveBeenCalledWith('discord-user-123');
      expect(broadcastInvalidateMock).toHaveBeenCalledWith('discord-user-123');

      const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(payload.success).toBe(true);
      expect(payload.summary.characterNames).toEqual(['XBot']);
      expect(payload.summary.characterSlugs).toBeUndefined();
      expect(payload.summary.characterIds).toBeUndefined();
    });

    it('best-effort cleanup failures never fail the response', async () => {
      deleteAvatarsMock.mockRejectedValue(new Error('fs error'));
      const { req, res } = createMockReqRes(VALID_BODY);
      await handleDeleteAccount(makeDeps())(req, res, vi.fn());

      const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(payload.success).toBe(true);
    });

    it('still sweeps the second memory mode when the first sweep rejects', async () => {
      // A transient Redis failure on one mode must not skip the other — a
      // 'forever' session has no TTL, so a skipped sweep orphans its key.
      memoryModeMock.disableAll
        .mockRejectedValueOnce(new Error('redis blip'))
        .mockResolvedValueOnce(1);
      const { req, res } = createMockReqRes(VALID_BODY);
      await handleDeleteAccount(makeDeps())(req, res, vi.fn());

      expect(memoryModeMock.disableAll).toHaveBeenCalledTimes(2);
      const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(payload.success).toBe(true);
    });

    it('swallows a failed cache broadcast — deletion still returns success', async () => {
      // The cross-process broadcast fails (Redis publish error), but this
      // process was already evicted synchronously and the account is gone, so
      // the response must still succeed. Other processes stay stale until the
      // 1h TTL — bounded, self-healing.
      broadcastInvalidateMock.mockRejectedValueOnce(new Error('redis publish failed'));
      const { req, res } = createMockReqRes(VALID_BODY);
      await handleDeleteAccount(makeDeps())(req, res, vi.fn());

      // Local eviction still happened; only the broadcast failed.
      expect(invalidateUserMock).toHaveBeenCalledWith('discord-user-123');
      expect(broadcastInvalidateMock).toHaveBeenCalledWith('discord-user-123');
      // Failure is warn-logged, not surfaced.
      expect(loggerWarnMock).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringContaining('broadcast failed')
      );
      const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(payload.success).toBe(true);
    });
  });
});
