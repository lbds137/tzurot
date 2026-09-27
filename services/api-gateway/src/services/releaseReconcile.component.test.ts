/**
 * Component test (real SQL over PGLite): the failed_transient retry path —
 * reopenTransientFailures re-opens eligible rows, and the same run's
 * sweepIncompleteBroadcasts re-enqueues them, terminalizing anyone who
 * became ineligible in the meantime.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { type PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import { createTestPGlite, loadPGliteSchema, seedUserWithPersona } from '@tzurot/test-utils';
import type { Queue } from 'bullmq';

const addValidatedJobMock = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'job-1' }));
vi.mock('../utils/validatedQueue.js', () => ({
  addValidatedJob: addValidatedJobMock,
}));

import { reopenTransientFailures, sweepIncompleteBroadcasts } from './releaseReconcile.js';

const USER_A = 'ab1e0000-0000-4000-8000-0000000000a1';
const USER_B = 'ab1e0000-0000-4000-8000-0000000000b1';
const USER_C = 'ab1e0000-0000-4000-8000-0000000000c1';
const USER_D = 'ab1e0000-0000-4000-8000-0000000000d1';
const USER_E = 'ab1e0000-0000-4000-8000-0000000000e1';
const DISCORD_A = '900000000000000101';
const DISCORD_B = '900000000000000102';
const DISCORD_C = '900000000000000103';
const DISCORD_D = '900000000000000104';
const DISCORD_E = '900000000000000105';

const RELEASE_IN = 'ab1e0000-0000-4000-8000-0000000010a1';
const RELEASE_OUT = 'ab1e0000-0000-4000-8000-0000000010b1';

const ROW_IN_A = 'ab1e0000-0000-4000-8000-00000000a0a1';
const ROW_IN_B = 'ab1e0000-0000-4000-8000-00000000a0b1';
const ROW_IN_C = 'ab1e0000-0000-4000-8000-00000000a0c1';
const ROW_IN_D = 'ab1e0000-0000-4000-8000-00000000a0d1';
const ROW_IN_E = 'ab1e0000-0000-4000-8000-00000000a0e1';
const ROW_OUT_A = 'ab1e0000-0000-4000-8000-00000000b0a1';

describe('reopenTransientFailures + sweepIncompleteBroadcasts (component, PGLite)', () => {
  let pglite: PGlite;
  let prisma: PrismaClient;
  const queue = {} as Queue;

  beforeAll(async () => {
    pglite = createTestPGlite();
    await pglite.exec(loadPGliteSchema());
    prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) }) as PrismaClient;

    await seedUserWithPersona(prisma, {
      userId: USER_A,
      personaId: 'ab1e0000-0000-4000-8000-0000000020a1',
      discordId: DISCORD_A,
      username: 'usera',
    });
    await seedUserWithPersona(prisma, {
      userId: USER_B,
      personaId: 'ab1e0000-0000-4000-8000-0000000020b1',
      discordId: DISCORD_B,
      username: 'userb',
    });
    await seedUserWithPersona(prisma, {
      userId: USER_C,
      personaId: 'ab1e0000-0000-4000-8000-0000000020c1',
      discordId: DISCORD_C,
      username: 'userc',
    });
    await seedUserWithPersona(prisma, {
      userId: USER_D,
      personaId: 'ab1e0000-0000-4000-8000-0000000020d1',
      discordId: DISCORD_D,
      username: 'userd',
    });
    await seedUserWithPersona(prisma, {
      userId: USER_E,
      personaId: 'ab1e0000-0000-4000-8000-0000000020e1',
      discordId: DISCORD_E,
      username: 'usere',
    });
    // E opted out (auto-disable / /notifications disable) sometime before this
    // run — the seam this test proves: a row reopened to pending must still
    // be re-terminalized if the user is no longer eligible.
    await prisma.user.update({ where: { id: USER_E }, data: { notifyEnabled: false } });

    const now = Date.now();
    // level: 'major' — eligibleThresholds('major') is every notifyLevel, so
    // eligibility here turns only on notifyEnabled (every seeded user keeps
    // the schema default notifyLevel='major').
    await prisma.releaseAnnouncement.create({
      data: {
        id: RELEASE_IN,
        version: 'v-in-window',
        level: 'major',
        githubReleaseId: '101',
        body: 'notes',
        createdAt: new Date(now - 2 * 60 * 60 * 1000),
        completedAt: new Date(now - 60 * 60 * 1000),
      },
    });
    await prisma.releaseAnnouncement.create({
      data: {
        id: RELEASE_OUT,
        version: 'v-out-of-window',
        level: 'major',
        githubReleaseId: '102',
        body: 'notes',
        createdAt: new Date(now - 25 * 60 * 60 * 1000),
        completedAt: new Date(now - 24 * 60 * 60 * 1000),
      },
    });

    await prisma.releaseDeliveryLog.createMany({
      data: [
        { id: ROW_IN_A, releaseId: RELEASE_IN, userId: USER_A, status: 'failed_transient' },
        {
          id: ROW_IN_B,
          releaseId: RELEASE_IN,
          userId: USER_B,
          status: 'failed_permanent',
          errorCode: '50007',
        },
        { id: ROW_IN_C, releaseId: RELEASE_IN, userId: USER_C, status: 'failed_bot_level' },
        { id: ROW_IN_D, releaseId: RELEASE_IN, userId: USER_D, status: 'sent' },
        { id: ROW_IN_E, releaseId: RELEASE_IN, userId: USER_E, status: 'failed_transient' },
        { id: ROW_OUT_A, releaseId: RELEASE_OUT, userId: USER_A, status: 'failed_transient' },
      ],
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pglite.close();
  });

  it('reopens the in-window failed_transient rows, re-enqueues the still-eligible one, and re-terminalizes the opted-out one', async () => {
    await reopenTransientFailures(prisma);
    await sweepIncompleteBroadcasts({ prisma, queue });

    // Exactly one batch enqueued, for A only — E must not be in it.
    expect(addValidatedJobMock).toHaveBeenCalledTimes(1);
    const jobData = addValidatedJobMock.mock.calls[0][2] as {
      recipients: { deliveryLogId: string }[];
    };
    expect(jobData.recipients).toHaveLength(1);
    expect(jobData.recipients[0].deliveryLogId).toBe(ROW_IN_A);

    // A: reopened to pending by reopenTransientFailures, left pending by the
    // sweep (re-enqueued, not stamped).
    const rowA = await prisma.releaseDeliveryLog.findUniqueOrThrow({ where: { id: ROW_IN_A } });
    expect(rowA.status).toBe('pending');
    expect(rowA.errorCode).toBeNull();

    // E: reopened to pending, then re-terminalized as opted-out by the
    // sweep's eligibility re-check.
    const rowE = await prisma.releaseDeliveryLog.findUniqueOrThrow({ where: { id: ROW_IN_E } });
    expect(rowE.status).toBe('failed_permanent');
    expect(rowE.errorCode).toBe('opted_out');

    // B, C, D: untouched — reopenTransientFailures only targets
    // failed_transient, and the sweep only acts on pending rows.
    const rowB = await prisma.releaseDeliveryLog.findUniqueOrThrow({ where: { id: ROW_IN_B } });
    expect(rowB.status).toBe('failed_permanent');
    expect(rowB.errorCode).toBe('50007');
    const rowC = await prisma.releaseDeliveryLog.findUniqueOrThrow({ where: { id: ROW_IN_C } });
    expect(rowC.status).toBe('failed_bot_level');
    expect(rowC.errorCode).toBeNull();
    const rowD = await prisma.releaseDeliveryLog.findUniqueOrThrow({ where: { id: ROW_IN_D } });
    expect(rowD.status).toBe('sent');

    // OUT announcement/row: outside the retry window, untouched by either pass.
    const rowOutA = await prisma.releaseDeliveryLog.findUniqueOrThrow({ where: { id: ROW_OUT_A } });
    expect(rowOutA.status).toBe('failed_transient');
    const announcementOut = await prisma.releaseAnnouncement.findUniqueOrThrow({
      where: { id: RELEASE_OUT },
    });
    expect(announcementOut.completedAt).not.toBeNull();

    // IN announcement: reopened to incomplete by reopenTransientFailures, and
    // still incomplete after the sweep (A's still-eligible row keeps it open).
    const announcementIn = await prisma.releaseAnnouncement.findUniqueOrThrow({
      where: { id: RELEASE_IN },
    });
    expect(announcementIn.completedAt).toBeNull();
  });
});
