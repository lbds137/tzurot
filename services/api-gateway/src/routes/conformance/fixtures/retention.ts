/**
 * Conformance fixtures: retention routes (Phase 2-4).
 *
 * Split out of internal.ts to stay under the file's line budget — retention
 * is its own coherent family (preview, the run lease, purge, notify) with its
 * own shared seed helper.
 *
 * The generated internal mounts carry no audience middleware (service-auth
 * is applied globally in index.ts), so these replay without auth headers
 * doing any work.
 */

import { RUN_LEASE_KEY } from '../../../services/retention/runLease.js';
import type { ConformanceEntry, SeedContext } from './types.js';

/**
 * Take the retention run lease for a fixture. Deletes any stale lease key
 * first (order-independence: this suite replays every route against a
 * shared database/Redis, so a lease left held by an earlier fixture must not
 * make a later one refuse with RUN_IN_PROGRESS), then begins a fresh run
 * through the real route and returns its runId.
 */
async function seedRunLease(ctx: SeedContext): Promise<string> {
  await ctx.redis.del(RUN_LEASE_KEY);
  const begin = (await ctx.call('post', '/api/internal/retention/run/begin', {
    runContext: 'conformance',
  })) as { runId: string };
  return begin.runId;
}

export const retentionFixtures: Record<string, ConformanceEntry> = {
  retentionPreview: {
    // An empty cohort is the healthy steady state (and the conformance actor is
    // recent + reachable, so it can't be eligible): the route returns
    // users: [] with zeroed totals — zero seed needed.
  },

  retentionRunBegin: {
    // Order-independent: delete any lease a prior fixture left held before
    // taking a fresh one through the real route.
    seed: async ctx => {
      await ctx.redis.del(RUN_LEASE_KEY);
      return { body: { runContext: 'conformance' } };
    },
  },

  retentionRunEnd: {
    // Same order-independence, then take the lease itself (through the real
    // begin route) so this fixture has a genuine runId to release.
    seed: async ctx => ({ body: { runId: await seedRunLease(ctx) } }),
  },

  retentionPurge: {
    // The lease is taken in the seed (order-independent — see seedRunLease).
    // Targets a Discord id no user row has; the harness runs with
    // NODE_ENV=test and no OUTBOUND_DM_ALLOWLIST, so the purge scope refuses
    // before the existence check: a 200 `skipped` (reason
    // `unscoped_non_production` — conformance validates the response SHAPE,
    // not the reason) is the shape checked here. Deliberately NOT
    // seeding a purgeable user: this harness replays every route against a
    // shared database, and a fixture that erases an account would be
    // reaching outside its own state. The real erasure is proven in
    // RetentionPurgeService.component.test.ts against an isolated PGLite DB.
    seed: async ctx => {
      const runId = await seedRunLease(ctx);
      return {
        body: { discordId: '829999999999999999', runContext: 'conformance', runId },
      };
    },
  },

  retentionNotify: {
    // Dry run against the empty steady state (the conformance actor is recent
    // and reachable, so the notify cohort is empty): resolves, enqueues
    // nothing, needs no queue and no seed. Dry runs stay unleased.
    body: { dryRun: true },
  },

  retentionNotifyFilter: {
    // No user row carries this id, so the still-eligible subset is empty —
    // the shape conformance checks, with zero seed and zero writes.
    body: { userIds: ['829e4567-e89b-42d3-a456-426614174999'] },
  },

  retentionNotifyReport: {
    // A transient outcome stamps NOTHING by design (the queue retries it), so
    // this exercises the route's happy path without writing shared state.
    body: {
      outcomes: [{ userId: '829e4567-e89b-42d3-a456-426614174999', status: 'failed_transient' }],
    },
  },

  retentionReconcileOffDb: {
    // An empty audit ledger is the steady state: the sweep finds nothing owed
    // and returns { settled: 0, stillFailing: 0, remaining: 0 } — zero seed needed.
  },
};
