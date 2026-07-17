/**
 * Tests for the notifications/feedback retention cleanup.
 *
 * The WHERE shapes are the whole job: the standing-DM and pending carve-outs
 * are what keep /notifications cleanup and the incomplete-broadcast sweep
 * working, so they're pinned exactly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { CLEANUP_DEFAULTS } from '@tzurot/common-types/constants/timing';
import { cleanupNotificationsRetention } from './cleanupNotificationsRetention.js';

const NOW = new Date('2026-07-16T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function makePrisma() {
  return {
    userFeedback: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
    releaseDeliveryLog: { deleteMany: vi.fn().mockResolvedValue({ count: 7 }) },
  };
}

describe('cleanupNotificationsRetention', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('purges only HANDLED feedback older than the window (new rows kept forever)', async () => {
    const prisma = makePrisma();
    await cleanupNotificationsRetention(prisma as unknown as PrismaClient);

    expect(prisma.userFeedback.deleteMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['read', 'archived'] },
        createdAt: {
          lt: new Date(NOW.getTime() - CLEANUP_DEFAULTS.DAYS_TO_KEEP_HANDLED_FEEDBACK * DAY_MS),
        },
      },
    });
  });

  it('purges only SETTLED delivery rows — standing DMs and pending rows exempt', async () => {
    const prisma = makePrisma();
    await cleanupNotificationsRetention(prisma as unknown as PrismaClient);

    expect(prisma.releaseDeliveryLog.deleteMany).toHaveBeenCalledWith({
      where: {
        createdAt: {
          lt: new Date(NOW.getTime() - CLEANUP_DEFAULTS.DAYS_TO_KEEP_SETTLED_DELIVERIES * DAY_MS),
        },
        // Pending rows belong to the incomplete-broadcast sweep; deleting one
        // would manufacture the zero-pending zombie that sweep exists to heal.
        status: { not: 'pending' },
        // A sent-but-undeleted row is the user's standing DM — it backs
        // /notifications cleanup and the next blast's delete-previous.
        NOT: { sentMessageId: { not: null }, messageDeletedAt: null },
      },
    });
  });

  it('returns the per-table counts for the scheduled-run verification trail', async () => {
    const prisma = makePrisma();
    await expect(cleanupNotificationsRetention(prisma as unknown as PrismaClient)).resolves.toEqual(
      { feedbackDeleted: 2, deliveriesDeleted: 7 }
    );
  });
});
