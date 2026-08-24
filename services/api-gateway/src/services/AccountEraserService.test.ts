import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { Redis } from 'ioredis';
import { AccountEraserService } from './AccountEraserService.js';
import type { AccountDeletionSummary } from './AccountDeletionService.js';

const {
  mockDeleteAccount,
  mockProvisioningInvalidate,
  mockDisableAll,
  mockUserCacheInvalidate,
  mockDeleteAvatars,
} = vi.hoisted(() => ({
  mockDeleteAccount: vi.fn(),
  mockProvisioningInvalidate: vi.fn(),
  mockDisableAll: vi.fn().mockResolvedValue(undefined),
  mockUserCacheInvalidate: vi.fn().mockResolvedValue(undefined),
  mockDeleteAvatars: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});
// Plain functions (not arrow mockImplementations) so `new X()` works — arrows
// have no [[Construct]]. Mirrors delete.test.ts's class-mock pattern.
vi.mock('./AccountDeletionService.js', () => ({
  AccountDeletionService: function MockDeletionService() {
    return { deleteAccount: mockDeleteAccount };
  },
}));
vi.mock('./AuthMiddleware.js', () => ({
  getOrCreateUserService: vi.fn(() => ({ invalidateUser: mockProvisioningInvalidate })),
}));
vi.mock('./MemoryModeSessionManager.js', () => ({
  MemoryModeSessionManager: function MockMemoryModeManager() {
    return { disableAll: mockDisableAll };
  },
}));
vi.mock('../utils/avatarPaths.js', () => ({ deleteAllAvatarVersions: mockDeleteAvatars }));

function makeSummary(overrides: Partial<AccountDeletionSummary> = {}): AccountDeletionSummary {
  return {
    personas: 1,
    characters: 2,
    conversationMessages: 0,
    memories: 0,
    facts: 0,
    factsSweptByTag: 0,
    pendingMemories: 0,
    diagnosticLogs: 0,
    commandEvents: 0,
    charactersReHomed: 0,
    characterNames: ['XBot', 'YBot'],
    characterSlugs: ['xbot', 'ybot'],
    characterIds: ['x1', 'x2'],
    auditLogId: null,
    ...overrides,
  };
}

function makeDeps({
  withRedis = true,
  withUserCacheInvalidation = true,
}: { withRedis?: boolean; withUserCacheInvalidation?: boolean } = {}) {
  const invalidatePersonality = vi.fn().mockResolvedValue(undefined);
  const deps = {
    prisma: {} as PrismaClient,
    redis: withRedis ? ({} as Redis) : undefined,
    cacheInvalidationService: { invalidatePersonality } as never,
    userCacheInvalidation: withUserCacheInvalidation
      ? ({ invalidateUser: mockUserCacheInvalidate } as never)
      : undefined,
  };
  return { deps, invalidatePersonality };
}

describe('AccountEraserService.erase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDisableAll.mockResolvedValue(undefined);
    mockUserCacheInvalidate.mockResolvedValue(undefined);
    mockDeleteAvatars.mockResolvedValue(undefined);
  });

  it('runs the DB erase in the given mode, then off-DB cleanup over the deleted set', async () => {
    const summary = makeSummary();
    mockDeleteAccount.mockResolvedValue(summary);
    const { deps, invalidatePersonality } = makeDeps();

    const result = await new AccountEraserService(deps).erase({
      userId: 'u1',
      discordUserId: 'd1',
      mode: 'retention',
    });

    // The mode + ids cross the seam into the DB half.
    expect(mockDeleteAccount).toHaveBeenCalledWith('u1', 'd1', 'retention', null);
    // Provisioning-cache eviction (this process) + cross-process broadcast, both keyed on discordId.
    expect(mockProvisioningInvalidate).toHaveBeenCalledWith('d1');
    expect(mockUserCacheInvalidate).toHaveBeenCalledWith('d1');
    // Per-character cache invalidation + avatar unlink over the DELETED characters only.
    expect(invalidatePersonality).toHaveBeenCalledWith('x1');
    expect(invalidatePersonality).toHaveBeenCalledWith('x2');
    expect(mockDeleteAvatars).toHaveBeenCalledWith('xbot', expect.any(String));
    expect(mockDeleteAvatars).toHaveBeenCalledWith('ybot', expect.any(String));
    expect(result).toBe(summary);
  });

  it('passes self-serve mode straight through', async () => {
    mockDeleteAccount.mockResolvedValue(makeSummary({ characterIds: [], characterSlugs: [] }));
    const { deps } = makeDeps();

    await new AccountEraserService(deps).erase({
      userId: 'u1',
      discordUserId: 'd1',
      mode: 'self-serve',
    });

    expect(mockDeleteAccount).toHaveBeenCalledWith('u1', 'd1', 'self-serve', null);
  });

  it('still succeeds when the cross-process broadcast throws (best-effort swallow)', async () => {
    mockDeleteAccount.mockResolvedValue(makeSummary());
    mockUserCacheInvalidate.mockRejectedValue(new Error('redis down'));
    const { deps } = makeDeps();

    await expect(
      new AccountEraserService(deps).erase({
        userId: 'u1',
        discordUserId: 'd1',
        mode: 'self-serve',
      })
    ).resolves.toBeDefined();
    // Synchronous in-process eviction still happened despite the broadcast failing.
    expect(mockProvisioningInvalidate).toHaveBeenCalledWith('d1');
  });

  it('skips the redis-backed memory-mode sweep when no redis is configured', async () => {
    mockDeleteAccount.mockResolvedValue(makeSummary());
    const { deps, invalidatePersonality } = makeDeps({ withRedis: false });

    await new AccountEraserService(deps).erase({
      userId: 'u1',
      discordUserId: 'd1',
      mode: 'self-serve',
    });

    // No redis → no memory-mode sweep (the ONLY step gated on `redis` now that
    // the user-cache broadcast is gated on the injected `userCacheInvalidation`
    // singleton instead).
    expect(mockDisableAll).not.toHaveBeenCalled();
    // … but the non-redis cleanup (provisioning evict, broadcast, per-char
    // cache, avatars) still runs.
    expect(mockProvisioningInvalidate).toHaveBeenCalledWith('d1');
    expect(mockUserCacheInvalidate).toHaveBeenCalledWith('d1');
    expect(invalidatePersonality).toHaveBeenCalledWith('x1');
    expect(mockDeleteAvatars).toHaveBeenCalledWith('xbot', expect.any(String));
  });

  it('skips the broadcast when no userCacheInvalidation is injected', async () => {
    mockDeleteAccount.mockResolvedValue(makeSummary());
    const { deps } = makeDeps({ withUserCacheInvalidation: false });

    await expect(
      new AccountEraserService(deps).erase({
        userId: 'u1',
        discordUserId: 'd1',
        mode: 'self-serve',
      })
    ).resolves.toBeDefined();

    expect(mockUserCacheInvalidate).not.toHaveBeenCalled();
    // Synchronous in-process eviction is unaffected by the broadcast dep.
    expect(mockProvisioningInvalidate).toHaveBeenCalledWith('d1');
  });
});
