/**
 * Component test: the notify pipeline's write seams over REAL PGLite — the
 * grace-clock stamp (one notice per spell), the bounce re-route into the
 * unreachable purge branch, and the enqueue path's cohort resolution with a
 * schema-validated batch payload.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { type PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import type { Queue } from 'bullmq';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import { createTestPGlite, loadPGliteSchema, seedUserWithPersona } from '@tzurot/test-utils';
import { RetentionNotifyService } from './RetentionNotifyService.js';
import { selectEligibleUsers } from './eligibility.js';

vi.mock('@tzurot/common-types/utils/outboundDmAllowlist', () => ({
  getOutboundDmAllowlist: () => null,
}));

const OLD = new Date('2020-01-01T00:00:00Z');

const NOTIFY_TARGET = 'c0408000-0000-4000-8000-000000000001';
const ACTIVE_USER = 'c0408000-0000-4000-8000-000000000002';

let seq = 0;
const nextId = (): string =>
  `c0408000-0000-4000-8000-0000000001${(seq++).toString().padStart(2, '0')}`;

describe('RetentionNotifyService (component, PGLite)', () => {
  let pglite: PGlite;
  let prisma: PrismaClient;
  let service: RetentionNotifyService;

  beforeAll(async () => {
    pglite = createTestPGlite();
    await pglite.exec(loadPGliteSchema());
    prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) }) as PrismaClient;
    service = new RetentionNotifyService(prisma);

    for (const [id, name] of [
      [NOTIFY_TARGET, 'notifytarget'],
      [ACTIVE_USER, 'activeuser'],
    ] as const) {
      await seedUserWithPersona(prisma, {
        userId: id,
        personaId: nextId(),
        discordId: `9100000000000000${(seq + 10).toString().padStart(2, '0')}`,
        username: name,
        personaName: `${name} Persona`,
        personaContent: 'x',
      });
    }
    // Deliberate-use stamp: only accounts that actually used the bot get the
    // warning DM (bystander-shaped rows purge without notice instead).
    await prisma.$executeRaw`
      UPDATE users SET last_active_at = ${OLD}, notify_opted_in_at = ${OLD}
      WHERE id = ${NOTIFY_TARGET}::uuid
    `;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pglite.close();
  });

  it('enqueues the reachable-inactive cohort as a schema-valid batch', async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const queue = { add: vi.fn().mockResolvedValue(undefined) } as unknown as Queue;
    (queue as unknown as { add: typeof add }).add = add;

    // 1 of 2 fixture users = 50% — over the hard ceiling by construction, so
    // the override is required here; the ceiling's own behavior is unit-tested.
    const result = await service.enqueueNotifyRun(queue, {
      now: () => new Date(0),
      breakerOverride: true,
    });

    expect(result.status).toBe('enqueued');
    expect(result.cohortSize).toBe(1);
    // addValidatedJob parsed the payload against the job schema before this
    // reached the queue — a malformed batch would have thrown, not enqueued.
    expect(add).toHaveBeenCalledTimes(1);
    const [, payload, opts] = add.mock.calls[0] as [
      string,
      { recipients: unknown[] },
      { jobId: string },
    ];
    expect(payload.recipients).toHaveLength(1);
    expect(opts.jobId).toMatch(/^retention-notify-/);
    expect(opts.jobId).not.toContain(':');
  });

  it('stamps the grace clock exactly once on sent (one notice per spell)', async () => {
    const processed = await service.reportOutcomes([{ userId: NOTIFY_TARGET, status: 'sent' }]);
    expect(processed).toBe(1);

    const first = await prisma.user.findUnique({ where: { id: NOTIFY_TARGET } });
    expect(first?.retentionNotifiedAt).not.toBeNull();

    // A worker-retry re-report must not advance the clock (IS NULL guard).
    await service.reportOutcomes([{ userId: NOTIFY_TARGET, status: 'sent' }]);
    const second = await prisma.user.findUnique({ where: { id: NOTIFY_TARGET } });
    expect(second?.retentionNotifiedAt?.getTime()).toBe(first?.retentionNotifiedAt?.getTime());
  });

  it('drops a warned user from the notify cohort and the eligibility filter', async () => {
    // NOTIFY_TARGET now carries a grace stamp (previous test): the one-notice
    // guard excludes them from selection and from the send-time re-check.
    const eligible = await service.filterEligible([NOTIFY_TARGET, ACTIVE_USER]);
    expect(eligible).toEqual([]);

    const queue = { add: vi.fn() } as unknown as Queue;
    const rerun = await service.enqueueNotifyRun(queue, { now: () => new Date(0) });
    expect(rerun.status).toBe('empty');
  });

  it('re-routes a bounced notice into the unreachable purge branch (real SQL)', async () => {
    await service.reportOutcomes([
      { userId: NOTIFY_TARGET, status: 'failed_permanent', errorCode: '50278' },
    ]);

    const row = await prisma.user.findUnique({ where: { id: NOTIFY_TARGET } });
    expect(row?.dmUndeliverableSince).not.toBeNull();
    // The whole point of cohort discovery: the bounced user is now in the
    // PURGE cohort, labeled unreachable (stamp outranks the grace clock).
    const cohort = await selectEligibleUsers(prisma);
    expect(cohort.map(r => r.userId)).toContain(NOTIFY_TARGET);
    expect(cohort.find(r => r.userId === NOTIFY_TARGET)?.reason).toBe('unreachable');
  });
});
