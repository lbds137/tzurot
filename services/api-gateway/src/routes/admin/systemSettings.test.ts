/**
 * Tests for the admin system-settings routes (GET/PATCH /admin/settings/system).
 * Covers the write pipeline: wire-schema parse → coherence → model validation
 * (alias allowlist, free-route firewall, catalog fail modes, vision capability)
 * → optimistic-concurrency merge (unknown keys preserved) → invalidation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ADMIN_SETTINGS_SINGLETON_ID } from '@tzurot/common-types/schemas/api/adminSettings';
import { AUTO_ROUTER_MODEL, FREE_ROUTER_MODEL } from '@tzurot/common-types/constants/ai';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import type { SystemSettingsCacheInvalidationService } from '@tzurot/cache-invalidation';

// Mutable per-test knobs, referenced lazily by the hoisted mock factories.
let mockZaiKey: string | undefined;
const mockResolveCapabilities = vi.fn();

vi.mock('@tzurot/common-types/config/config', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types/config/config')>();
  return {
    ...actual,
    getConfig: () => actual.createTestConfig({ ZAI_CODING_API_KEY: mockZaiKey }),
  };
});

vi.mock('../../services/ModelCapabilityService.js', () => ({
  ModelCapabilityService: class {
    resolve = (modelId: string): unknown => mockResolveCapabilities(modelId);
  },
}));

import { handleGetSystemSettings, handleUpdateSystemSettings } from './systemSettings.js';
import type { RouteDeps } from '../routeDeps.js';

const MOCK_USER_ID = 'owner-discord-id';
const MOCK_USER_UUID = '550e8400-e29b-41d4-a716-446655440000';
const ROW_UPDATED_AT = new Date('2026-07-12T10:00:00.000Z');

function createMockPrisma(): {
  adminSettings: { upsert: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
  user: { findFirst: ReturnType<typeof vi.fn> };
} {
  return {
    adminSettings: { upsert: vi.fn(), updateMany: vi.fn() },
    user: { findFirst: vi.fn() },
  };
}

function settingsRow(bag: Record<string, unknown> | null, updatedAt = ROW_UPDATED_AT) {
  return {
    id: ADMIN_SETTINGS_SINGLETON_ID,
    updatedBy: null,
    configDefaults: null,
    systemSettings: bag,
    createdAt: new Date('2026-01-01'),
    updatedAt,
  };
}

describe('Admin System Settings Routes', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let mockInvalidation: { invalidateKeys: ReturnType<typeof vi.fn> };
  let app: express.Express;

  function patchBody(
    patch: Record<string, unknown>,
    expectedUpdatedAt = ROW_UPDATED_AT.toISOString()
  ): Record<string, unknown> {
    return { expectedUpdatedAt, patch };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockZaiKey = undefined;
    mockResolveCapabilities.mockResolvedValue({ supportsVision: true });

    mockPrisma = createMockPrisma();
    mockPrisma.user.findFirst.mockResolvedValue({ id: MOCK_USER_UUID });
    mockPrisma.adminSettings.upsert.mockResolvedValue(settingsRow({}));
    mockPrisma.adminSettings.updateMany.mockResolvedValue({ count: 1 });

    mockInvalidation = { invalidateKeys: vi.fn().mockResolvedValue(undefined) };

    const deps = {
      prisma: mockPrisma as unknown as PrismaClient,
      systemSettingsInvalidation:
        mockInvalidation as unknown as SystemSettingsCacheInvalidationService,
      cascadeResolver: {} as never,
    } as unknown as RouteDeps;

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as express.Request & { userId: string }).userId = MOCK_USER_ID;
      next();
    });
    app.get('/system', handleGetSystemSettings(deps));
    app.patch('/system', handleUpdateSystemSettings(deps));
  });

  describe('GET', () => {
    it('returns the stored bag and the concurrency token', async () => {
      mockPrisma.adminSettings.upsert.mockResolvedValue(
        settingsRow({ zaiHeadroomPercent: 60, futureKey: 'preserved' })
      );

      const res = await request(app).get('/system');

      expect(res.status).toBe(200);
      expect(res.body.systemSettings).toEqual({
        zaiHeadroomPercent: 60,
        futureKey: 'preserved',
      });
      expect(res.body.updatedAt).toBe(ROW_UPDATED_AT.toISOString());
    });

    it('returns an empty bag when the column is null', async () => {
      mockPrisma.adminSettings.upsert.mockResolvedValue(settingsRow(null));

      const res = await request(app).get('/system');

      expect(res.status).toBe(200);
      expect(res.body.systemSettings).toEqual({});
    });
  });

  describe('PATCH — wire validation', () => {
    it('rejects an out-of-bounds value', async () => {
      const res = await request(app)
        .patch('/system')
        .send(patchBody({ zaiHeadroomPercent: 200 }));

      expect(res.status).toBe(400);
      expect(mockPrisma.adminSettings.updateMany).not.toHaveBeenCalled();
    });

    it('rejects an unknown patch key (typo, not drift)', async () => {
      const res = await request(app)
        .patch('/system')
        .send(patchBody({ extractoinEnabled: true }));

      expect(res.status).toBe(400);
    });

    it('rejects an empty patch', async () => {
      const res = await request(app).patch('/system').send(patchBody({}));

      expect(res.status).toBe(400);
    });

    it('rejects a missing concurrency token', async () => {
      const res = await request(app)
        .patch('/system')
        .send({ patch: { zaiHeadroomPercent: 50 } });

      expect(res.status).toBe(400);
    });
  });

  describe('PATCH — coherence (D7)', () => {
    it('rejects zaiFreeTierEnabled=true without the system z.ai key', async () => {
      mockZaiKey = undefined;

      const res = await request(app)
        .patch('/system')
        .send(patchBody({ zaiFreeTierEnabled: true }));

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('ZAI_CODING_API_KEY');
    });

    it('accepts zaiFreeTierEnabled=true when the key is configured', async () => {
      mockZaiKey = 'zai-key-present';

      const res = await request(app)
        .patch('/system')
        .send(patchBody({ zaiFreeTierEnabled: true }));

      expect(res.status).toBe(200);
    });

    it("rejects extractionProvider 'zai-coding' without the key", async () => {
      const res = await request(app)
        .patch('/system')
        .send(patchBody({ extractionProvider: 'zai-coding' }));

      expect(res.status).toBe(400);
    });
  });

  describe('PATCH — model validation (D9/D10)', () => {
    it('accepts router aliases without a catalog lookup', async () => {
      const res = await request(app)
        .patch('/system')
        .send(patchBody({ fallbackVisionModel: AUTO_ROUTER_MODEL }));

      expect(res.status).toBe(200);
      expect(mockResolveCapabilities).not.toHaveBeenCalled();
    });

    it('free floor rejects a paid model (billing firewall)', async () => {
      const res = await request(app)
        .patch('/system')
        .send(patchBody({ fallbackTextModelFree: 'anthropic/claude-haiku-4.5' }));

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('free-route');
    });

    it("free floor accepts a ':free'-suffixed catalog model", async () => {
      const res = await request(app)
        .patch('/system')
        .send(patchBody({ fallbackTextModelFree: 'x-ai/grok-4.1-fast:free' }));

      expect(res.status).toBe(200);
    });

    it('free VISION floor still requires image capability', async () => {
      mockResolveCapabilities.mockResolvedValue({ supportsVision: false });

      const res = await request(app)
        .patch('/system')
        .send(patchBody({ fallbackVisionModelFree: 'some/text-only:free' }));

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('image input');
    });

    it('floor fields fail CLOSED when the catalog cannot verify', async () => {
      mockResolveCapabilities.mockResolvedValue(null);

      const res = await request(app)
        .patch('/system')
        .send(patchBody({ fallbackVisionModel: 'unverifiable/model' }));

      expect(res.status).toBe(400);
      expect(mockPrisma.adminSettings.updateMany).not.toHaveBeenCalled();
    });

    it('extractionModel fails OPEN with a warning when the catalog cannot verify', async () => {
      mockResolveCapabilities.mockResolvedValue(null);

      const res = await request(app)
        .patch('/system')
        .send(patchBody({ extractionModel: 'unverifiable/model' }));

      expect(res.status).toBe(200);
      expect(res.body.warnings).toHaveLength(1);
      expect(res.body.warnings[0]).toContain('unverifiable/model');
    });

    it('rejects a z-ai/ model absent from the static catalog even on a fail-open field', async () => {
      const res = await request(app)
        .patch('/system')
        .send(patchBody({ extractionModel: 'z-ai/not-a-real-model' }));

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('z.ai');
    });

    it('accepts a REAL z-ai/ catalog model (the prefixed form users actually type)', async () => {
      const res = await request(app)
        .patch('/system')
        .send(patchBody({ extractionModel: 'z-ai/glm-5.2' }));

      expect(res.status).toBe(200);
    });

    it('paid vision floor rejects a text-only model', async () => {
      mockResolveCapabilities.mockResolvedValue({ supportsVision: false });

      const res = await request(app)
        .patch('/system')
        .send(patchBody({ fallbackVisionModel: 'qwen/text-only-model' }));

      expect(res.status).toBe(400);
    });
  });

  describe('PATCH — merge + concurrency', () => {
    it('merges over the existing bag, preserving unknown keys', async () => {
      mockPrisma.adminSettings.upsert.mockResolvedValue(
        settingsRow({ futureKey: 'preserved', zaiHeadroomPercent: 75 })
      );

      const res = await request(app)
        .patch('/system')
        .send(patchBody({ zaiHeadroomPercent: 50 }));

      expect(res.status).toBe(200);
      expect(mockPrisma.adminSettings.updateMany).toHaveBeenCalledWith({
        where: {
          id: ADMIN_SETTINGS_SINGLETON_ID,
          updatedAt: ROW_UPDATED_AT,
        },
        data: {
          systemSettings: { futureKey: 'preserved', zaiHeadroomPercent: 50 },
          updatedBy: MOCK_USER_UUID,
        },
      });
    });

    it('returns 409 when the row moved since the client read it', async () => {
      mockPrisma.adminSettings.updateMany.mockResolvedValue({ count: 0 });

      const res = await request(app)
        .patch('/system')
        .send(patchBody({ zaiHeadroomPercent: 50 }, '2026-07-12T09:00:00.000Z'));

      expect(res.status).toBe(409);
      expect(mockInvalidation.invalidateKeys).not.toHaveBeenCalled();
    });

    it('publishes invalidation for exactly the changed keys', async () => {
      const res = await request(app)
        .patch('/system')
        .send(patchBody({ zaiHeadroomPercent: 50, extractionEnabled: true }));

      expect(res.status).toBe(200);
      expect(mockInvalidation.invalidateKeys).toHaveBeenCalledWith(
        expect.arrayContaining(['zaiHeadroomPercent', 'extractionEnabled'])
      );
    });

    it('still succeeds when the invalidation publish fails (fail-soft)', async () => {
      mockInvalidation.invalidateKeys.mockRejectedValue(new Error('redis down'));

      const res = await request(app)
        .patch('/system')
        .send(patchBody({ extractionEnabled: true }));

      expect(res.status).toBe(200);
    });

    it('free floors accept their own alias end-to-end (the seed value is always writable)', async () => {
      const res = await request(app)
        .patch('/system')
        .send(patchBody({ fallbackTextModelFree: FREE_ROUTER_MODEL }));

      expect(res.status).toBe(200);
    });
  });

  describe('PATCH — cross-field window pair', () => {
    it('rejects a floor raised above the stored ceiling', async () => {
      mockPrisma.adminSettings.upsert.mockResolvedValue(settingsRow({ freeTierMaxPerWindow: 30 }));

      const res = await request(app)
        .patch('/system')
        .send(patchBody({ freeTierMinPerWindow: 50 }));

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('freeTierMaxPerWindow');
      expect(mockPrisma.adminSettings.updateMany).not.toHaveBeenCalled();
    });

    it('accepts a patch that fixes both sides of an inverted pair at once', async () => {
      mockPrisma.adminSettings.upsert.mockResolvedValue(
        settingsRow({ freeTierMinPerWindow: 50, freeTierMaxPerWindow: 30 })
      );

      const res = await request(app)
        .patch('/system')
        .send(patchBody({ freeTierMinPerWindow: 5, freeTierMaxPerWindow: 30 }));

      expect(res.status).toBe(200);
    });

    it('never holds an unrelated write hostage to a pre-existing inverted pair', async () => {
      mockPrisma.adminSettings.upsert.mockResolvedValue(
        settingsRow({ freeTierMinPerWindow: 50, freeTierMaxPerWindow: 30 })
      );

      const res = await request(app)
        .patch('/system')
        .send(patchBody({ extractionEnabled: true }));

      expect(res.status).toBe(200);
    });
  });
});
