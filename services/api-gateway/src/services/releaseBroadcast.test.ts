/**
 * Tests for release-broadcast resolution + enqueue orchestration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { Queue } from 'bullmq';
import { JobType } from '@tzurot/common-types/constants/queue';
import {
  generateReleaseAnnouncementUuid,
  generateReleaseDeliveryLogUuid,
} from '@tzurot/common-types/utils/deterministicUuid';

const allowlistMock = vi.hoisted(() => ({ value: null as ReadonlySet<string> | null }));
vi.mock('@tzurot/common-types/utils/outboundDmAllowlist', () => ({
  getOutboundDmAllowlist: () => allowlistMock.value,
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

const { eligibleThresholds, resolveEligibleRecipients, enqueueBroadcast, BROADCAST_BATCH_SIZE } =
  await import('./releaseBroadcast.js');

const USER_A = '423e4567-e89b-42d3-a456-426614174000';
const USER_B = '523e4567-e89b-42d3-a456-426614174000';

function makePrisma() {
  return {
    user: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    releaseAnnouncement: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
    releaseDeliveryLog: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

function makeQueue() {
  return { add: vi.fn().mockResolvedValue({ id: 'job-1' }) };
}

describe('eligibleThresholds', () => {
  it('major reaches every threshold', () => {
    expect(eligibleThresholds('major')).toEqual(['major', 'minor', 'patch']);
  });

  it('minor reaches minor and patch thresholds', () => {
    expect(eligibleThresholds('minor')).toEqual(['minor', 'patch']);
  });

  it('patch reaches only the patch threshold', () => {
    expect(eligibleThresholds('patch')).toEqual(['patch']);
  });
});

describe('resolveEligibleRecipients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allowlistMock.value = null;
  });

  it('narrows the WHERE clause to the allowlist when set (dev outbound gate)', async () => {
    allowlistMock.value = new Set(['111']);
    const prisma = makePrisma();
    prisma.user.findMany.mockResolvedValueOnce([
      { id: USER_A, discordId: '111', username: 'owner' },
    ]);

    await resolveEligibleRecipients(prisma as unknown as PrismaClient, 'major');

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          notifyEnabled: true,
          notifyLevel: { in: ['major', 'minor', 'patch'] },
          discordId: { in: ['111'] },
        },
      })
    );
  });

  it('queries opted-in users at the level thresholds', async () => {
    const prisma = makePrisma();
    prisma.user.findMany.mockResolvedValueOnce([
      { id: USER_A, discordId: '111', username: 'alice' },
    ]);

    const recipients = await resolveEligibleRecipients(prisma as unknown as PrismaClient, 'minor');

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { notifyEnabled: true, notifyLevel: { in: ['minor', 'patch'] } },
        take: 500,
      })
    );
    expect(recipients).toEqual([{ userId: USER_A, discordUserId: '111', username: 'alice' }]);
  });

  it('paginates with a cursor until a short page arrives', async () => {
    const prisma = makePrisma();
    const fullPage = Array.from({ length: 500 }, (_unused, i) => ({
      id: `id-${String(i).padStart(3, '0')}`,
      discordId: `d${i}`,
      username: `u${i}`,
    }));
    prisma.user.findMany
      .mockResolvedValueOnce(fullPage)
      .mockResolvedValueOnce([{ id: 'id-tail', discordId: 'dt', username: 'ut' }]);

    const recipients = await resolveEligibleRecipients(prisma as unknown as PrismaClient, 'major');

    expect(prisma.user.findMany).toHaveBeenCalledTimes(2);
    const secondCall = prisma.user.findMany.mock.calls[1][0] as { cursor?: { id: string } };
    expect(secondCall.cursor).toEqual({ id: 'id-499' });
    expect(recipients).toHaveLength(501);
  });
});

describe('enqueueBroadcast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an already-announced version without writing anything', async () => {
    const prisma = makePrisma();
    prisma.releaseAnnouncement.findUnique.mockResolvedValueOnce({ id: 'existing' });
    const queue = makeQueue();

    const result = await enqueueBroadcast(
      prisma as unknown as PrismaClient,
      queue as unknown as Queue,
      { version: 'v1', level: 'major', body: 'hi' }
    );

    expect(result).toEqual({ ok: false, reason: 'already-announced' });
    expect(prisma.releaseAnnouncement.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('creates the announcement + pending logs and enqueues deterministic batches', async () => {
    const prisma = makePrisma();
    prisma.user.findMany.mockResolvedValueOnce([
      { id: USER_A, discordId: '111', username: 'alice' },
      { id: USER_B, discordId: '222', username: 'bob' },
    ]);
    const queue = makeQueue();

    const result = await enqueueBroadcast(
      prisma as unknown as PrismaClient,
      queue as unknown as Queue,
      { version: 'adhoc-1', level: 'major', body: 'hi' }
    );

    const releaseId = generateReleaseAnnouncementUuid('adhoc-1');
    expect(result).toEqual({ ok: true, releaseId, recipients: 2, batches: 1 });

    expect(prisma.releaseAnnouncement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ id: releaseId, version: 'adhoc-1', level: 'major' }),
    });
    expect(prisma.releaseDeliveryLog.createMany).toHaveBeenCalledWith({
      data: [
        { id: generateReleaseDeliveryLogUuid(releaseId, USER_A), releaseId, userId: USER_A },
        { id: generateReleaseDeliveryLogUuid(releaseId, USER_B), releaseId, userId: USER_B },
      ],
      skipDuplicates: true,
    });

    expect(queue.add).toHaveBeenCalledTimes(1);
    const [jobName, payload, opts] = queue.add.mock.calls[0] as [
      string,
      { recipients: unknown[] },
      { jobId: string },
    ];
    expect(jobName).toBe(JobType.ReleaseBroadcastDm);
    expect(payload.recipients).toHaveLength(2);
    expect(opts.jobId).toBe(`release-broadcast:${releaseId}:0`);
  });

  it("attaches each recipient's standing prior DM as previousDm", async () => {
    const prisma = makePrisma();
    prisma.user.findMany.mockResolvedValueOnce([
      { id: USER_A, discordId: '111', username: 'alice' },
      { id: USER_B, discordId: '222', username: 'bob' },
    ]);
    // Only alice has a standing prior release DM.
    prisma.releaseDeliveryLog.findMany.mockResolvedValueOnce([
      { id: '723e4567-e89b-42d3-a456-426614174000', userId: USER_A, sentMessageId: 'old-msg-1' },
    ]);
    const queue = makeQueue();

    await enqueueBroadcast(prisma as unknown as PrismaClient, queue as unknown as Queue, {
      version: 'adhoc-2',
      level: 'major',
      body: 'hi',
    });

    const releaseId = generateReleaseAnnouncementUuid('adhoc-2');
    // The lookup excludes the release being enqueued and already-deleted rows,
    // and picks one newest row per user.
    expect(prisma.releaseDeliveryLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: { in: [USER_A, USER_B] },
          releaseId: { not: releaseId },
          sentMessageId: { not: null },
          messageDeletedAt: null,
        },
        distinct: ['userId'],
      })
    );

    const payload = queue.add.mock.calls[0][1] as {
      recipients: { userId: string; previousDm?: { deliveryLogId: string; messageId: string } }[];
    };
    const alice = payload.recipients.find(r => r.userId === USER_A);
    const bob = payload.recipients.find(r => r.userId === USER_B);
    expect(alice?.previousDm).toEqual({
      deliveryLogId: '723e4567-e89b-42d3-a456-426614174000',
      messageId: 'old-msg-1',
    });
    expect(bob?.previousDm).toBeUndefined();
  });

  it('splits recipients into batches at the cap', async () => {
    const prisma = makePrisma();
    prisma.user.findMany.mockResolvedValueOnce(
      Array.from({ length: BROADCAST_BATCH_SIZE + 1 }, (_unused, i) => ({
        id: `${String(i).padStart(8, '0')}-e89b-42d3-a456-426614174000`,
        discordId: `d${i}`,
        username: `u${i}`,
      }))
    );
    const queue = makeQueue();

    const result = await enqueueBroadcast(
      prisma as unknown as PrismaClient,
      queue as unknown as Queue,
      { version: 'adhoc-2', level: 'major', body: 'hi' }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.batches).toBe(2);
    }
    expect(queue.add).toHaveBeenCalledTimes(2);
  });

  it('resolves a create-time unique violation (concurrent same-version race) to already-announced', async () => {
    const prisma = makePrisma();
    prisma.user.findMany.mockResolvedValueOnce([
      { id: USER_A, discordId: '111', username: 'alice' },
    ]);
    prisma.releaseAnnouncement.create.mockRejectedValueOnce({ code: 'P2002' });
    const queue = makeQueue();

    const result = await enqueueBroadcast(
      prisma as unknown as PrismaClient,
      queue as unknown as Queue,
      { version: 'racing-version', level: 'major', body: 'hi' }
    );

    expect(result).toEqual({ ok: false, reason: 'already-announced' });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('completes at birth when nobody is eligible', async () => {
    const prisma = makePrisma();
    const queue = makeQueue();

    const result = await enqueueBroadcast(
      prisma as unknown as PrismaClient,
      queue as unknown as Queue,
      { version: 'adhoc-3', level: 'patch', body: 'hi' }
    );

    expect(result).toEqual({
      ok: true,
      releaseId: generateReleaseAnnouncementUuid('adhoc-3'),
      recipients: 0,
      batches: 0,
    });
    const createArg = prisma.releaseAnnouncement.create.mock.calls[0][0] as {
      data: { completedAt?: Date };
    };
    expect(createArg.data.completedAt).toBeInstanceOf(Date);
    expect(prisma.releaseDeliveryLog.createMany).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });
});
