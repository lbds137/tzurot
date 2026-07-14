/**
 * Producer half of the api-gateway → bot-client release-broadcast contract.
 *
 * Runs the REAL `enqueueBroadcast()` and snapshots the captured `queue.add`
 * payload (one DM batch) to a committed JSON fixture under `@tzurot/test-utils`
 * (`fixtures/contracts/release-broadcast/`). `--update` regenerates; CI
 * COMPARES (strict). Drift in the producer's batch shape → CI fails here.
 *
 * The consumer half (`tests/e2e/contracts/ReleaseBroadcastDm.contract.test.ts`)
 * reads the SAME fixture and validates it against the DM worker's entry schema
 * (`releaseBroadcastDmJobDataSchema` — the worker's safeParse gate). The
 * committed fixture IS the contract artifact — the two services share data,
 * not code (depcruise boundary intact), and the payload is REAL producer
 * output, not a hand-written shape that trivially satisfies its own schema.
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

import { enqueueBroadcast } from './releaseBroadcast.js';

// Deterministic recipients: internal ids derived from fixed snowflakes, so the
// fixture is byte-stable across runs.
const RECIPIENTS = [
  { discordId: '111111111111111111', username: 'contract-alice' },
  { discordId: '222222222222222222', username: 'contract-bob' },
].map(user => ({ id: generateUserUuid(user.discordId), ...user }));

describe('Contract producer: release-broadcast DM batch (real enqueueBroadcast output)', () => {
  it('captures the enqueued batch payload as the committed contract fixture', async () => {
    const prisma = {
      user: { findMany: vi.fn().mockResolvedValue(RECIPIENTS) },
      releaseAnnouncement: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
      releaseDeliveryLog: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
    } as unknown as PrismaClient;
    const added: unknown[] = [];
    const queue = {
      add: (name: string, data: unknown, opts?: unknown) => {
        added.push({ name, data, opts });
        return Promise.resolve({ id: 'contract-job' });
      },
    } as unknown as Queue;

    const result = await enqueueBroadcast(prisma, queue, {
      version: 'contract-fixture-1',
      level: 'minor',
      body: 'Contract fixture body',
    });

    expect(result.ok).toBe(true);
    expect(added).toHaveLength(1);

    await expect(stableFixtureJson(added[0])).toMatchFileSnapshot(
      contractFixtureFile('release-broadcast/batch.json')
    );
  });
});
