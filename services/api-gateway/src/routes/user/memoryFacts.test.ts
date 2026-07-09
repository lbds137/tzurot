/**
 * Tests for /user/fact/* memory-fact correction handlers.
 *
 * Unit-tier: prisma + embedding are mocked, so these cover the branch logic
 * (ownership 404s, the identical-statement guard, the embedding-required 503,
 * the lock idempotency short-circuit). The real SQL — the corrected-fact
 * INSERT/supersede transaction — is exercised against PGLite in
 * memoryFacts.component.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response } from 'express';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { ProvisionedRequest } from '../../types.js';
import type { RouteDeps } from '../routeDeps.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

vi.mock('./memoryHelpers.js', () => ({ getDefaultPersonaId: vi.fn() }));
vi.mock('../../utils/resolveProvisionedUserId.js', () => ({ resolveProvisionedUserId: vi.fn() }));
vi.mock('../../services/EmbeddingService.js', () => ({
  isEmbeddingServiceAvailable: vi.fn(),
  generateEmbedding: vi.fn(),
  formatAsVector: (embedding: number[]) => `[${embedding.join(',')}]`,
}));

import {
  handleListFacts,
  handleGetFact,
  handleCorrectFact,
  handleForgetFact,
  handleSetFactLock,
} from './memoryFacts.js';
import { getDefaultPersonaId } from './memoryHelpers.js';
import { resolveProvisionedUserId } from '../../utils/resolveProvisionedUserId.js';
import { isEmbeddingServiceAvailable, generateEmbedding } from '../../services/EmbeddingService.js';
import { stubRouteResolvers } from '../../test/shared-route-test-utils.js';

const USER = '00000000-0000-0000-0000-000000000001';
const PERSONA = '00000000-0000-0000-0000-000000000002';
const PERSONALITY = '00000000-0000-0000-0000-000000000003';
const FACT_ID = '00000000-0000-0000-0000-000000000004';

const mockPrisma = {
  memoryFact: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
};

const mockResolve = vi.mocked(resolveProvisionedUserId);
const mockPersona = vi.mocked(getDefaultPersonaId);
const mockEmbedAvailable = vi.mocked(isEmbeddingServiceAvailable);
const mockGenerateEmbedding = vi.mocked(generateEmbedding);

function deps(): RouteDeps {
  return { prisma: mockPrisma as unknown as PrismaClient, ...stubRouteResolvers() };
}

function reqRes(
  params: Record<string, string> = {},
  body: Record<string, unknown> = {},
  query: Record<string, unknown> = {}
) {
  const req = {
    userId: 'discord-1',
    provisionedUserId: USER,
    params,
    body,
    query,
  } as unknown as ProvisionedRequest;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

const activeFact = {
  id: FACT_ID,
  personalityId: PERSONALITY,
  personaId: PERSONA,
  statement: 'The user lives in Seattle',
  entityTags: ['user'],
  salience: 0.7,
  tier: 'observed',
  isLocked: false,
  isFiction: false,
  validFrom: new Date('2026-01-01'),
  supersededAt: null,
  supersededById: null,
  forgotten: false,
  sourceMemoryIds: ['mem-1'],
  createdAt: new Date('2026-01-01'),
};

describe('memoryFacts handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolve.mockReturnValue(USER);
    mockPersona.mockResolvedValue(PERSONA);
    mockPrisma.memoryFact.findFirst.mockResolvedValue(activeFact);
    mockPrisma.memoryFact.findUnique.mockResolvedValue({
      ...activeFact,
      tier: 'corrected',
    });
    mockPrisma.memoryFact.findMany.mockResolvedValue([activeFact]);
    mockPrisma.memoryFact.count.mockResolvedValue(1);
    mockPrisma.memoryFact.update.mockResolvedValue({ ...activeFact, isLocked: true });
    mockPrisma.memoryFact.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.$executeRaw.mockResolvedValue(1);
    mockPrisma.$transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
    mockEmbedAvailable.mockReturnValue(true);
    mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
  });

  describe('handleListFacts', () => {
    it('requires personalityId', async () => {
      const { req, res } = reqRes({}, {}, {});
      await handleListFacts(deps())(req, res, () => undefined);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns an empty list when the user has no persona (no 404)', async () => {
      mockPersona.mockResolvedValue(null);
      const { req, res } = reqRes({}, {}, { personalityId: PERSONALITY });
      await handleListFacts(deps())(req, res, () => undefined);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ facts: [], total: 0 }));
    });

    it('scopes the query to active facts for the persona + personality', async () => {
      const { req, res } = reqRes({}, {}, { personalityId: PERSONALITY });
      await handleListFacts(deps())(req, res, () => undefined);
      expect(mockPrisma.memoryFact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            personalityId: PERSONALITY,
            personaId: PERSONA,
            supersededAt: null,
            forgotten: false,
            visibility: 'normal',
          },
        })
      );
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ total: 1, hasMore: false }));
    });
  });

  describe('handleGetFact', () => {
    it('404s when the fact is not owned/active', async () => {
      mockPrisma.memoryFact.findFirst.mockResolvedValue(null);
      const { req, res } = reqRes({ id: FACT_ID });
      await handleGetFact(deps())(req, res, () => undefined);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns the wrapped fact', async () => {
      const { req, res } = reqRes({ id: FACT_ID });
      await handleGetFact(deps())(req, res, () => undefined);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ fact: expect.objectContaining({ id: FACT_ID }) })
      );
    });
  });

  describe('handleCorrectFact', () => {
    it('rejects an identical statement (nothing to correct)', async () => {
      const { req, res } = reqRes({ id: FACT_ID }, { statement: 'The user lives in Seattle' });
      await handleCorrectFact(deps())(req, res, () => undefined);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('503s when the embedding service is unavailable', async () => {
      mockEmbedAvailable.mockReturnValue(false);
      const { req, res } = reqRes({ id: FACT_ID }, { statement: 'The user lives in Denver' });
      await handleCorrectFact(deps())(req, res, () => undefined);
      expect(res.status).toHaveBeenCalledWith(503);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('503s when embedding generation returns null', async () => {
      mockGenerateEmbedding.mockResolvedValue(null);
      const { req, res } = reqRes({ id: FACT_ID }, { statement: 'The user lives in Denver' });
      await handleCorrectFact(deps())(req, res, () => undefined);
      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('supersedes the old fact and returns the corrected fact + supersededFactId', async () => {
      const { req, res } = reqRes({ id: FACT_ID }, { statement: 'The user lives in Denver' });
      await handleCorrectFact(deps())(req, res, () => undefined);
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      // The supersede arm points the old fact at some new id; the
      // supersededAt: null predicate is the racing-write no-op guard.
      expect(mockPrisma.memoryFact.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: FACT_ID, supersededAt: null },
          data: expect.objectContaining({ supersededById: expect.any(String) }),
        })
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          fact: expect.objectContaining({ tier: 'corrected' }),
          supersededFactId: FACT_ID,
        })
      );
    });

    it('403s on a locked fact (hard freeze, same contract as episode locks)', async () => {
      mockPrisma.memoryFact.findFirst.mockResolvedValue({ ...activeFact, isLocked: true });
      const { req, res } = reqRes({ id: FACT_ID }, { statement: 'The user lives in Denver' });
      await handleCorrectFact(deps())(req, res, () => undefined);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('handleForgetFact', () => {
    it('404s when not owned/active', async () => {
      mockPrisma.memoryFact.findFirst.mockResolvedValue(null);
      const { req, res } = reqRes({ id: FACT_ID });
      await handleForgetFact(deps())(req, res, () => undefined);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('sets forgotten + superseded_at with the racing-write predicate', async () => {
      const { req, res } = reqRes({ id: FACT_ID });
      await handleForgetFact(deps())(req, res, () => undefined);
      expect(mockPrisma.memoryFact.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          // supersededAt: null — a racing supersession makes this a no-op
          // instead of stomping the successor pointer.
          where: { id: FACT_ID, supersededAt: null },
          data: expect.objectContaining({ forgotten: true, supersededById: null }),
        })
      );
      expect(res.json).toHaveBeenCalledWith({ id: FACT_ID, forgotten: true });
    });

    it('raced forget still sets forgotten (revival shield) without touching the successor pointer', async () => {
      mockPrisma.memoryFact.updateMany
        .mockResolvedValueOnce({ count: 0 }) // predicate missed — extraction won the race
        .mockResolvedValueOnce({ count: 1 }); // the forgotten-only follow-up
      const { req, res } = reqRes({ id: FACT_ID });
      await handleForgetFact(deps())(req, res, () => undefined);

      // The follow-up write sets ONLY forgotten — supersededAt/supersededById
      // (the extraction's successor pointer) are preserved.
      expect(mockPrisma.memoryFact.updateMany).toHaveBeenNthCalledWith(2, {
        where: { id: FACT_ID },
        data: { forgotten: true },
      });
      expect(res.json).toHaveBeenCalledWith({ id: FACT_ID, forgotten: true });
    });

    it('403s on a locked fact (hard freeze, same contract as episode locks)', async () => {
      mockPrisma.memoryFact.findFirst.mockResolvedValue({ ...activeFact, isLocked: true });
      const { req, res } = reqRes({ id: FACT_ID });
      await handleForgetFact(deps())(req, res, () => undefined);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(mockPrisma.memoryFact.update).not.toHaveBeenCalled();
    });
  });

  describe('handleSetFactLock', () => {
    it('short-circuits (no write) when the requested state already holds', async () => {
      const { req, res } = reqRes({ id: FACT_ID }, { locked: false }); // fact is unlocked
      await handleSetFactLock(deps())(req, res, () => undefined);
      expect(mockPrisma.memoryFact.update).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('toggles the lock when the state differs', async () => {
      const { req, res } = reqRes({ id: FACT_ID }, { locked: true });
      await handleSetFactLock(deps())(req, res, () => undefined);
      expect(mockPrisma.memoryFact.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isLocked: true }) })
      );
    });

    it('rejects a non-boolean lock body', async () => {
      const { req, res } = reqRes({ id: FACT_ID }, { locked: 'yes' });
      await handleSetFactLock(deps())(req, res, () => undefined);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });
});
