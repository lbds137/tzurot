/**
 * Tests for the live retention run's notify/purge/reconcile steps.
 */

import { describe, it, expect, vi } from 'vitest';
import type { RetentionPurgeResponse } from '@tzurot/common-types/schemas/api/internal';
import {
  callRetentionNotify,
  executeLiveRun,
  LIVE_RUN_CONTEXT,
  MAX_CONSECUTIVE_PURGE_FAILURES,
  MAX_RECONCILE_ITERATIONS,
  type LiveRunClient,
} from './retentionLiveRun.js';
import type { RetentionPreviewUser } from './types.js';

const RUN_ID = '3f2b8c1e-9d4a-4c5b-8e7f-1a2b3c4d5e6f';

function makeUser(id: string): RetentionPreviewUser {
  return {
    discordId: id,
    username: `user-${id}`,
    inactiveSince: '2025-09-01T00:00:00.000Z',
    reason: 'unreachable',
    ownedCharacters: { toDelete: 1, toReHome: 0 },
  } satisfies RetentionPreviewUser;
}

function makePreview(users: RetentionPreviewUser[]) {
  return {
    users,
    totals: {
      eligibleCount: users.length,
      userbaseCount: 300,
      percentOfUserbase: 1,
      charactersToDelete: users.length,
      charactersToReHome: 0,
      breakerWarning: false,
      reachableToNotify: 0,
      inGrace: 0,
      graceExpired: 0,
      bystander: 0,
      reminderDue: 0,
      scope: { kind: 'unrestricted' as const, excludedEligibleCount: 0 },
    },
  };
}

function makeClient(): LiveRunClient & {
  retentionNotify: ReturnType<typeof vi.fn>;
  retentionPurge: ReturnType<typeof vi.fn>;
  retentionReconcileOffDb: ReturnType<typeof vi.fn>;
} {
  return {
    retentionNotify: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        status: 'empty',
        cohortSize: 0,
        userbaseCount: 300,
        percentOfUserbase: 0,
        breakerWarning: false,
        batchesEnqueued: 0,
        recipients: [],
        reminderCohortSize: 0,
        reminderBatchesEnqueued: 0,
        reminderRecipients: [],
      },
    }),
    retentionPurge: vi.fn(),
    retentionReconcileOffDb: vi
      .fn()
      .mockResolvedValue({ ok: true, data: { settled: 0, stillFailing: 0, remaining: 0 } }),
  } as unknown as LiveRunClient & {
    retentionNotify: ReturnType<typeof vi.fn>;
    retentionPurge: ReturnType<typeof vi.fn>;
    retentionReconcileOffDb: ReturnType<typeof vi.fn>;
  };
}

function purged(charactersDeleted = 1, charactersReHomed = 0): RetentionPurgeResponse {
  return { discordId: 'x', status: 'purged', charactersDeleted, charactersReHomed };
}

function skipped(
  reason?: RetentionPurgeResponse['reason'],
  detail?: string
): RetentionPurgeResponse {
  return { discordId: 'x', status: 'skipped', reason, ...(detail !== undefined && { detail }) };
}

describe('executeLiveRun — seam assertions', () => {
  it('calls notify with exactly runId + runContext (no breakerOverride, no dryRun)', async () => {
    const client = makeClient();
    client.retentionPurge.mockResolvedValue({ ok: true, data: purged() });
    const preview = makePreview([makeUser('1')]);

    await executeLiveRun(client, RUN_ID, preview);

    expect(client.retentionNotify).toHaveBeenCalledWith({
      runId: RUN_ID,
      runContext: LIVE_RUN_CONTEXT,
    });
  });

  it('threads the runId it was called with onto the returned outcome', async () => {
    const client = makeClient();
    client.retentionPurge.mockResolvedValue({ ok: true, data: purged() });
    const preview = makePreview([makeUser('1')]);

    const outcome = await executeLiveRun(client, RUN_ID, preview);

    expect(outcome.runId).toBe(RUN_ID);
  });

  it('calls every purge with exactly discordId + runId + runContext (no breakerOverride)', async () => {
    const client = makeClient();
    client.retentionPurge.mockResolvedValue({ ok: true, data: purged() });
    const preview = makePreview([makeUser('1'), makeUser('2')]);

    await executeLiveRun(client, RUN_ID, preview);

    expect(client.retentionPurge).toHaveBeenNthCalledWith(1, {
      discordId: '1',
      runId: RUN_ID,
      runContext: LIVE_RUN_CONTEXT,
    });
    expect(client.retentionPurge).toHaveBeenNthCalledWith(2, {
      discordId: '2',
      runId: RUN_ID,
      runContext: LIVE_RUN_CONTEXT,
    });
  });
});

