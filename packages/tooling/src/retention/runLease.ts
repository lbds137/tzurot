/**
 * CLI side of the retention run lease, shared by `retention:purge` and
 * `retention:notify`.
 *
 * The gateway serializes whole runs with a Redis lease (see the gateway's
 * `services/retention/runLease.ts`). A CLI run takes it only AFTER the preview
 * and the confirmation prompt — an operator pondering the prompt must not hold
 * it — and threads the runId into every leased call. Release differs by
 * command: `retention:purge` releases it on every exit path, including an
 * interrupt, because its loop can run long enough that an operator needs to
 * Ctrl-C it; `retention:notify` releases on completion and on a thrown error,
 * leaving an interrupted run to the lease TTL, because its leased window is
 * one short enqueue call. Release is best-effort either way: the lease's TTL
 * reclaims anything a crashed or killed run leaves behind.
 */

import chalk from 'chalk';
import { API_ERROR_SUBCODE } from '@tzurot/common-types/constants/error';

/** The failure half of a typed-client result, narrowed to what these helpers read. */
interface LeaseCallFailure {
  ok: false;
  kind: string;
  error: string;
  code?: string;
}

/** The two lease calls — narrowed so tests can supply a stub. */
export interface RunLeaseClient {
  retentionRunBegin: (input: {
    runContext: string;
  }) => Promise<{ ok: true; data: { runId: string; leaseTtlMs: number } } | LeaseCallFailure>;
  retentionRunEnd: (input: {
    runId: string;
  }) => Promise<{ ok: true; data: { released: boolean } } | LeaseCallFailure>;
}

/**
 * Take the run lease. Returns the runId, or null — having printed why and set
 * a failing exit code — when the run must not proceed. On a 409 the gateway's
 * message names the holder's run context and since-when.
 */
export async function beginRunLease(
  client: RunLeaseClient,
  runContext: string
): Promise<string | null> {
  const result = await client.retentionRunBegin({ runContext });
  if (result.ok) {
    return result.data.runId;
  }
  if (result.code === API_ERROR_SUBCODE.RUN_IN_PROGRESS) {
    console.error(chalk.red(`\n${result.error}`));
    console.error(chalk.yellow('Nothing was touched. Re-run once that run has finished.'));
  } else {
    console.error(
      chalk.red(`\nFailed to take the retention run lease (${result.kind}): ${result.error}`)
    );
  }
  process.exitCode = 1;
  return null;
}

/**
 * Release the run lease, best-effort: a failure here must never mask the run's
 * own outcome (never throws, never sets `process.exitCode`), and the lease
 * TTL reclaims an unreleased lease on its own. Best-effort is not silent,
 * though — every non-clean outcome (a failed call, a lease that was no longer
 * this run's, or a thrown error) prints a warning so an operator watching the
 * CLI's own output sees it, even though nothing here fails the run.
 */
export async function releaseRunLease(client: RunLeaseClient, runId: string): Promise<void> {
  try {
    const result = await client.retentionRunEnd({ runId });
    if (!result.ok) {
      console.warn(
        chalk.yellow(
          `\nFailed to release the retention run lease (${result.kind}): ${result.error}. ` +
            'The lease TTL reclaims it.'
        )
      );
      return;
    }
    if (!result.data.released) {
      console.warn(
        chalk.yellow(
          "\nThe retention run lease was no longer this run's (expired, or taken over by " +
            'another run) — another run may have overlapped this one.'
        )
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      chalk.yellow(
        `\nFailed to release the retention run lease: ${message}. The lease TTL reclaims it.`
      )
    );
  }
}

/** True when a leased call was refused because this run no longer holds the lease. */
export function isRunLeaseLost(result: { ok: boolean; code?: string }): boolean {
  return !result.ok && result.code === API_ERROR_SUBCODE.RUN_LEASE_CONFLICT;
}
