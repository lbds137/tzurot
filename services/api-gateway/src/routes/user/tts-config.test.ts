/**
 * Tests for /user/tts-config routes.
 *
 * Focused on route-layer behavior: error translation (404/403/400),
 * permission gating, and the contract between TtsConfigService errors and
 * HTTP responses. Service-layer behavior is tested in
 * TtsConfigService.test.ts.
 *
 * Strategy: mock the TtsConfigService module at the boundary so the route
 * factory's `new TtsConfigService(...)` returns our test double. This
 * sidesteps Express+supertest setup while preserving full route coverage.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, Router } from 'express';
import { StatusCodes } from 'http-status-codes';

const sampleRawConfig = {
  id: 'cfg-uuid-1',
  name: 'My Voice',
  description: null,
  provider: 'elevenlabs' as const,
  modelId: 'eleven_multilingual_v2',
  isGlobal: false,
  isDefault: false,
  isFreeDefault: false,
  ownerId: 'user-uuid-1',
  advancedParameters: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

// Hoisted service mock — shared across all tests, reset in beforeEach
const { mockService, MockTtsConfigService } = vi.hoisted(() => {
  const mockService = {
    list: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    setAsDefault: vi.fn(),
    setAsFreeDefault: vi.fn(),
    checkNameExists: vi.fn().mockResolvedValue({ exists: false }),
    checkDeleteConstraints: vi.fn().mockResolvedValue({ blocker: null, warning: null }),
    formatConfigDetail: vi.fn(),
  };

  // Constructor that returns our mock — what the route factory will see
  function MockTtsConfigService() {
    return mockService;
  }

  return { mockService, MockTtsConfigService };
});

// Mock the service module — keep the typed errors as actual classes so
// `instanceof` checks in the route still work
vi.mock('../../services/TtsConfigService.js', async () => {
  const errors = await vi.importActual<typeof import('../../services/TtsConfigErrors.js')>(
    '../../services/TtsConfigErrors.js'
  );
  return {
    TtsConfigService: MockTtsConfigService,
    TtsAutoSuffixCollisionError: errors.TtsAutoSuffixCollisionError,
    TtsCloneNameExhaustedError: errors.TtsCloneNameExhaustedError,
    TtsInvalidProviderError: errors.TtsInvalidProviderError,
  };
});

vi.mock('../../services/AuthMiddleware.js', () => ({
  requireUserAuth: () => (_req: Request, _res: Response, next: () => void) => next(),
  requireProvisionedUser: () => (_req: Request, _res: Response, next: () => void) => next(),
}));

vi.mock('../../utils/asyncHandler.js', () => ({
  asyncHandler: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}));

vi.mock('../../utils/resolveProvisionedUserId.js', () => ({
  resolveProvisionedUserId: vi.fn(() => 'user-uuid-1'),
}));

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

vi.mock('@tzurot/common-types/utils/ownerMiddleware', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/ownerMiddleware')>(
    '@tzurot/common-types/utils/ownerMiddleware'
  );
  return {
    ...actual,
    isBotOwner: vi.fn(() => false),
  };
});

// Imports must come after vi.mock setup
const { createTtsConfigRoutes } = await import('./tts-config.js');
const { TtsAutoSuffixCollisionError, TtsCloneNameExhaustedError, TtsInvalidProviderError } =
  await import('../../services/TtsConfigService.js');
const { isBotOwner } = await import('@tzurot/common-types/utils/ownerMiddleware');

function makeMockRes() {
  const json = vi.fn();
  const status = vi.fn().mockReturnThis();
  return {
    res: { status, json } as unknown as Response,
    json,
    status,
  };
}

function makeMockReq(overrides: Record<string, unknown> = {}): Request {
  return {
    userId: '111111111111111111',
    params: {},
    body: {},
    ...overrides,
  } as unknown as Request;
}

interface RouterLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: (req: Request, res: Response) => Promise<void> }>;
  };
}

function extractHandler(router: Router, method: string, path: string) {
  const stack = (router as unknown as { stack: RouterLayer[] }).stack;
  const layer = stack.find(
    l => l.route?.path === path && l.route?.methods[method.toLowerCase()] === true
  );
  if (!layer?.route) {
    throw new Error(`Handler for ${method} ${path} not found`);
  }
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function buildRouter() {
  // The factory's prisma argument doesn't matter — our mocked service
  // doesn't use it. Pass a thin stub.
  return createTtsConfigRoutes({} as never);
}

describe('user/tts-config routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-establish default formatConfigDetail behavior after clearAllMocks
    vi.mocked(mockService.formatConfigDetail).mockImplementation((c: typeof sampleRawConfig) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      provider: c.provider,
      modelId: c.modelId,
      isGlobal: c.isGlobal,
      isDefault: c.isDefault,
      isFreeDefault: c.isFreeDefault,
      params: {},
    }));
    vi.mocked(mockService.checkNameExists).mockResolvedValue({ exists: false });
    vi.mocked(mockService.checkDeleteConstraints).mockResolvedValue({
      blocker: null,
      warning: null,
    });
  });

  describe('GET / (list)', () => {
    it('returns USER-scoped configs with permissions for non-admin', async () => {
      vi.mocked(mockService.list).mockResolvedValue([{ ...sampleRawConfig }]);
      const handler = extractHandler(buildRouter(), 'GET', '/');
      const { res, json, status } = makeMockRes();

      await handler(makeMockReq(), res);

      expect(mockService.list).toHaveBeenCalledWith(expect.objectContaining({ type: 'USER' }));
      expect(status).toHaveBeenCalledWith(StatusCodes.OK);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          configs: expect.arrayContaining([
            expect.objectContaining({ id: 'cfg-uuid-1', isOwned: true }),
          ]),
        })
      );
    });

    it('uses GLOBAL scope for bot-owner admin', async () => {
      vi.mocked(isBotOwner).mockReturnValueOnce(true);
      vi.mocked(mockService.list).mockResolvedValue([]);
      const handler = extractHandler(buildRouter(), 'GET', '/');
      const { res } = makeMockRes();

      await handler(makeMockReq(), res);
      expect(mockService.list).toHaveBeenCalledWith({ type: 'GLOBAL' });
    });
  });

  describe('GET /:id (get)', () => {
    it('returns 404 when config does not exist', async () => {
      vi.mocked(mockService.getById).mockResolvedValue(null);
      const handler = extractHandler(buildRouter(), 'GET', '/:id');
      const { res, json } = makeMockRes();

      await handler(makeMockReq({ params: { id: 'missing' } }), res);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'NOT_FOUND' }));
    });

    it('returns the formatted config with permissions when found', async () => {
      vi.mocked(mockService.getById).mockResolvedValue(sampleRawConfig);
      const handler = extractHandler(buildRouter(), 'GET', '/:id');
      const { res, json } = makeMockRes();

      await handler(makeMockReq({ params: { id: 'cfg-uuid-1' } }), res);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({ id: 'cfg-uuid-1', isOwned: true }),
        })
      );
    });
  });

  describe('POST / (create)', () => {
    it('returns 400 NAME_COLLISION when name already exists', async () => {
      vi.mocked(mockService.checkNameExists).mockResolvedValue({
        exists: true,
        conflictId: 'cfg-existing',
      });
      const handler = extractHandler(buildRouter(), 'POST', '/');
      const { res, json } = makeMockRes();

      await handler(makeMockReq({ body: { name: 'My Voice', provider: 'elevenlabs' } }), res);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'NAME_COLLISION' }));
      expect(mockService.create).not.toHaveBeenCalled();
    });

    it('returns 400 with bumped name when TtsAutoSuffixCollisionError fires', async () => {
      vi.mocked(mockService.create).mockRejectedValue(
        new TtsAutoSuffixCollisionError('Voice (Copy 5)', new Error())
      );
      const handler = extractHandler(buildRouter(), 'POST', '/');
      const { res, json } = makeMockRes();

      await handler(
        makeMockReq({
          body: { name: 'Voice', provider: 'elevenlabs', autoSuffixOnCollision: true },
        }),
        res
      );
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'NAME_COLLISION',
          message: expect.stringContaining('Voice (Copy 5)'),
        })
      );
    });

    it('returns 400 with stripped baseName when TtsCloneNameExhaustedError fires', async () => {
      vi.mocked(mockService.create).mockRejectedValue(new TtsCloneNameExhaustedError('Voice', 20));
      const handler = extractHandler(buildRouter(), 'POST', '/');
      const { res, json } = makeMockRes();

      await handler(
        makeMockReq({
          body: { name: 'Voice', provider: 'elevenlabs', autoSuffixOnCollision: true },
        }),
        res
      );
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'NAME_COLLISION',
          message: expect.stringContaining('Too many copies'),
        })
      );
    });

    it('returns 201 with the created config on happy path', async () => {
      vi.mocked(mockService.create).mockResolvedValue(sampleRawConfig);
      const handler = extractHandler(buildRouter(), 'POST', '/');
      const { res, status } = makeMockRes();

      await handler(makeMockReq({ body: { name: 'My Voice', provider: 'elevenlabs' } }), res);
      expect(status).toHaveBeenCalledWith(StatusCodes.CREATED);
    });

    it('rejects body without provider via Zod schema (never reaches service)', async () => {
      const handler = extractHandler(buildRouter(), 'POST', '/');
      const { res, json } = makeMockRes();

      await handler(
        makeMockReq({ body: { name: 'X' } }), // missing provider
        res
      );
      expect(mockService.create).not.toHaveBeenCalled();
      expect(json).toHaveBeenCalled();
    });

    it('rejects invalid provider via Zod schema on create path', async () => {
      const handler = extractHandler(buildRouter(), 'POST', '/');
      const { res } = makeMockRes();

      await handler(makeMockReq({ body: { name: 'X', provider: 'mistal' } }), res);
      // Schema enforces TtsProviderIdSchema on create — never reaches service
      expect(mockService.create).not.toHaveBeenCalled();
    });
  });

  describe('PUT /:id (update)', () => {
    it('returns 404 when config does not exist', async () => {
      vi.mocked(mockService.getById).mockResolvedValue(null);
      const handler = extractHandler(buildRouter(), 'PUT', '/:id');
      const { res, json } = makeMockRes();

      await handler(makeMockReq({ params: { id: 'missing' }, body: { description: 'new' } }), res);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'NOT_FOUND' }));
    });

    it('returns 401 when user is not the owner', async () => {
      vi.mocked(mockService.getById).mockResolvedValue({
        ...sampleRawConfig,
        ownerId: 'someone-else',
      });
      const handler = extractHandler(buildRouter(), 'PUT', '/:id');
      const { res, json } = makeMockRes();

      await handler(
        makeMockReq({ params: { id: 'cfg-uuid-1' }, body: { description: 'new' } }),
        res
      );
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'UNAUTHORIZED' }));
    });

    // Bot-owner short-circuit is exercised at the helper level in
    // `normalizeConfigNameOnPromote.test.ts`. Mocking `isBotOwner` at the
    // route level doesn't work because `slugUtils.ts` calls a relative-path
    // `isBotOwner`, not the public package export — so the route test
    // focuses on the non-owner path and trusts the helper unit tests for
    // the bot-owner path.
    it('suffixes the name with username when non-owner promotes to global', async () => {
      vi.mocked(mockService.getById).mockResolvedValue({
        ...sampleRawConfig,
        name: 'AdminVoice',
        isGlobal: false,
      });
      vi.mocked(mockService.checkNameExists).mockResolvedValue({ exists: false });
      vi.mocked(mockService.update).mockResolvedValue({
        ...sampleRawConfig,
        name: 'AdminVoice-bob',
        isGlobal: true,
      });
      vi.mocked(mockService.formatConfigDetail).mockReturnValue({
        id: 'cfg-uuid-1',
        name: 'AdminVoice-bob',
        description: null,
        provider: 'elevenlabs',
        modelId: null,
        isGlobal: true,
        isDefault: false,
        isFreeDefault: false,
        ownerId: 'user-uuid-1',
        advancedParameters: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      });
      const handler = extractHandler(buildRouter(), 'PUT', '/:id');
      const { res } = makeMockRes();

      await handler(
        makeMockReq({
          params: { id: 'cfg-uuid-1' },
          body: { isGlobal: true },
          headers: { 'x-user-username': 'bob' },
        }),
        res
      );

      // The update call should have name: 'AdminVoice-bob' even though body had no name
      expect(mockService.update).toHaveBeenCalledWith(
        'cfg-uuid-1',
        expect.objectContaining({ name: 'AdminVoice-bob', isGlobal: true })
      );
    });

    it('returns 400 VALIDATION_ERROR when service rejects invalid provider', async () => {
      vi.mocked(mockService.getById).mockResolvedValue(sampleRawConfig);
      vi.mocked(mockService.update).mockRejectedValue(new TtsInvalidProviderError('mistal'));
      const handler = extractHandler(buildRouter(), 'PUT', '/:id');
      const { res, json } = makeMockRes();

      await handler(
        makeMockReq({ params: { id: 'cfg-uuid-1' }, body: { provider: 'mistal' } }),
        res
      );
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
          message: expect.stringContaining('mistal'),
        })
      );
    });

    it('returns 400 when no fields are provided', async () => {
      vi.mocked(mockService.getById).mockResolvedValue(sampleRawConfig);
      const handler = extractHandler(buildRouter(), 'PUT', '/:id');
      const { res, json } = makeMockRes();

      await handler(makeMockReq({ params: { id: 'cfg-uuid-1' }, body: {} }), res);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
          message: expect.stringContaining('No fields'),
        })
      );
      expect(mockService.update).not.toHaveBeenCalled();
    });

    it('returns 200 with the updated config on happy path', async () => {
      vi.mocked(mockService.getById).mockResolvedValue(sampleRawConfig);
      vi.mocked(mockService.update).mockResolvedValue({
        ...sampleRawConfig,
        modelId: 'voxtral-mini-tts-2603',
      });
      const handler = extractHandler(buildRouter(), 'PUT', '/:id');
      const { res, status } = makeMockRes();

      await handler(
        makeMockReq({
          params: { id: 'cfg-uuid-1' },
          body: { modelId: 'voxtral-mini-tts-2603' },
        }),
        res
      );
      expect(status).toHaveBeenCalledWith(StatusCodes.OK);
    });
  });

  describe('DELETE /:id', () => {
    it('returns 404 when config does not exist', async () => {
      vi.mocked(mockService.getById).mockResolvedValue(null);
      const handler = extractHandler(buildRouter(), 'DELETE', '/:id');
      const { res, json } = makeMockRes();

      await handler(makeMockReq({ params: { id: 'missing' } }), res);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'NOT_FOUND' }));
    });

    it('returns 401 when user lacks delete permission', async () => {
      vi.mocked(mockService.getById).mockResolvedValue({
        ...sampleRawConfig,
        ownerId: 'someone-else',
      });
      const handler = extractHandler(buildRouter(), 'DELETE', '/:id');
      const { res, json } = makeMockRes();

      await handler(makeMockReq({ params: { id: 'cfg-uuid-1' } }), res);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'UNAUTHORIZED' }));
      expect(mockService.delete).not.toHaveBeenCalled();
    });

    it('returns 400 when delete constraints block', async () => {
      vi.mocked(mockService.getById).mockResolvedValue(sampleRawConfig);
      vi.mocked(mockService.checkDeleteConstraints).mockResolvedValue({
        blocker: 'Cannot delete: TTS config is used as default by 2 personality(ies)',
        warning: null,
      });
      const handler = extractHandler(buildRouter(), 'DELETE', '/:id');
      const { res, json } = makeMockRes();

      await handler(makeMockReq({ params: { id: 'cfg-uuid-1' } }), res);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'VALIDATION_ERROR' }));
      expect(mockService.delete).not.toHaveBeenCalled();
    });

    it('returns 200 with deleted: true on happy path', async () => {
      vi.mocked(mockService.getById).mockResolvedValue(sampleRawConfig);
      const handler = extractHandler(buildRouter(), 'DELETE', '/:id');
      const { res, json } = makeMockRes();

      await handler(makeMockReq({ params: { id: 'cfg-uuid-1' } }), res);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ deleted: true }));
    });

    it('drops warning from response even when service returns one', async () => {
      // User route deliberately ignores `warning` because it would leak how
      // many OTHER users have this config as their default — info only the
      // owner-admin should see. Pin this with a test so the decision is
      // machine-checkable rather than comment-only.
      vi.mocked(mockService.getById).mockResolvedValue(sampleRawConfig);
      vi.mocked(mockService.checkDeleteConstraints).mockResolvedValue({
        blocker: null,
        warning: "Deleting this TTS config will reset 5 user(s)' personal default to NULL",
      });
      const handler = extractHandler(buildRouter(), 'DELETE', '/:id');
      const { res, json } = makeMockRes();

      await handler(makeMockReq({ params: { id: 'cfg-uuid-1' } }), res);
      expect(mockService.delete).toHaveBeenCalledWith('cfg-uuid-1');
      const callArgs = vi.mocked(json).mock.calls[0]?.[0] as Record<string, unknown> | undefined;
      expect(callArgs?.warning).toBeUndefined();
    });
  });
});
