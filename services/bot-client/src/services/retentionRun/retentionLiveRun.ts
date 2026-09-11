/**
 * The retention job's live-run steps: notify, the per-user purge loop, and
 * the off-DB reconcile sweep. Called by `RetentionRunScheduler` once it holds
 * the run lease; this module knows nothing about the lease itself.
 */

import type {
  RetentionPreviewResponse,
  RetentionPurgeResponse,
} from '@tzurot/common-types/schemas/api/internal';
import type { ServiceClient } from '@tzurot/clients';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { isRetentionRunLeaseLost } from './retentionRunLease.js';
import type {
  LiveRunOutcome,
  NotifyStepOutcome,
  PurgeLoopOutcome,
  ReconcileOutcome,
  RetentionPreviewUser,
} from './types.js';

const logger = createLogger('retention-run');

/** Run-context label sent on every notify/purge call the live run makes. */
export const LIVE_RUN_CONTEXT = 'job:retention-daily';

/**
 * Consecutive purge failures that abort the loop early rather than grinding
 * through the rest of the cohort against a gateway that is clearly down.
 */
export const MAX_CONSECUTIVE_PURGE_FAILURES = 3;

/** Bound on reconcile-sweep calls in one live run, so a stuck backlog cannot loop forever. */
export const MAX_RECONCILE_ITERATIONS = 10;

/** The three calls the live run makes, narrowed from the full `ServiceClient`. */
export type LiveRunClient = Pick<
  ServiceClient,
  'retentionNotify' | 'retentionPurge' | 'retentionReconcileOffDb'
>;

/**
 * Call `retentionNotify` and map its result onto `NotifyStepOutcome`. Shared
 * by the live run (real `runId`/`runContext`) and the rehearsal mode
 * (`dryRun: true`) — the try/catch + ok/ok:false mapping is otherwise an
 * exact clone between the two callers.
 */
