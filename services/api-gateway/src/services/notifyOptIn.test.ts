/**
 * Tests for the first-deliberate-use notifyOptedInAt stamp.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { stampNotifyOptedIn, liftNotifyAutoDisable } from './notifyOptIn.js';

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

describe('liftNotifyAutoDisable', () => {
  it('re-enables ONLY when the auto-disable flag is set (explicit opt-outs have it null)', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = { user: { updateMany } } as unknown as PrismaClient;

    await liftNotifyAutoDisable(prisma, USER_ID);

    // The where-guard IS the opt-out protection: a user-chosen disable never
    // sets notifyAutoDisabledAt, so this update cannot match their row.
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: USER_ID, notifyAutoDisabledAt: { not: null } },
      data: { notifyEnabled: true, notifyAutoDisabledAt: null },
    });
  });

  it('propagates a write failure (callers choose their own best-effort wrapping)', async () => {
    const updateMany = vi.fn().mockRejectedValue(new Error('db down'));
    const prisma = { user: { updateMany } } as unknown as PrismaClient;

    await expect(liftNotifyAutoDisable(prisma, USER_ID)).rejects.toThrow('db down');
  });
});
