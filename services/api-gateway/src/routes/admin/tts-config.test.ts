/**
 * Tests for /admin/tts-config routes.
 *
 * Same vi.mock-based handler-extraction strategy as the user route tests.
 * Covers admin-only paths (set-default, set-free-default) and the
 * provider-based free-default constraint that's specific to TTS.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import { getAllRoutes } from '../../test/expressRouterUtils.js';

const sampleRawConfig = {
  id: 'cfg-uuid-1',
  name: 'My Voice',
  description: null,
  provider: 'elevenlabs' as const,
  modelId: 'eleven_multilingual_v2',
  isGlobal: true,
  isDefault: false,
  isFreeDefault: false,
  ownerId: 'admin-uuid-1',
  advancedParameters: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

const { mockService, MockTtsConfigService } = vi.hoisted(() => {
  const mockService = {
    list: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    setAsDefault: vi.fn().mockResolvedValue(undefined),
    setAsFreeDefault: vi.fn().mockResolvedValue(undefined),
    checkNameExists: vi.fn().mockResolvedValue({ exists: false }),
    checkDeleteConstraints: vi.fn().mockResolvedValue({ blocker: null, warning: null }),
    formatConfigDetail: vi.fn(),
  };
  function MockTtsConfigService() {
    return mockService;
  }
  return { mockService, MockTtsConfigService };
});

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

vi.mock('../../utils/asyncHandler.js', () => ({
  asyncHandler: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
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

const { createAdminTtsConfigRoutes } = await import('./tts-config.js');
const { TtsInvalidProviderError } = await import('../../services/TtsConfigService.js');

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
    userId: 'admin-discord-id',
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

const mockPrisma = {
  ttsConfig: {
    findUnique: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
    count: vi.fn().mockResolvedValue(0),
  },
  // The delete guard checks pointer membership on the AdminSettings
  // singleton; null = nothing is pointed at, so deletes proceed.
  adminSettings: {
    findUnique: vi.fn().mockResolvedValue(null),
  },
};

function buildRouter() {
  return createAdminTtsConfigRoutes({ prisma: mockPrisma as never });
}

describe('admin/tts-config routes', () => {
  describe('middleware composition', () => {
    it('wires requireOwnerAuth on every route', () => {
      // Handler-extraction tests pick the last handler, which bypasses
      // middleware. Inspect the router stack directly so a regression that
      // removed requireOwnerAuth() from any route would fail this check.
      const routes = getAllRoutes(buildRouter());
      expect(routes.length, 'expected at least one registered route').toBeGreaterThan(0);
      for (const route of routes) {
        expect(route.stackLength, `${route.path} missing auth middleware`).toBeGreaterThanOrEqual(
          2
        );
      }
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
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
    it('returns all GLOBAL configs in the formatted shape', async () => {
      vi.mocked(mockService.list).mockResolvedValue([sampleRawConfig]);
      const handler = extractHandler(buildRouter(), 'GET', '/');
      const { res, json, status } = makeMockRes();

      await handler(makeMockReq(), res);
      expect(mockService.list).toHaveBeenCalledWith({ type: 'GLOBAL' });
      expect(status).toHaveBeenCalledWith(StatusCodes.OK);
      // List rows now go through formatConfigDetail (with synthesized
      // advancedParameters: null) so the response shape matches GET /:id.
      // The mocked formatConfigDetail returns the formatted shape with
      // `params: {}` for null advancedParameters.
      expect(mockService.formatConfigDetail).toHaveBeenCalledWith(
        expect.objectContaining({ id: sampleRawConfig.id, advancedParameters: null })
      );
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          configs: expect.arrayContaining([
            expect.objectContaining({ id: sampleRawConfig.id, params: {} }),
          ]),
        })
      );
    });
  });

  describe('GET /:id (get)', () => {
    it('returns 404 when config not found', async () => {
      vi.mocked(mockService.getById).mockResolvedValue(null);
      const handler = extractHandler(buildRouter(), 'GET', '/:id');
      const { res, json } = makeMockRes();

      await handler(makeMockReq({ params: { id: 'missing' } }), res);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'NOT_FOUND' }));
    });

    it('returns formatted config when found', async () => {
      vi.mocked(mockService.getById).mockResolvedValue(sampleRawConfig);
      const handler = extractHandler(buildRouter(), 'GET', '/:id');
      const { res, json } = makeMockRes();

      await handler(makeMockReq({ params: { id: 'cfg-uuid-1' } }), res);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({ id: 'cfg-uuid-1' }),
        })
      );
    });
  });

  describe('POST / (create)', () => {
    it('returns 401 when admin user is not in DB', async () => {
      vi.mocked(mockPrisma.user.findUnique).mockResolvedValue(null);
      const handler = extractHandler(buildRouter(), 'POST', '/');
      const { res, json } = makeMockRes();

      await handler(makeMockReq({ body: { name: 'Sys', provider: 'self-hosted' } }), res);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'UNAUTHORIZED' }));
    });

    it('returns 400 NAME_COLLISION on duplicate global name', async () => {
      vi.mocked(mockPrisma.user.findUnique).mockResolvedValue({ id: 'admin-uuid-1' });
      vi.mocked(mockService.checkNameExists).mockResolvedValue({
        exists: true,
        conflictId: 'cfg-existing',
      });
      const handler = extractHandler(buildRouter(), 'POST', '/');
      const { res, json } = makeMockRes();

      await handler(makeMockReq({ body: { name: 'Existing', provider: 'self-hosted' } }), res);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'NAME_COLLISION' }));
      expect(mockService.create).not.toHaveBeenCalled();
    });

    it('returns 201 on happy path', async () => {
      vi.mocked(mockPrisma.user.findUnique).mockResolvedValue({ id: 'admin-uuid-1' });
      vi.mocked(mockService.create).mockResolvedValue(sampleRawConfig);
      const handler = extractHandler(buildRouter(), 'POST', '/');
      const { res, status } = makeMockRes();

      await handler(makeMockReq({ body: { name: 'New Global', provider: 'mistral' } }), res);
      expect(mockService.create).toHaveBeenCalledWith(
        { type: 'GLOBAL' },
        expect.any(Object),
        'admin-uuid-1'
      );
      expect(status).toHaveBeenCalledWith(StatusCodes.CREATED);
    });
  });

  describe('PUT /:id (edit)', () => {
    it('returns 404 when config not found', async () => {
      vi.mocked(mockPrisma.ttsConfig.findUnique).mockResolvedValue(null);
      const handler = extractHandler(buildRouter(), 'PUT', '/:id');
      const { res, json } = makeMockRes();

      await handler(makeMockReq({ params: { id: 'missing' }, body: { description: 'new' } }), res);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'NOT_FOUND' }));
    });

    it('returns 400 when target is not global', async () => {
      vi.mocked(mockPrisma.ttsConfig.findUnique).mockResolvedValue({
        ...sampleRawConfig,
        isGlobal: false,
      });
      const handler = extractHandler(buildRouter(), 'PUT', '/:id');
      const { res, json } = makeMockRes();

      await handler(
        makeMockReq({ params: { id: 'cfg-uuid-1' }, body: { description: 'new' } }),
        res
      );
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
          message: expect.stringContaining('global'),
        })
      );
    });

    it('translates TtsInvalidProviderError to 400 VALIDATION_ERROR', async () => {
      vi.mocked(mockPrisma.ttsConfig.findUnique).mockResolvedValue(sampleRawConfig);
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

    it('returns 200 on happy path', async () => {
      vi.mocked(mockPrisma.ttsConfig.findUnique).mockResolvedValue(sampleRawConfig);
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

  describe('PUT /:id/set-default', () => {
    it('returns 404 when config not found', async () => {
      vi.mocked(mockPrisma.ttsConfig.findUnique).mockResolvedValue(null);
      const handler = extractHandler(buildRouter(), 'PUT', '/:id/set-default');
      const { res, json } = makeMockRes();

      await handler(makeMockReq({ params: { id: 'missing' } }), res);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'NOT_FOUND' }));
    });

    it('returns 400 when target is not global', async () => {
      vi.mocked(mockPrisma.ttsConfig.findUnique).mockResolvedValue({
        ...sampleRawConfig,
        isGlobal: false,
      });
      const handler = extractHandler(buildRouter(), 'PUT', '/:id/set-default');
      const { res, json } = makeMockRes();

      await handler(makeMockReq({ params: { id: 'cfg-uuid-1' } }), res);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'VALIDATION_ERROR' }));
      expect(mockService.setAsDefault).not.toHaveBeenCalled();
    });

    it('calls service.setAsDefault on happy path', async () => {
      vi.mocked(mockPrisma.ttsConfig.findUnique).mockResolvedValue(sampleRawConfig);
      const handler = extractHandler(buildRouter(), 'PUT', '/:id/set-default');
      const { res, json } = makeMockRes();

      await handler(makeMockReq({ params: { id: 'cfg-uuid-1' } }), res);
      expect(mockService.setAsDefault).toHaveBeenCalledWith('cfg-uuid-1');
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  describe('PUT /:id/set-free-default', () => {
    it('returns 400 when target is not self-hosted', async () => {
      // ElevenLabs config (BYOK provider) — should be rejected
      vi.mocked(mockPrisma.ttsConfig.findUnique).mockResolvedValue({
        ...sampleRawConfig,
        provider: 'elevenlabs',
      });
      const handler = extractHandler(buildRouter(), 'PUT', '/:id/set-free-default');
      const { res, json } = makeMockRes();

      await handler(makeMockReq({ params: { id: 'cfg-uuid-1' } }), res);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
          message: expect.stringContaining('self-hosted'),
        })
      );
      expect(mockService.setAsFreeDefault).not.toHaveBeenCalled();
    });

    it('returns 400 when target is not global', async () => {
      vi.mocked(mockPrisma.ttsConfig.findUnique).mockResolvedValue({
        ...sampleRawConfig,
        provider: 'self-hosted',
        isGlobal: false,
      });
      const handler = extractHandler(buildRouter(), 'PUT', '/:id/set-free-default');
      const { res, json } = makeMockRes();

      await handler(makeMockReq({ params: { id: 'cfg-uuid-1' } }), res);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'VALIDATION_ERROR' }));
      expect(mockService.setAsFreeDefault).not.toHaveBeenCalled();
    });

    it('calls service.setAsFreeDefault on self-hosted happy path', async () => {
      vi.mocked(mockPrisma.ttsConfig.findUnique).mockResolvedValue({
        ...sampleRawConfig,
        provider: 'self-hosted',
      });
      const handler = extractHandler(buildRouter(), 'PUT', '/:id/set-free-default');
      const { res, json } = makeMockRes();

      await handler(makeMockReq({ params: { id: 'cfg-uuid-1' } }), res);
      expect(mockService.setAsFreeDefault).toHaveBeenCalledWith('cfg-uuid-1');
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('rejects mistral as free-default (BYOK provider)', async () => {
      vi.mocked(mockPrisma.ttsConfig.findUnique).mockResolvedValue({
        ...sampleRawConfig,
        provider: 'mistral',
      });
      const handler = extractHandler(buildRouter(), 'PUT', '/:id/set-free-default');
      const { res, json } = makeMockRes();

      await handler(makeMockReq({ params: { id: 'cfg-uuid-1' } }), res);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
          message: expect.stringContaining('self-hosted'),
        })
      );
    });
  });

  describe('DELETE /:id', () => {
    it('returns 404 when config not found', async () => {
      vi.mocked(mockPrisma.ttsConfig.findUnique).mockResolvedValue(null);
      const handler = extractHandler(buildRouter(), 'DELETE', '/:id');
      const { res, json } = makeMockRes();

      await handler(makeMockReq({ params: { id: 'missing' } }), res);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'NOT_FOUND' }));
    });

    it('returns 400 when target is not global', async () => {
      vi.mocked(mockPrisma.ttsConfig.findUnique).mockResolvedValue({
        ...sampleRawConfig,
        isGlobal: false,
      });
      const handler = extractHandler(buildRouter(), 'DELETE', '/:id');
      const { res, json } = makeMockRes();

      await handler(makeMockReq({ params: { id: 'cfg-uuid-1' } }), res);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'VALIDATION_ERROR' }));
      expect(mockService.delete).not.toHaveBeenCalled();
    });

    it('returns 400 when the AdminSettings global-default pointer targets it', async () => {
      // The FK is ON DELETE SET NULL, so without the guard the delete would
      // silently null the pointer — the route must block instead.
      vi.mocked(mockPrisma.ttsConfig.findUnique).mockResolvedValue(sampleRawConfig);
      vi.mocked(mockPrisma.adminSettings.findUnique).mockResolvedValueOnce({
        globalDefaultTtsConfigId: 'cfg-uuid-1',
        freeDefaultTtsConfigId: null,
      } as never);
      const handler = extractHandler(buildRouter(), 'DELETE', '/:id');
      const { res, json } = makeMockRes();

      await handler(makeMockReq({ params: { id: 'cfg-uuid-1' } }), res);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
          message: expect.stringContaining('default'),
        })
      );
      expect(mockService.delete).not.toHaveBeenCalled();
    });

    it('returns 400 when the AdminSettings free-default pointer targets it', async () => {
      // Same hard-block shape as the global default — guest users would
      // otherwise lose TTS until an admin manually sets a new free default.
      vi.mocked(mockPrisma.ttsConfig.findUnique).mockResolvedValue(sampleRawConfig);
      vi.mocked(mockPrisma.adminSettings.findUnique).mockResolvedValueOnce({
        globalDefaultTtsConfigId: null,
        freeDefaultTtsConfigId: 'cfg-uuid-1',
      } as never);
      const handler = extractHandler(buildRouter(), 'DELETE', '/:id');
      const { res, json } = makeMockRes();

      await handler(makeMockReq({ params: { id: 'cfg-uuid-1' } }), res);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'VALIDATION_ERROR',
          message: expect.stringContaining('free tier default'),
        })
      );
      expect(mockService.delete).not.toHaveBeenCalled();
    });

    it('returns 400 when delete constraints block', async () => {
      vi.mocked(mockPrisma.ttsConfig.findUnique).mockResolvedValue(sampleRawConfig);
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
      vi.mocked(mockPrisma.ttsConfig.findUnique).mockResolvedValue(sampleRawConfig);
      const handler = extractHandler(buildRouter(), 'DELETE', '/:id');
      const { res, json } = makeMockRes();

      await handler(makeMockReq({ params: { id: 'cfg-uuid-1' } }), res);
      expect(mockService.delete).toHaveBeenCalledWith('cfg-uuid-1');
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ deleted: true }));
      // Clean delete (no users adopting): warning field absent from response.
      const callArgs = vi.mocked(json).mock.calls[0]?.[0] as Record<string, unknown> | undefined;
      expect(callArgs?.warning).toBeUndefined();
    });

    it('propagates non-null warning into the success response body', async () => {
      vi.mocked(mockPrisma.ttsConfig.findUnique).mockResolvedValue(sampleRawConfig);
      vi.mocked(mockService.checkDeleteConstraints).mockResolvedValue({
        blocker: null,
        warning: "Deleting this TTS config will reset 3 user(s)' personal default to NULL",
      });
      const handler = extractHandler(buildRouter(), 'DELETE', '/:id');
      const { res, json } = makeMockRes();

      await handler(makeMockReq({ params: { id: 'cfg-uuid-1' } }), res);
      expect(mockService.delete).toHaveBeenCalledWith('cfg-uuid-1');
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          deleted: true,
          warning: expect.stringContaining('3 user'),
        })
      );
    });

    it('drops warning when blocker also fires (blocker wins)', async () => {
      // Deliberate behavior: when a delete is blocked, the admin can't proceed
      // until they reassign — so showing both blocker + warning at once is
      // informational not actionable. The 400 response carries blocker only;
      // the warning surfaces on the retry after the blocker is cleared.
      vi.mocked(mockPrisma.ttsConfig.findUnique).mockResolvedValue(sampleRawConfig);
      vi.mocked(mockService.checkDeleteConstraints).mockResolvedValue({
        blocker: 'Cannot delete: TTS config is used as default by 2 personality(ies)',
        warning: "Deleting this TTS config will reset 3 user(s)' personal default to NULL",
      });
      const handler = extractHandler(buildRouter(), 'DELETE', '/:id');
      const { res, json } = makeMockRes();

      await handler(makeMockReq({ params: { id: 'cfg-uuid-1' } }), res);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'VALIDATION_ERROR' }));
      expect(mockService.delete).not.toHaveBeenCalled();
      // warning should NOT appear in the error response body
      const callArgs = vi.mocked(json).mock.calls[0]?.[0] as Record<string, unknown> | undefined;
      expect(callArgs?.warning).toBeUndefined();
    });
  });
});
