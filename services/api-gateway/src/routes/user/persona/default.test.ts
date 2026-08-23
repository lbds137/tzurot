/**
 * Tests for persona default route
 * - PATCH /:id/default - Set default persona
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  createMockPrisma,
  createMockReqRes,
  mockUser,
  MOCK_USER_ID,
  MOCK_PERSONA_ID,
  MOCK_PERSONA_ID_2,
  NONEXISTENT_UUID,
} from './test-utils.js';

// Mock dependencies before imports
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

// Uses the shared mock at `src/services/__mocks__/AuthMiddleware.ts`
// (auto-discovered by vitest). Passes `getOrCreateUserService` through to
// the real implementation and stubs `requireUserAuth` / `requireProvisionedUser`
// as passthrough middleware.
vi.mock('../../../services/AuthMiddleware.js');

vi.mock('../../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
}));

import { handleSetPersonaDefault } from './default.js';
import { getOrCreateUserService } from '../../../services/AuthMiddleware.js';
import {
  createProvisionedMockReqRes,
  stubRouteResolvers,
} from '../../../test/shared-route-test-utils.js';

describe('PATCH /api/user/persona/:id/default', () => {
  const mockPrisma = createMockPrisma();
  const prismaAsClient = mockPrisma as unknown as PrismaClient;

  /** The id `createProvisionedMockReqRes` stamps as `req.userId`. */
  const DISCORD_ID = 'discord-user-123';

  /**
   * A well-formed snowflake for the round-trip test. `UserService.getOrCreateUser`
   * refuses to provision a non-snowflake id, so the shared helper's default
   * `req.userId` cannot drive the real provisioning path.
   */
  const SNOWFLAKE_ID = '900000000000123456';

  /**
   * Stand-in for the broadcast half of the invalidation. `RouteDeps` types this
   * as the real `UserCacheInvalidationService`, so the cast keeps the seam
   * asserted without constructing a Redis-backed service.
   */
  function createUserCacheInvalidation(): { invalidateUser: ReturnType<typeof vi.fn> } {
    return { invalidateUser: vi.fn().mockResolvedValue(undefined) };
  }

  function buildDeps(
    userCacheInvalidation?: ReturnType<typeof createUserCacheInvalidation>
  ): Parameters<typeof handleSetPersonaDefault>[0] {
    return {
      ...stubRouteResolvers(),
      prisma: prismaAsClient,
      userCacheInvalidation: userCacheInvalidation as unknown as Parameters<
        typeof handleSetPersonaDefault
      >[0]['userCacheInvalidation'],
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user.findFirst.mockResolvedValue(mockUser);
    // The `getOrCreateUserService` registry is keyed by PrismaClient and lives
    // for the whole module, so its TTLCache would otherwise carry state between
    // tests in this file.
    getOrCreateUserService(prismaAsClient).clearCache();
  });

  it('should set persona as default', async () => {
    mockPrisma.persona.findFirst.mockResolvedValue({
      id: MOCK_PERSONA_ID_2,
      name: 'Second',
      preferredName: 'Tester',
    });
    mockPrisma.user.update.mockResolvedValue({});

    const handler = handleSetPersonaDefault(buildDeps());

    const { req, res } = createMockReqRes({}, { id: MOCK_PERSONA_ID_2 });
    await handler(req, res, vi.fn());

    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: MOCK_USER_ID },
        data: { defaultPersonaId: MOCK_PERSONA_ID_2 },
      })
    );
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      persona: {
        id: MOCK_PERSONA_ID_2,
        name: 'Second',
        preferredName: 'Tester',
      },
      alreadyDefault: false,
    });
  });

  it('should return 404 for non-existent persona', async () => {
    mockPrisma.persona.findFirst.mockResolvedValue(null);

    const handler = handleSetPersonaDefault(buildDeps());

    const { req, res } = createMockReqRes({}, { id: NONEXISTENT_UUID });
    await handler(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
  });

  describe('provisioning-cache invalidation', () => {
    it('evicts the local provisioning cache with the DISCORD id after a write', async () => {
      mockPrisma.persona.findFirst.mockResolvedValue({
        id: MOCK_PERSONA_ID_2,
        name: 'Second',
        preferredName: 'Tester',
      });
      mockPrisma.user.update.mockResolvedValue({});
      const invalidateSpy = vi.spyOn(getOrCreateUserService(prismaAsClient), 'invalidateUser');

      const handler = handleSetPersonaDefault(buildDeps());
      const { req, res } = createMockReqRes({}, { id: MOCK_PERSONA_ID_2 });
      await handler(req, res, vi.fn());

      // The provisioning cache is keyed by Discord snowflake; passing the
      // internal UUID would evict nothing and read as a silent no-op.
      expect(invalidateSpy).toHaveBeenCalledWith(DISCORD_ID);
      expect(invalidateSpy).not.toHaveBeenCalledWith(MOCK_USER_ID);
    });

    it('broadcasts the invalidation with the DISCORD id after a write', async () => {
      mockPrisma.persona.findFirst.mockResolvedValue({
        id: MOCK_PERSONA_ID_2,
        name: 'Second',
        preferredName: 'Tester',
      });
      mockPrisma.user.update.mockResolvedValue({});
      const userCacheInvalidation = createUserCacheInvalidation();

      const handler = handleSetPersonaDefault(buildDeps(userCacheInvalidation));
      const { req, res } = createMockReqRes({}, { id: MOCK_PERSONA_ID_2 });
      await handler(req, res, vi.fn());

      expect(userCacheInvalidation.invalidateUser).toHaveBeenCalledWith(DISCORD_ID);
    });

    it('still succeeds when the broadcast rejects (local eviction already happened)', async () => {
      mockPrisma.persona.findFirst.mockResolvedValue({
        id: MOCK_PERSONA_ID_2,
        name: 'Second',
        preferredName: 'Tester',
      });
      mockPrisma.user.update.mockResolvedValue({});
      const userCacheInvalidation = createUserCacheInvalidation();
      userCacheInvalidation.invalidateUser.mockRejectedValue(new Error('redis down'));
      const invalidateSpy = vi.spyOn(getOrCreateUserService(prismaAsClient), 'invalidateUser');

      const handler = handleSetPersonaDefault(buildDeps(userCacheInvalidation));
      const { req, res } = createMockReqRes({}, { id: MOCK_PERSONA_ID_2 });
      await handler(req, res, vi.fn());

      expect(invalidateSpy).toHaveBeenCalledWith(DISCORD_ID);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('invalidates nothing and writes nothing when the persona is already default', async () => {
      mockPrisma.persona.findFirst.mockResolvedValue({
        id: MOCK_PERSONA_ID,
        name: 'Test Persona',
        preferredName: 'Tester',
      });
      const userCacheInvalidation = createUserCacheInvalidation();
      const invalidateSpy = vi.spyOn(getOrCreateUserService(prismaAsClient), 'invalidateUser');

      const handler = handleSetPersonaDefault(buildDeps(userCacheInvalidation));
      // MOCK_PERSONA_ID is the stamped default (see createMockReqRes).
      const { req, res } = createMockReqRes({}, { id: MOCK_PERSONA_ID });
      await handler(req, res, vi.fn());

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(invalidateSpy).not.toHaveBeenCalled();
      expect(userCacheInvalidation.invalidateUser).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ alreadyDefault: true }));
    });

    it('round-trips A -> B -> A with the stamp produced by the real provisioning cache', async () => {
      // The regression this route's fix exists for. Each request's
      // `provisionedDefaultPersonaId` is produced the way
      // `requireProvisionedUser` produces it — by calling the shared
      // UserService — rather than hand-fed, so a missing eviction leaves the
      // second request reading the pre-update value and skipping its write.
      const userService = getOrCreateUserService(prismaAsClient);
      const dbUser = {
        id: MOCK_USER_ID,
        isSuperuser: false,
        username: 'testuser',
        defaultPersonaId: MOCK_PERSONA_ID,
      };
      mockPrisma.user.findUnique.mockImplementation(() => Promise.resolve({ ...dbUser }));
      mockPrisma.user.update.mockImplementation((args: { data: { defaultPersonaId: string } }) => {
        dbUser.defaultPersonaId = args.data.defaultPersonaId;
        return Promise.resolve({});
      });
      mockPrisma.persona.findFirst.mockImplementation((args: { where: { id: string } }) =>
        Promise.resolve({ id: args.where.id, name: 'P', preferredName: 'P' })
      );

      const userCacheInvalidation = createUserCacheInvalidation();
      const handler = handleSetPersonaDefault(buildDeps(userCacheInvalidation));

      /** One request through the middleware's own provisioning read, then the route. */
      async function setDefault(targetPersonaId: string): Promise<void> {
        const provisioned = await userService.getOrCreateUser(SNOWFLAKE_ID, 'testuser');
        const { req, res } = createProvisionedMockReqRes(
          {},
          { id: targetPersonaId },
          {},
          {
            provisionedUserId: provisioned?.userId,
            provisionedDefaultPersonaId: provisioned?.defaultPersonaId,
          }
        );
        req.userId = SNOWFLAKE_ID;
        await handler(req, res, vi.fn());
      }

      // A is the starting default; switch to B.
      await setDefault(MOCK_PERSONA_ID_2);
      expect(dbUser.defaultPersonaId).toBe(MOCK_PERSONA_ID_2);

      // Switch back to A — the request the stale stamp used to gate away.
      await setDefault(MOCK_PERSONA_ID);
      expect(mockPrisma.user.update).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: { defaultPersonaId: MOCK_PERSONA_ID } })
      );
      expect(dbUser.defaultPersonaId).toBe(MOCK_PERSONA_ID);

      // Setting A again is genuinely already-default, so it must not write.
      const writesBefore = mockPrisma.user.update.mock.calls.length;
      await setDefault(MOCK_PERSONA_ID);
      expect(mockPrisma.user.update.mock.calls.length).toBe(writesBefore);
    });
  });
});