describe('executeLiveRun — purge tallies', () => {
  it('tallies purged users, characters, and preview rows in order', async () => {
    const client = makeClient();
    client.retentionPurge
      .mockResolvedValueOnce({ ok: true, data: purged(2, 1) })
      .mockResolvedValueOnce({ ok: true, data: purged(1, 0) });
    const u1 = makeUser('1');
    const u2 = makeUser('2');
    const preview = makePreview([u1, u2]);

    const outcome = await executeLiveRun(client, RUN_ID, preview);

    expect(outcome.purge.purged).toEqual([u1, u2]);
    expect(outcome.purge.charactersDeleted).toBe(3);
    expect(outcome.purge.charactersReHomed).toBe(1);
    expect(outcome.purge.attempted).toBe(2);
    expect(outcome.purge.halt).toBeNull();
  });

  it('tallies skipped users by reason, including an absent reason as unspecified', async () => {
    const client = makeClient();
    client.retentionPurge
      .mockResolvedValueOnce({ ok: true, data: skipped('already_gone') })
      .mockResolvedValueOnce({ ok: true, data: skipped('already_gone') })
      .mockResolvedValueOnce({ ok: true, data: skipped(undefined) });
    const preview = makePreview([makeUser('1'), makeUser('2'), makeUser('3')]);

    const outcome = await executeLiveRun(client, RUN_ID, preview);

    expect(outcome.purge.skippedByReason).toEqual({ already_gone: 2, unspecified: 1 });
    expect(outcome.purge.purged).toHaveLength(0);
  });
});

describe('executeLiveRun — halts', () => {
  it('halts on the first breaker_tripped: purge called once, notify still called once', async () => {
    const client = makeClient();
    client.retentionPurge.mockResolvedValueOnce({
      ok: true,
      data: skipped('breaker_tripped', 'cohort exceeds hard ceiling'),
    });
    const preview = makePreview([makeUser('1'), makeUser('2'), makeUser('3')]);

    const outcome = await executeLiveRun(client, RUN_ID, preview);

    expect(client.retentionPurge).toHaveBeenCalledTimes(1);
    expect(client.retentionNotify).toHaveBeenCalledTimes(1);
    expect(outcome.purge.halt).toEqual({
      kind: 'breaker_tripped',
      detail: 'cohort exceeds hard ceiling',
    });
    expect(outcome.purge.skippedByReason.breaker_tripped).toBeUndefined();
  });

  it('halts on lease conflict and issues no further purge calls', async () => {
    const client = makeClient();
    client.retentionPurge.mockResolvedValueOnce({
      ok: false,
      kind: 'http',
      error: 'lease lost',
      status: 409,
      code: 'RUN_LEASE_CONFLICT',
    });
    const preview = makePreview([makeUser('1'), makeUser('2')]);

    const outcome = await executeLiveRun(client, RUN_ID, preview);

    expect(client.retentionPurge).toHaveBeenCalledTimes(1);
    expect(outcome.purge.halt).toEqual({ kind: 'lease_lost' });
  });

  it('aborts after 3 consecutive failures (4th user never called)', async () => {
    const client = makeClient();
    client.retentionPurge.mockResolvedValue({
      ok: false,
      kind: 'network',
      error: 'ECONNREFUSED',
      status: 0,
    });
    const preview = makePreview([makeUser('1'), makeUser('2'), makeUser('3'), makeUser('4')]);

    const outcome = await executeLiveRun(client, RUN_ID, preview);

    expect(client.retentionPurge).toHaveBeenCalledTimes(MAX_CONSECUTIVE_PURGE_FAILURES);
    expect(outcome.purge.halt).toEqual({
      kind: 'aborted_consecutive_failures',
      consecutiveFailures: 3,
    });
    expect(outcome.purge.failed).toBe(3);
  });

  it('does not abort on 2 failures, a success, then 2 more failures (never reaches 3 consecutive)', async () => {
    const client = makeClient();
    const failure = { ok: false, kind: 'network', error: 'ECONNREFUSED', status: 0 };
    client.retentionPurge
      .mockResolvedValueOnce(failure)
      .mockResolvedValueOnce(failure)
      .mockResolvedValueOnce({ ok: true, data: purged() })
      .mockResolvedValueOnce(failure)
      .mockResolvedValueOnce(failure);
    const preview = makePreview(['1', '2', '3', '4', '5'].map(makeUser));

    const outcome = await executeLiveRun(client, RUN_ID, preview);

    expect(client.retentionPurge).toHaveBeenCalledTimes(5);
    expect(outcome.purge.halt).toBeNull();
    expect(outcome.purge.failed).toBe(4);
    expect(outcome.purge.purged).toHaveLength(1);
  });

  it('counts a thrown purge call as kind exception', async () => {
    const client = makeClient();
    client.retentionPurge.mockRejectedValueOnce(new Error('boom'));
    const preview = makePreview([makeUser('1')]);

    const outcome = await executeLiveRun(client, RUN_ID, preview);

    expect(outcome.purge.failed).toBe(1);
    expect(outcome.purge.failureKinds.exception).toBe(1);
  });

  it('tallies an unrecognized purge status as a failure, never a skip, and keeps going', async () => {
    const client = makeClient();
    client.retentionPurge
      .mockResolvedValueOnce({
        ok: true,
        data: { discordId: 'x', status: 'weird' } as unknown as RetentionPurgeResponse,
      })
      .mockResolvedValueOnce({ ok: true, data: purged() });
    const preview = makePreview([makeUser('1'), makeUser('2')]);

    const outcome = await executeLiveRun(client, RUN_ID, preview);

    expect(outcome.purge.failed).toBe(1);
    expect(outcome.purge.failureKinds.unknown_status).toBe(1);
    expect(Object.keys(outcome.purge.skippedByReason)).toHaveLength(0);
    expect(client.retentionPurge).toHaveBeenCalledTimes(2);
    expect(outcome.purge.purged).toHaveLength(1);
  });
});

