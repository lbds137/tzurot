/**
 * Tests for Shapes.inc List Route
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// Mock dependencies
vi.mock('@tzurot/common-types/utils/encryption', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/encryption')>(
    '@tzurot/common-types/utils/encryption'
  );
  return {
    ...actual,
    decryptApiKey: vi
      .fn()
      .mockReturnValue(
        '__Secure-better-auth.session_token=TEST-FIXTURE-not-a-real-session-token-abcdef'
      ),
  };
});

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return { ...actual, createLogger: () => mockLogger };
});

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: { NODE_ENV: 'test' as string, LOG_CONTENT_PREVIEWS: false },
}));
vi.mock('@tzurot/common-types/config/config', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/config/config')>(
    '@tzurot/common-types/config/config'
  );
  return { ...actual, getConfig: () => mockConfig };
});

// Uses the shared mock at `src/services/__mocks__/AuthMiddleware.ts`
// (auto-discovered by vitest). Passes `getOrCreateUserService` through to
// the real implementation and stubs `requireUserAuth` / `requireProvisionedUser`
// as passthrough middleware.
vi.mock('../../../services/AuthMiddleware.js');

vi.mock('../../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
}));

import { handleListShapes } from './list.js';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { stubRouteResolvers } from '../../../test/shared-route-test-utils.js';

const mockPrisma = {
  user: {
    // getOrCreateUserShell reads the user by discordId; default to an existing user.
    findUnique: vi.fn().mockResolvedValue({ id: 'user-uuid-123' }),
    findFirst: vi.fn(),
    create: vi.fn().mockResolvedValue({ id: 'user-uuid-123' }),
    update: vi.fn().mockResolvedValue({ id: 'user-uuid-123' }),
  },
  userCredential: {
    findFirst: vi.fn().mockResolvedValue(null),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  $executeRaw: vi.fn().mockResolvedValue(1),
};

function createMockReqRes() {
  const req = {
    body: {},
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

describe('Shapes List Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.NODE_ENV = 'test';
    mockConfig.LOG_CONTENT_PREVIEWS = false;
  });

  describe('GET /api/user/shapes/list (list shapes)', () => {
    async function callListHandler(
      prisma = mockPrisma
    ): Promise<{ req: Request & { userId: string }; res: Response }> {
      const { req, res } = createMockReqRes();
      const handler = handleListShapes({
        ...stubRouteResolvers(),
        prisma: prisma as unknown as PrismaClient,
      });
      await handler(req, res, vi.fn());
      return { req, res };
    }

    it('should return 401 when credential not found', async () => {
      mockPrisma.userCredential.findFirst.mockResolvedValue(null);
      const { res } = await callListHandler();

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('should decrypt cookie and fetch from shapes.inc', async () => {
      mockPrisma.userCredential.findFirst.mockResolvedValue({
        iv: 'iv',
        content: 'content',
        tag: 'tag',
      });

      // Mock global fetch
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        url: 'https://shapes.inc/api/shapes?category=self',
        json: vi
          .fn()
          .mockResolvedValue([{ id: 'shape-1', name: 'Test', username: 'test', avatar: '' }]),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { res } = await callListHandler();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('shapes.inc/api/shapes'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Cookie:
              '__Secure-better-auth.session_token=TEST-FIXTURE-not-a-real-session-token-abcdef',
          }),
        })
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          shapes: expect.arrayContaining([expect.objectContaining({ username: 'test' })]),
          total: 1,
        })
      );

      vi.unstubAllGlobals();
    });

    it('should log a gated body preview and the body length when the shapes.inc call fails and previews are disabled', async () => {
      mockConfig.NODE_ENV = 'test';
      mockConfig.LOG_CONTENT_PREVIEWS = false;
      mockPrisma.userCredential.findFirst.mockResolvedValue({
        iv: 'iv',
        content: 'content',
        tag: 'tag',
      });

      const failingBody = 'shapes.inc internal error';
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        redirected: false,
        status: 500,
        url: 'https://shapes.inc/api/shapes?category=self',
        text: vi.fn().mockResolvedValue(failingBody),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { res } = await callListHandler();

      expect(res.status).toHaveBeenCalledWith(503);
      const fields = mockLogger.warn.mock.calls[0][0] as {
        bodyPreview: unknown;
        bodyLength: unknown;
      };
      expect(fields.bodyPreview).toBeUndefined();
      expect(fields.bodyLength).toBe(failingBody.length);

      vi.unstubAllGlobals();
    });

    it('should log the actual body preview and the body length when the shapes.inc call fails and previews are enabled', async () => {
      mockConfig.NODE_ENV = 'development';
      mockConfig.LOG_CONTENT_PREVIEWS = true;
      mockPrisma.userCredential.findFirst.mockResolvedValue({
        iv: 'iv',
        content: 'content',
        tag: 'tag',
      });

      const failingBody = 'shapes.inc internal error';
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        redirected: false,
        status: 500,
        url: 'https://shapes.inc/api/shapes?category=self',
        text: vi.fn().mockResolvedValue(failingBody),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { res } = await callListHandler();

      expect(res.status).toHaveBeenCalledWith(503);
      const fields = mockLogger.warn.mock.calls[0][0] as {
        bodyPreview: unknown;
        bodyLength: unknown;
      };
      expect(fields.bodyPreview).toBe(failingBody);
      expect(fields.bodyLength).toBe(failingBody.length);

      vi.unstubAllGlobals();
    });
  });
});
