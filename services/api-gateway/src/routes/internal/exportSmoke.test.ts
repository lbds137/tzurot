/**
 * Tests for POST /internal/export-smoke/start and
 * GET /internal/export-smoke/status.
 *
 * `createExportJobOrConflict` and `ensureOrphanSentinel` are mocked — they
 * carry their own coverage (`export.test.ts`, `OrphanSentinelBootstrap`'s own
 * callers) — so this file's load-bearing case is the wiring: the sentinel id
 * and `checkCooldown: false` crossing into `createExportJobOrConflict`, the
 * job data crossing into the queue seam, and the expected-counts snapshot
 * shape.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { RouteDeps } from '../routeDeps.js';
import { stubRouteResolvers } from '../../test/shared-route-test-utils.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

const SENTINEL_ID = '829e4567-e89b-42d3-a456-426614174000';
const mockEnsureOrphanSentinel = vi.fn().mockResolvedValue(SENTINEL_ID);
vi.mock('../../services/OrphanSentinelBootstrap.js', () => ({
  ensureOrphanSentinel: (...args: unknown[]) => mockEnsureOrphanSentinel(...args),
}));

const mockCreateExportJobOrConflict = vi.fn();
vi.mock('../user/account/export.js', () => ({
  createExportJobOrConflict: (...args: unknown[]) => mockCreateExportJobOrConflict(...args),
  EXPORT_EXPIRY_HOURS: 24,
}));

vi.mock('@tzurot/common-types/config/config', () => ({
  getConfig: () => ({
    PUBLIC_GATEWAY_URL: 'https://gateway.example.invalid',
    GATEWAY_URL: undefined,
  }),
}));

import { handleStartExportSmoke, handleGetExportSmokeStatus } from './exportSmoke.js';

const START_ROUTE = '/internal/export-smoke/start';
const STATUS_ROUTE = '/internal/export-smoke/status';

function buildMockPrisma(): Record<string, unknown> {
  return {
    persona: { findMany: vi.fn().mockResolvedValue([]) },
    personalityOwner: { findMany: vi.fn().mockResolvedValue([]) },
    personality: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ isSuperuser: false }) },
    conversationHistory: { groupBy: vi.fn().mockResolvedValue([]) },
    memory: { groupBy: vi.fn().mockResolvedValue([]) },
    memoryFact: { groupBy: vi.fn().mockResolvedValue([]) },
    exportJob: { findFirst: vi.fn() },
  };
}

function buildApp(
  mockPrisma: Record<string, unknown>,
  deps: Partial<RouteDeps> = {}
): express.Express {
  const app = express();
  app.use(express.json());
  const fullDeps = {
    ...stubRouteResolvers(),
    prisma: mockPrisma as unknown as PrismaClient,
    aiQueue: { add: vi.fn().mockResolvedValue(undefined) } as unknown as RouteDeps['aiQueue'],
    ...deps,
  } as RouteDeps;
  app.post(START_ROUTE, handleStartExportSmoke(fullDeps));
  app.get(STATUS_ROUTE, handleGetExportSmokeStatus(fullDeps));
  return app;
}

describe('POST /api/internal/export-smoke/start', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureOrphanSentinel.mockResolvedValue(SENTINEL_ID);
    mockCreateExportJobOrConflict.mockResolvedValue({
      exportJobId: 'export-job-1',
      downloadToken: 'token-1',
      conflictStatus: null,
      onCooldown: false,
    });
  });

  it('starts the job and returns expected-counts snapshot with zero rows for an empty sentinel', async () => {
    const mockPrisma = buildMockPrisma();
    const app = buildApp(mockPrisma);

    const response = await request(app).post(START_ROUTE).send({});

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      exportJobId: 'export-job-1',
      expectedCounts: {
        personas: [],
        characters: [],
        conversationCountsByPersonalityId: {},
        memoryCountsByPersonalityId: {},
        factCountsByPersonalityId: {},
        totals: { personas: 0, characters: 0, conversations: 0, memories: 0, facts: 0 },
        isSuperuser: false,
      },
    });
  });

  it('forwards the sentinel id and checkCooldown:false to createExportJobOrConflict (the deliberate bypass)', async () => {
    const mockPrisma = buildMockPrisma();
    const app = buildApp(mockPrisma);

    await request(app).post(START_ROUTE).send({});

    expect(mockCreateExportJobOrConflict).toHaveBeenCalledTimes(1);
    const [, userIdArg, , checkCooldownArg] = mockCreateExportJobOrConflict.mock.calls[0] as [
      unknown,
      string,
      unknown,
      boolean,
    ];
    expect(userIdArg).toBe(SENTINEL_ID);
    expect(checkCooldownArg).toBe(false);
  });

  it('forwards {userId: sentinelId, exportJobId} to the queue seam', async () => {
    const mockPrisma = buildMockPrisma();
    const mockAdd = vi.fn().mockResolvedValue(undefined);
    const app = buildApp(mockPrisma, {
      aiQueue: { add: mockAdd } as unknown as RouteDeps['aiQueue'],
    });

    await request(app).post(START_ROUTE).send({});

    expect(mockAdd).toHaveBeenCalledTimes(1);
    const [, jobData] = mockAdd.mock.calls[0] as [string, { userId: string; exportJobId: string }];
    expect(jobData).toEqual({ userId: SENTINEL_ID, exportJobId: 'export-job-1' });
  });

  it('returns 409 when an export-smoke run is already active (the conflict check is NOT bypassed)', async () => {
    mockCreateExportJobOrConflict.mockResolvedValue({
      exportJobId: 'export-job-1',
      downloadToken: 'token-1',
      conflictStatus: 'in_progress',
      onCooldown: false,
    });
    const mockPrisma = buildMockPrisma();
    const app = buildApp(mockPrisma);

    const response = await request(app).post(START_ROUTE).send({});

    expect(response.status).toBe(409);
  });

  it('returns 503 when the queue is not configured', async () => {
    const mockPrisma = buildMockPrisma();
    const app = buildApp(mockPrisma, { aiQueue: undefined });

    const response = await request(app).post(START_ROUTE).send({});

    expect(response.status).toBe(503);
    expect(mockCreateExportJobOrConflict).not.toHaveBeenCalled();
  });

  it('returns 400 for a stray request-body field (strict, no body expected)', async () => {
    const mockPrisma = buildMockPrisma();
    const app = buildApp(mockPrisma);

    const response = await request(app).post(START_ROUTE).send({ extra: true });

    expect(response.status).toBe(400);
  });

  it('rolls up per-personality counts and character/persona rows into the snapshot', async () => {
    const mockPrisma = buildMockPrisma();
    (mockPrisma.persona as { findMany: ReturnType<typeof vi.fn> }).findMany.mockResolvedValue([
      { id: 'persona-1', name: 'Alex' },
    ]);
    (
      mockPrisma.personalityOwner as { findMany: ReturnType<typeof vi.fn> }
    ).findMany.mockResolvedValue([{ personalityId: 'char-1' }]);
    (mockPrisma.personality as { findMany: ReturnType<typeof vi.fn> }).findMany.mockImplementation(
      (args: { select: Record<string, boolean> }) => {
        if ('slug' in args.select) {
          return Promise.resolve([{ id: 'char-1', slug: 'my-character' }]);
        }
        return Promise.resolve([]);
      }
    );
    (
      mockPrisma.conversationHistory as { groupBy: ReturnType<typeof vi.fn> }
    ).groupBy.mockResolvedValue([{ personalityId: 'char-1', _count: { _all: 3 } }]);

    const app = buildApp(mockPrisma);
    const response = await request(app).post(START_ROUTE).send({});

    expect(response.status).toBe(200);
    expect(response.body.expectedCounts).toMatchObject({
      personas: [{ id: 'persona-1', name: 'Alex' }],
      characters: [{ id: 'char-1', slug: 'my-character' }],
      conversationCountsByPersonalityId: { 'char-1': 3 },
      totals: { personas: 1, characters: 1, conversations: 3, memories: 0, facts: 0 },
    });
  });
});

describe('GET /api/internal/export-smoke/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the status and null downloadUrl for a pending job', async () => {
    const mockPrisma = buildMockPrisma();
    (mockPrisma.exportJob as { findFirst: ReturnType<typeof vi.fn> }).findFirst.mockResolvedValue({
      status: 'pending',
      downloadToken: 'token-1',
    });
    const app = buildApp(mockPrisma);

    const response = await request(app).get(STATUS_ROUTE).query({ jobId: SENTINEL_ID });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'pending', downloadUrl: null });
  });

  it('returns a populated downloadUrl for a completed job', async () => {
    const mockPrisma = buildMockPrisma();
    (mockPrisma.exportJob as { findFirst: ReturnType<typeof vi.fn> }).findFirst.mockResolvedValue({
      status: 'completed',
      downloadToken: 'token-1',
    });
    const app = buildApp(mockPrisma);

    const response = await request(app).get(STATUS_ROUTE).query({ jobId: SENTINEL_ID });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'completed',
      downloadUrl: 'https://gateway.example.invalid/exports/token-1',
    });
  });

  it('returns 404 when no matching job exists', async () => {
    const mockPrisma = buildMockPrisma();
    (mockPrisma.exportJob as { findFirst: ReturnType<typeof vi.fn> }).findFirst.mockResolvedValue(
      null
    );
    const app = buildApp(mockPrisma);

    const response = await request(app).get(STATUS_ROUTE).query({ jobId: SENTINEL_ID });

    expect(response.status).toBe(404);
  });

  it('returns 400 for a non-uuid jobId', async () => {
    const mockPrisma = buildMockPrisma();
    const app = buildApp(mockPrisma);

    const response = await request(app).get(STATUS_ROUTE).query({ jobId: 'not-a-uuid' });

    expect(response.status).toBe(400);
  });
});
