/**
 * Tests for the internal release-reconcile trigger route.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { Queue } from 'bullmq';

vi.mock('../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
}));

const configMock = vi.hoisted(() => ({
  value: { GITHUB_API_TOKEN: undefined as string | undefined },
}));
vi.mock('@tzurot/common-types/config/config', () => ({
  getConfig: () => configMock.value,
}));

const reconcileMock = vi.hoisted(() => vi.fn());
const fetcherFactoryMock = vi.hoisted(() => vi.fn());
vi.mock('../../services/releaseReconcile.js', () => ({
  reconcileReleaseAnnouncements: reconcileMock,
  createGitHubReleasesFetcher: fetcherFactoryMock,
}));

import { handleReleaseBroadcastReconcile } from './releaseReconcile.js';
import type { RouteDeps } from '../routeDeps.js';

const prisma = {} as PrismaClient;
const queue = {} as Queue;

function makeDeps(withQueue = true): RouteDeps {
  return {
    prisma,
    ...(withQueue ? { releaseBroadcastQueue: queue } : {}),
  } as unknown as RouteDeps;
}

function createMockReqRes(body: unknown) {
  const req = { body } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { req, res };
}

const SUMMARY = {
  checked: 1,
  announced: ['v3.0.0-beta.166'],
  alreadyAnnounced: 0,
  skipped: 0,
  capped: false,
};

describe('POST /internal/release-broadcast/reconcile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configMock.value = { GITHUB_API_TOKEN: undefined };
    reconcileMock.mockResolvedValue(SUMMARY);
    fetcherFactoryMock.mockReturnValue(() => Promise.resolve([]));
  });

  it('503s when the broadcast queue dependency is missing', async () => {
    const handler = handleReleaseBroadcastReconcile(makeDeps(false));
    const { req, res } = createMockReqRes({});
    await handler(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(503);
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it('400s an out-of-range lookbackHours', async () => {
    const handler = handleReleaseBroadcastReconcile(makeDeps());
    const { req, res } = createMockReqRes({ lookbackHours: 200 });
    await handler(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it('runs the sweep with defaults on an empty body and returns the summary', async () => {
    const handler = handleReleaseBroadcastReconcile(makeDeps());
    const { req, res } = createMockReqRes({});
    await handler(req, res, vi.fn());

    expect(reconcileMock).toHaveBeenCalledWith(
      expect.objectContaining({ prisma, queue }),
      // No lookbackHours override — the sweep applies its own default.
      {}
    );
    expect(res.json).toHaveBeenCalledWith(SUMMARY);
  });

  it('threads a valid lookbackHours through to the sweep', async () => {
    const handler = handleReleaseBroadcastReconcile(makeDeps());
    const { req, res } = createMockReqRes({ lookbackHours: 72 });
    await handler(req, res, vi.fn());
    expect(reconcileMock).toHaveBeenCalledWith(expect.anything(), { lookbackHours: 72 });
  });

  it('builds the fetcher with the configured token, and without one when unset', async () => {
    configMock.value = { GITHUB_API_TOKEN: 'github_pat_y' };
    const handler = handleReleaseBroadcastReconcile(makeDeps());
    const { req, res } = createMockReqRes({});
    await handler(req, res, vi.fn());
    expect(fetcherFactoryMock).toHaveBeenCalledWith({ token: 'github_pat_y' });

    configMock.value = { GITHUB_API_TOKEN: undefined };
    const second = createMockReqRes({});
    await handler(second.req, second.res, vi.fn());
    expect(fetcherFactoryMock).toHaveBeenLastCalledWith({});
  });
});