describe('executeLiveRun — notify failure does not block purge', () => {
  it('still runs the purge loop when notify returns ok:false', async () => {
    const client = makeClient();
    client.retentionNotify.mockResolvedValue({
      ok: false,
      kind: 'http',
      error: 'gateway 500',
      status: 500,
    });
    client.retentionPurge.mockResolvedValue({ ok: true, data: purged() });
    const preview = makePreview([makeUser('1')]);

    const outcome = await executeLiveRun(client, RUN_ID, preview);

    expect(outcome.notify).toEqual({ kind: 'failed', error: 'gateway 500' });
    expect(client.retentionPurge).toHaveBeenCalledTimes(1);
    expect(outcome.purge.purged).toHaveLength(1);
  });

  it('still runs the purge loop when notify throws', async () => {
    const client = makeClient();
    client.retentionNotify.mockRejectedValue(new Error('network down'));
    client.retentionPurge.mockResolvedValue({ ok: true, data: purged() });
    const preview = makePreview([makeUser('1')]);

    const outcome = await executeLiveRun(client, RUN_ID, preview);

    expect(outcome.notify).toEqual({ kind: 'failed', error: 'network down' });
    expect(client.retentionPurge).toHaveBeenCalledTimes(1);
  });
});

describe('executeLiveRun — reconcile', () => {
  it('loops while remaining > 0 and sums settled/stillFailing', async () => {
    const client = makeClient();
    client.retentionPurge.mockResolvedValue({ ok: true, data: purged() });
    client.retentionReconcileOffDb
      .mockResolvedValueOnce({ ok: true, data: { settled: 2, stillFailing: 1, remaining: 3 } })
      .mockResolvedValueOnce({ ok: true, data: { settled: 3, stillFailing: 0, remaining: 0 } });
    const preview = makePreview([makeUser('1')]);

    const outcome = await executeLiveRun(client, RUN_ID, preview);

    expect(client.retentionReconcileOffDb).toHaveBeenCalledTimes(2);
    expect(outcome.reconcile).toEqual({
      kind: 'ok',
      settled: 5,
      stillFailing: 1,
      remaining: 0,
      iterations: 2,
    });
  });

  it('caps at MAX_RECONCILE_ITERATIONS when remaining never reaches 0', async () => {
    const client = makeClient();
    client.retentionPurge.mockResolvedValue({ ok: true, data: purged() });
    client.retentionReconcileOffDb.mockResolvedValue({
      ok: true,
      data: { settled: 1, stillFailing: 0, remaining: 5 },
    });
    const preview = makePreview([makeUser('1')]);

    const outcome = await executeLiveRun(client, RUN_ID, preview);

    expect(client.retentionReconcileOffDb).toHaveBeenCalledTimes(MAX_RECONCILE_ITERATIONS);
    expect(outcome.reconcile).toMatchObject({
      kind: 'ok',
      iterations: MAX_RECONCILE_ITERATIONS,
      remaining: 5,
    });
  });

  it('records a failed reconcile call with the partial sums so far', async () => {
    const client = makeClient();
    client.retentionPurge.mockResolvedValue({ ok: true, data: purged() });
    client.retentionReconcileOffDb
      .mockResolvedValueOnce({ ok: true, data: { settled: 2, stillFailing: 0, remaining: 4 } })
      .mockResolvedValueOnce({ ok: false, kind: 'network', error: 'ECONNREFUSED', status: 0 });
    const preview = makePreview([makeUser('1')]);

    const outcome = await executeLiveRun(client, RUN_ID, preview);

    expect(outcome.reconcile).toEqual({
      kind: 'failed',
      error: 'ECONNREFUSED',
      settled: 2,
      stillFailing: 0,
      iterations: 2,
    });
  });

  it('records a thrown reconcile call as a failed outcome, with the partial sums so far', async () => {
    const client = makeClient();
    client.retentionPurge.mockResolvedValue({ ok: true, data: purged() });
    client.retentionReconcileOffDb
      .mockResolvedValueOnce({ ok: true, data: { settled: 2, stillFailing: 0, remaining: 4 } })
      .mockRejectedValueOnce(new Error('connection reset'));
    const preview = makePreview([makeUser('1')]);

    const outcome = await executeLiveRun(client, RUN_ID, preview);

    expect(outcome.reconcile).toEqual({
      kind: 'failed',
      error: 'connection reset',
      settled: 2,
      stillFailing: 0,
      iterations: 2,
    });
  });

  it('still runs reconcile after a purge halt (breaker tripped)', async () => {
    const client = makeClient();
    client.retentionPurge.mockResolvedValueOnce({
      ok: true,
      data: skipped('breaker_tripped', 'stop'),
    });
    const preview = makePreview([makeUser('1'), makeUser('2')]);

    const outcome = await executeLiveRun(client, RUN_ID, preview);

    expect(client.retentionReconcileOffDb).toHaveBeenCalledTimes(1);
    expect(outcome.reconcile.kind).toBe('ok');
  });
});

