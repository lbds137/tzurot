/**
 * Producer half of the api-gateway → bot-client retention-notify contract.
 *
 * Runs the REAL `RetentionNotifyService.enqueueNotifyRun()` and snapshots the
 * captured `queue.add` payload (one warning-DM batch) to a committed JSON
 * fixture under `@tzurot/test-utils` (`fixtures/contracts/retention-notify/`).
 * `--update` regenerates; CI COMPARES (strict). Drift in the producer's batch
 * shape → CI fails here.
 *
 * The consumer half (`tests/e2e/contracts/RetentionNotifyDm.contract.test.ts`)
 * reads the SAME fixture and validates it against the notify worker's entry
 * schema (`retentionNotifyDmJobDataSchema` — the worker's safeParse gate).
 * The committed fixture IS the contract artifact — the two services share
 * data, not code, and the payload is REAL producer output.
 */

import { describe, it, expect, vi } from 'vitest';
import { contractFixtureFile, stableFixtureJson } from '@tzurot/test-utils';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { Queue } from 'bullmq';
import { generateUserUuid } from '@tzurot/common-types/utils/deterministicUuid';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});
vi.mock('@tzurot/common-types/utils/outboundDmAllowlist', () => ({
  getOutboundDmAllowlist: () => null,
}));

import { RetentionNotifyService } from './RetentionNotifyService.js';

// Deterministic cohort: internal ids derived from fixed snowflakes and a fixed
// inactivity anchor, so the fixture is byte-stable across runs.
const COHORT_ROWS = [{ discordId: '111111111111111111' }, { discordId: '222222222222222222' }].map(
  user => ({
    userId: generateUserUuid(user.discordId),
    discordId: user.discordId,
    inactiveSince: new Date('2025-01-01T00:00:00.000Z'),
  })
);

describe('Contract producer: retention-notify DM batch (real enqueueNotifyRun output)', () => {
  it('captures the enqueued batch payload as the committed contract fixture', async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue(COHORT_ROWS),
      user: { count: vi.fn().mockResolvedValue(100) },
    } as unknown as PrismaClient;
    const added: unknown[] = [];
    const queue = {
      add: (name: string, data: unknown, opts?: unknown) => {
        added.push({ name, data, opts });
        return Promise.resolve({ id: 'contract-job' });
      },
    } as unknown as Queue;

    const result = await new RetentionNotifyService(prisma).enqueueNotifyRun(queue, {
      runContext: 'contract-fixture',
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(result.status).toBe('enqueued');
    expect(added).toHaveLength(1);

    await expect(stableFixtureJson(added[0])).toMatchFileSnapshot(
      contractFixtureFile('retention-notify/batch.json')
    );
  });
});