export async function callRetentionNotify(
  client: Pick<ServiceClient, 'retentionNotify'>,
  input: Parameters<ServiceClient['retentionNotify']>[0]
): Promise<NotifyStepOutcome> {
  try {
    const result = await client.retentionNotify(input);
    if (!result.ok) {
      return { kind: 'failed', error: result.error };
    }
    const { data } = result;
    return {
      kind: 'ok',
      status: data.status,
      cohortSize: data.cohortSize,
      batchesEnqueued: data.batchesEnqueued,
      breakerWarning: data.breakerWarning,
      reminderCohortSize: data.reminderCohortSize,
      reminderBatchesEnqueued: data.reminderBatchesEnqueued,
      ...(data.breakerDetail !== undefined && { breakerDetail: data.breakerDetail }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: 'failed', error: message };
  }
}

/** Local widening of the purge call's result so a thrown call can be folded in as `kind: 'exception'`. */
type PurgeCallResult =
  | { ok: true; data: RetentionPurgeResponse }
  | { ok: false; kind: string; error: string; code?: string };

async function callPurge(
  client: LiveRunClient,
  user: RetentionPreviewUser,
  runId: string
): Promise<PurgeCallResult> {
  try {
    return await client.retentionPurge({
      discordId: user.discordId,
      runId,
      runContext: LIVE_RUN_CONTEXT,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, kind: 'exception', error: message };
  }
}

/**
 * Tally one failed purge attempt (a real client failure, or an unrecognized
 * status treated as one) onto the running outcome and apply the same
 * consecutive-failure abort check both failure paths share.
 */
function tallyPurgeFailure(
  outcome: PurgeLoopOutcome,
  kind: string,
  consecutiveFailures: number
): number {
  outcome.failed += 1;
  outcome.failureKinds[kind] = (outcome.failureKinds[kind] ?? 0) + 1;
  const nextConsecutive = consecutiveFailures + 1;
  if (nextConsecutive >= MAX_CONSECUTIVE_PURGE_FAILURES) {
    outcome.halt = { kind: 'aborted_consecutive_failures', consecutiveFailures: nextConsecutive };
  }
  return nextConsecutive;
}

/**
 * Apply one purge call's result onto the running outcome, returning the
 * updated consecutive-failure count. Split out of the loop to keep both
 * under the per-function complexity budget.
 */
function applyPurgeResult(
  outcome: PurgeLoopOutcome,
  user: RetentionPreviewUser,
  result: PurgeCallResult,
  consecutiveFailures: number
): number {
  outcome.attempted += 1;

  if (result.ok) {
    switch (result.data.status) {
      case 'purged': {
        outcome.purged.push(user);
        outcome.charactersDeleted += result.data.charactersDeleted ?? 0;
        outcome.charactersReHomed += result.data.charactersReHomed ?? 0;
        return 0;
      }
      case 'skipped': {
        if (result.data.reason === 'breaker_tripped') {
          // The gateway re-counts the hard ceiling on EVERY purge call, so the
          // job never duplicates the threshold here — it only reacts to the
          // gateway's own refusal and stops issuing further purges.
          outcome.halt = { kind: 'breaker_tripped', detail: result.data.detail ?? '' };
          return consecutiveFailures;
        }
        const reasonKey = result.data.reason ?? 'unspecified';
        outcome.skippedByReason[reasonKey] = (outcome.skippedByReason[reasonKey] ?? 0) + 1;
        return 0;
      }
      default: {
        // The typed client's Zod parse means an unknown status cannot reach
        // here through the real client today; this branch is the
        // compile-time guard for enum growth plus a runtime backstop.
        const unknownStatus: never = result.data.status;
        logger.warn({ status: String(unknownStatus) }, 'Purge returned an unrecognized status');
        return tallyPurgeFailure(outcome, 'unknown_status', consecutiveFailures);
      }
    }
  }

  if (isRetentionRunLeaseLost(result)) {
    outcome.halt = { kind: 'lease_lost' };
    return consecutiveFailures;
  }

  return tallyPurgeFailure(outcome, result.kind, consecutiveFailures);
}

/**
 * Purge the preview cohort sequentially (never in parallel): live mode is
 * production-only, where the purge scope is unrestricted unless
 * OUTBOUND_DM_ALLOWLIST is set; a scoped run is bounded by scope membership,
 * not by the breaker (see the gateway's purgeScope.ts) — the report renders
 * the scope whenever it is not unrestricted.
 */
async function runPurgeLoop(
  client: LiveRunClient,
  runId: string,
  users: readonly RetentionPreviewUser[]
): Promise<PurgeLoopOutcome> {
  const outcome: PurgeLoopOutcome = {
    attempted: 0,
    purged: [],
    charactersDeleted: 0,
    charactersReHomed: 0,
    skippedByReason: {},
    failed: 0,
    failureKinds: {},
    halt: null,
  };
  let consecutiveFailures = 0;

  for (const user of users) {
    const result = await callPurge(client, user, runId);
    consecutiveFailures = applyPurgeResult(outcome, user, result, consecutiveFailures);
    if (outcome.halt !== null) {
      break;
    }
  }

  return outcome;
}

async function runReconcileLoop(client: LiveRunClient): Promise<ReconcileOutcome> {
  let settled = 0;
  let stillFailing = 0;
  let remaining = 0;
  let iterations = 0;

  for (let i = 0; i < MAX_RECONCILE_ITERATIONS; i += 1) {
    iterations += 1;
    try {
      const result = await client.retentionReconcileOffDb();
      if (!result.ok) {
        return { kind: 'failed', error: result.error, settled, stillFailing, iterations };
      }
      settled += result.data.settled;
      stillFailing += result.data.stillFailing;
      remaining = result.data.remaining;
      if (remaining === 0) {
        break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { kind: 'failed', error: message, settled, stillFailing, iterations };
    }
  }

  return { kind: 'ok', settled, stillFailing, remaining, iterations };
}

/**
 * Run the live retention run: notify, then the purge loop, then the
 * reconcile sweep. Notify and purge are independent halves — the purge loop
 * always runs regardless of the notify outcome — and reconcile always runs,
 * even after a purge halt, so an owed off-DB cleanup from an EARLIER run
 * still gets replayed.
 */
export async function executeLiveRun(
  client: LiveRunClient,
  runId: string,
  preview: RetentionPreviewResponse
): Promise<LiveRunOutcome> {
  const notify = await callRetentionNotify(client, { runId, runContext: LIVE_RUN_CONTEXT });
  const purge = await runPurgeLoop(client, runId, preview.users);
  const reconcile = await runReconcileLoop(client);

  return { runId, runContext: LIVE_RUN_CONTEXT, preview, notify, purge, reconcile };
}