// callRetentionNotify is shared with retentionRehearsal.ts. Its ok:false and
// throw branches are already fully covered above — via
// "still runs the purge loop when notify returns ok:false" and
// "still runs the purge loop when notify throws" — both assert the exact
// `{ kind: 'failed', error }` shape those branches produce, which is the
// entirety of what there is to map for a failure. The "ok" branch's full
// field mapping (including the conditional `breakerDetail` spread) is NOT
// exercised anywhere else, since every executeLiveRun fixture uses the same
// quiet notify response — hence the direct unit tests below.
describe('callRetentionNotify', () => {
  const makeNotifyClient = (): LiveRunClient & {
    retentionNotify: ReturnType<typeof vi.fn>;
  } =>
    ({
      retentionNotify: vi.fn(),
    }) as unknown as LiveRunClient & { retentionNotify: ReturnType<typeof vi.fn> };

  it('maps every ok field, including breakerDetail, when present', async () => {
    const client = makeNotifyClient();
    client.retentionNotify.mockResolvedValue({
      ok: true,
      data: {
        status: 'refused_breaker',
        cohortSize: 42,
        userbaseCount: 300,
        percentOfUserbase: 14,
        breakerWarning: true,
        batchesEnqueued: 0,
        breakerDetail: 'cohort exceeds hard ceiling',
        recipients: [],
        reminderCohortSize: 3,
        reminderBatchesEnqueued: 0,
        reminderRecipients: [],
      },
    });

    const outcome = await callRetentionNotify(client, {
      runId: RUN_ID,
      runContext: LIVE_RUN_CONTEXT,
    });

    expect(outcome).toEqual({
      kind: 'ok',
      status: 'refused_breaker',
      cohortSize: 42,
      batchesEnqueued: 0,
      breakerWarning: true,
      breakerDetail: 'cohort exceeds hard ceiling',
      reminderCohortSize: 3,
      reminderBatchesEnqueued: 0,
    });
  });

  it('omits breakerDetail entirely when the response does not carry one', async () => {
    const client = makeNotifyClient();
    client.retentionNotify.mockResolvedValue({
      ok: true,
      data: {
        status: 'enqueued',
        cohortSize: 5,
        userbaseCount: 300,
        percentOfUserbase: 2,
        breakerWarning: false,
        batchesEnqueued: 1,
        recipients: [],
        reminderCohortSize: 0,
        reminderBatchesEnqueued: 0,
        reminderRecipients: [],
      },
    });

    const outcome = await callRetentionNotify(client, {
      runId: RUN_ID,
      runContext: LIVE_RUN_CONTEXT,
    });

    expect(outcome).toEqual({
      kind: 'ok',
      status: 'enqueued',
      cohortSize: 5,
      batchesEnqueued: 1,
      breakerWarning: false,
      reminderCohortSize: 0,
      reminderBatchesEnqueued: 0,
    });
    expect('breakerDetail' in outcome).toBe(false);
  });
});
