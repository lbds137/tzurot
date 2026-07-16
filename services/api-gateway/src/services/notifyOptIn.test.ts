/**
 * Tests for the first-deliberate-use notifyOptedInAt stamp.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { stampNotifyOptedIn } from './notifyOptIn.js';

const USER_ID = '423e4567-e89b-42d3-a456-426614174000';

describe('stampNotifyOptedIn', () => {
  it('stamps only a null timestamp (never overwrites the first stamp)', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = { user: { updateMany } } as unknown as PrismaClient;

    await stampNotifyOptedIn(prisma, USER_ID);

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: USER_ID, notifyOptedInAt: null },
      data: { notifyOptedInAt: expect.any(Date) },
    });
  });

  it('propagates a write failure — the stamp is load-bearing for opt-up, not best-effort', async () => {
    const updateMany = vi.fn().mockRejectedValue(new Error('db down'));
    const prisma = { user: { updateMany } } as unknown as PrismaClient;

    await expect(stampNotifyOptedIn(prisma, USER_ID)).rejects.toThrow('db down');
  });
});
