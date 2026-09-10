/**
 * Job-side mirror of the tooling CLI's run-lease helpers
 * (`packages/tooling/src/retention/runLease.ts`). bot-client cannot import
 * from `packages/tooling` (it's a dev-tooling package, not a runtime dep),
 * so the same lease-acquire/release shape is reimplemented here against the
 * generated `ServiceClient`.
 *
 * Unlike the CLI, nobody is watching this job's console — so where the CLI
 * prints to stdout/stderr, this module logs through the service logger
 * instead.
 */

import { createLogger } from '@tzurot/common-types/utils/logger';
import { API_ERROR_SUBCODE } from '@tzurot/common-types/constants/error';
import type { ServiceClient } from '@tzurot/clients';

const logger = createLogger('retention-run');

/** The two lease calls this module needs, narrowed from the full ServiceClient. */
export type RetentionRunLeaseClient = Pick<ServiceClient, 'retentionRunBegin' | 'retentionRunEnd'>;

export type LeaseBeginResult =
  | { kind: 'acquired'; runId: string }
  | { kind: 'busy'; holder: string }
  | { kind: 'failed'; error: string };

/**
 * Take the run lease. Never throws: a rejected `retentionRunBegin` call is
 * reported as `{ kind: 'failed' }`, same as an `ok: false` result.
 */
export async function beginRetentionRunLease(
  client: RetentionRunLeaseClient,
  runContext: string
): Promise<LeaseBeginResult> {
  try {
    const result = await client.retentionRunBegin({ runContext });
    if (result.ok) {
      return { kind: 'acquired', runId: result.data.runId };
    }
    if (result.code === API_ERROR_SUBCODE.RUN_IN_PROGRESS) {
      return { kind: 'busy', holder: result.error };
    }
    return { kind: 'failed', error: result.error };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: 'failed', error: message };
  }
}

/**
 * Release the run lease, best-effort: a failure here must never mask the
 * run's own outcome (never throws), and the lease TTL reclaims an
 * unreleased lease on its own. No operator is watching this job's output, so
 * every non-clean outcome (a failed call, a lease that was no longer this
 * run's, or a thrown error) is logged at warn — not silently swallowed.
 */
export async function releaseRetentionRunLease(
  client: RetentionRunLeaseClient,
  runId: string
): Promise<void> {
  try {
    const result = await client.retentionRunEnd({ runId });
    if (!result.ok) {
      logger.warn(
        { runId, kind: result.kind, error: result.error },
        'Failed to release the retention run lease; the lease TTL reclaims it'
      );
      return;
    }
    if (!result.data.released) {
      logger.warn(
        { runId },
        "Retention run lease was no longer this run's (expired, or taken over by another " +
          'run) — another run may have overlapped this one'
      );
    }
  } catch (error) {
    logger.warn(
      { runId, err: error },
      'Failed to release the retention run lease; the lease TTL reclaims it'
    );
  }
}

/** True when a leased call was refused because this run no longer holds the lease. */
export function isRetentionRunLeaseLost(result: { ok: boolean; code?: string }): boolean {
  return !result.ok && result.code === API_ERROR_SUBCODE.RUN_LEASE_CONFLICT;
}
