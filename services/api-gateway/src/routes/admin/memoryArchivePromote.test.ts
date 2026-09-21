/**
 * Tests for POST /api/admin/memory-archive/promote
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { handleMemoryArchivePromote } from './memoryArchivePromote.js';
import type { RouteDeps } from '../routeDeps.js';
import { stubRouteResolvers } from '../../test/shared-route-test-utils.js';

const mockRunArchivePromotion = vi.hoisted(() => vi.fn());

vi.mock('../../services/archivePromotion.js', () => ({
  runArchivePromotion: mockRunArchivePromotion,
}));

function validResult() {
  return {
    enabled: true,
    evaluated: 3,
    promoted: [],
    skipped: { notReady: 3, optedOut: 0, alreadyListed: 0, conflicted: 0 },
  };
}

describe('POST /api/admin/memory-archive/promote', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRunArchivePromotion.mockResolvedValue(validResult());

    const deps: RouteDeps = {
      ...stubRouteResolvers(),
      prisma: {} as PrismaClient,
    };
    app = express();
    app.use(express.json());
    app.post('/admin/memory-archive/promote', handleMemoryArchivePromote(deps));
  });

  it('returns 200 with the service result for a valid body', async () => {
    const response = await request(app).post('/admin/memory-archive/promote').send({});

    expect(response.status).toBe(200);
    expect(response.body).toEqual(validResult());
  });

  it('returns a validation error for a malformed dryRun', async () => {
    const response = await request(app)
      .post('/admin/memory-archive/promote')
      .send({ dryRun: 'yes' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('VALIDATION_ERROR');
    expect(mockRunArchivePromotion).not.toHaveBeenCalled();
  });

  it('forwards dryRun unchanged to the service', async () => {
    await request(app).post('/admin/memory-archive/promote').send({ dryRun: true });

    expect(mockRunArchivePromotion).toHaveBeenCalledWith(
      expect.objectContaining({ prisma: expect.anything() }),
      { dryRun: true }
    );
  });

  it('forwards an omitted dryRun as undefined', async () => {
    await request(app).post('/admin/memory-archive/promote').send({});

    expect(mockRunArchivePromotion).toHaveBeenCalledWith(expect.anything(), {
      dryRun: undefined,
    });
  });
});
