/**
 * Tests for /user/notifications routes
 *
 * The generated mounts call the handler factories directly (no local router),
 * so these tests invoke the handlers the same way.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

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

vi.mock('../../utils/asyncHandler.js', () => ({
  asyncHandler: vi.fn(fn => fn),
}));

const mockPrisma = {
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  releaseDeliveryLog: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
};

import {
  handleGetNotificationPrefs,
  handleUpdateNotificationPrefs,
  handleListReleaseDms,
  handleMarkReleaseDmsDeleted,
} from './notifications.js';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { stubRouteResolvers } from '../../test/shared-route-test-utils.js';
import type { RouteDeps } from '../routeDeps.js';

function makeDeps(): RouteDeps {
  return {
    ...stubRouteResolvers(),
    prisma: mockPrisma as unknown as PrismaClient,
  } as unknown as RouteDeps;
}

function createMockReqRes(body: Record<string, unknown> = {}) {
  const req = {
    body,
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

describe('GET /user/notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the stored prefs', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      notifyEnabled: true,
      notifyLevel: 'minor',
    });

    const handler = handleGetNotificationPrefs(makeDeps());
    const { req, res } = createMockReqRes();
    await handler(req, res, vi.fn());

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-uuid-123' },
      select: { notifyEnabled: true, notifyLevel: true },
    });
    expect(res.json).toHaveBeenCalledWith({ enabled: true, level: 'minor' });
  });

  it('returns 404 when the user row is missing', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);

    const handler = handleGetNotificationPrefs(makeDeps());
    const { req, res } = createMockReqRes();
    await handler(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('PATCH /user/notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates only the provided field (enabled)', async () => {
    mockPrisma.user.update.mockResolvedValueOnce({
      notifyEnabled: false,
      notifyLevel: 'minor',
    });

    const handler = handleUpdateNotificationPrefs(makeDeps());
    const { req, res } = createMockReqRes({ enabled: false });
    await handler(req, res, vi.fn());

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-uuid-123' },
      data: { notifyEnabled: false },
      select: { notifyEnabled: true, notifyLevel: true },
    });
    expect(res.json).toHaveBeenCalledWith({ success: true, enabled: false, level: 'minor' });
  });

  it('updates only the provided field (level)', async () => {
    mockPrisma.user.update.mockResolvedValueOnce({
      notifyEnabled: true,
      notifyLevel: 'patch',
    });

    const handler = handleUpdateNotificationPrefs(makeDeps());
    const { req, res } = createMockReqRes({ level: 'patch' });
    await handler(req, res, vi.fn());

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-uuid-123' },
      data: { notifyLevel: 'patch' },
      select: { notifyEnabled: true, notifyLevel: true },
    });
    expect(res.json).toHaveBeenCalledWith({ success: true, enabled: true, level: 'patch' });
  });

  it('updates both fields together', async () => {
    mockPrisma.user.update.mockResolvedValueOnce({
      notifyEnabled: true,
      notifyLevel: 'major',
    });

    const handler = handleUpdateNotificationPrefs(makeDeps());
    const { req, res } = createMockReqRes({ enabled: true, level: 'major' });
    await handler(req, res, vi.fn());

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-uuid-123' },
      data: { notifyEnabled: true, notifyLevel: 'major' },
      select: { notifyEnabled: true, notifyLevel: true },
    });
  });

  it('stamps notifyOptedInAt on an explicit prefs update (deliberate use)', async () => {
    mockPrisma.user.update.mockResolvedValueOnce({
      notifyEnabled: true,
      notifyLevel: 'patch',
    });

    const handler = handleUpdateNotificationPrefs(makeDeps());
    const { req, res } = createMockReqRes({ level: 'patch' });
    await handler(req, res, vi.fn());

    expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user-uuid-123', notifyOptedInAt: null },
      data: { notifyOptedInAt: expect.any(Date) },
    });
  });

  it('stamps notifyOptedInAt even on opt-down, so a later re-enable is eligible', async () => {
    mockPrisma.user.update.mockResolvedValueOnce({
      notifyEnabled: false,
      notifyLevel: 'major',
    });

    const handler = handleUpdateNotificationPrefs(makeDeps());
    const { req, res } = createMockReqRes({ enabled: false });
    await handler(req, res, vi.fn());

    expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user-uuid-123', notifyOptedInAt: null },
      data: { notifyOptedInAt: expect.any(Date) },
    });
  });

  it('rejects an empty patch with 400 and does not touch the DB', async () => {
    const handler = handleUpdateNotificationPrefs(makeDeps());
    const { req, res } = createMockReqRes({});
    await handler(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
    expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an unknown level with 400', async () => {
    const handler = handleUpdateNotificationPrefs(makeDeps());
    const { req, res } = createMockReqRes({ level: 'prerelease' });
    await handler(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
    expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
  });
});

describe('GET /user/notifications/release-dms', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns standing release DMs scoped to the provisioned user', async () => {
    mockPrisma.releaseDeliveryLog.findMany.mockResolvedValueOnce([
      { id: 'log-1', sentMessageId: 'msg-1' },
      { id: 'log-2', sentMessageId: 'msg-2' },
    ]);
    const handler = handleListReleaseDms(makeDeps());
    const { req, res } = createMockReqRes();

    await handler(req, res, vi.fn());

    expect(mockPrisma.releaseDeliveryLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-uuid-123', sentMessageId: { not: null }, messageDeletedAt: null },
      })
    );
    expect(res.json).toHaveBeenCalledWith({
      messages: [
        { deliveryLogId: 'log-1', messageId: 'msg-1' },
        { deliveryLogId: 'log-2', messageId: 'msg-2' },
      ],
    });
  });

  it('returns an empty list when nothing is standing', async () => {
    mockPrisma.releaseDeliveryLog.findMany.mockResolvedValueOnce([]);
    const handler = handleListReleaseDms(makeDeps());
    const { req, res } = createMockReqRes();

    await handler(req, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith({ messages: [] });
  });
});

describe('POST /user/notifications/release-dms/deleted', () => {
  const LOG_1 = '123e4567-e89b-42d3-a456-426614174001';
  const LOG_2 = '123e4567-e89b-42d3-a456-426614174002';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stamps only rows owned by the caller (ownership in the WHERE)', async () => {
    mockPrisma.releaseDeliveryLog.updateMany.mockResolvedValueOnce({ count: 2 });
    const handler = handleMarkReleaseDmsDeleted(makeDeps());
    const { req, res } = createMockReqRes({ deliveryLogIds: [LOG_1, LOG_2] });

    await handler(req, res, vi.fn());

    expect(mockPrisma.releaseDeliveryLog.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: [LOG_1, LOG_2] },
        userId: 'user-uuid-123',
        messageDeletedAt: null,
      },
      data: { messageDeletedAt: expect.any(Date) },
    });
    expect(res.json).toHaveBeenCalledWith({ success: true, marked: 2 });
  });

  it('rejects an empty id list with 400 and does not touch the DB', async () => {
    const handler = handleMarkReleaseDmsDeleted(makeDeps());
    const { req, res } = createMockReqRes({ deliveryLogIds: [] });

    await handler(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockPrisma.releaseDeliveryLog.updateMany).not.toHaveBeenCalled();
  });
});
