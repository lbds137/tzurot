/**
 * Gateway calls split out of gatewayServiceCalls.ts (same typed-client
 * pattern) to keep that file under its line budget; nothing here is
 * architecturally distinct from its siblings there.
 *
 * Holds four helpers: `filterNotifyEligible` and `reportNotifyOutcomes` (the
 * retention-notice worker's two write seams into the grace bookkeeping, for
 * both notice kinds), `reportDeliveries` (the release-DM blast's ledger
 * report), and `reportPersonaDmUndeliverable` (the persona-DM unreachability
 * stamp).
 */

import type { RetentionNoticeKind } from '@tzurot/common-types/schemas/api/internal';
import type {
  BroadcastCompletionSummary,
  DeliveryOutcome,
} from '@tzurot/common-types/schemas/api/broadcast';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { getServiceClient } from './gatewayClients.js';
import {
  withGatewayRetry,
  REPORT_MAX_ATTEMPTS,
  REPORT_RETRY_BASE_DELAY_MS,
} from './gatewayRetry.js';

const logger = createLogger('retentionGatewayCalls');

/**
 * Retention notify: the worker's send-time still-eligible re-check. THROWS on
 * gateway failure — this runs BEFORE any DM is sent (same before-spend
 * contract as filterPendingDeliveries), so failing the job lets BullMQ's
 * retry re-run the batch instead of silently skipping it.
 */
export async function filterNotifyEligible(
  userIds: string[],
  notice: RetentionNoticeKind
): Promise<string[]> {
  const result = await getServiceClient().retentionNotifyFilter({ userIds, notice });
  if (!result.ok) {
    logger.error({ status: result.status }, 'Failed to filter notify-eligible users');
    throw new Error(`Notify-eligibility filter failed: ${result.status} ${result.error}`);
  }
  return result.data.stillEligibleUserIds;
}

/** One reported notify outcome (mirrors the internal-route contract). */
export interface NotifyOutcomeReport {
  userId: string;
  status: 'sent' | 'failed_permanent' | 'failed_bot_level' | 'failed_transient';
  errorCode?: string;
  /** Which of the two grace-cycle notices this outcome reports. */
  notice: RetentionNoticeKind;
}

/**
 * Report retention-notice outcomes. AFTER-spend contract (mirrors
 * reportDeliveries): retries transient gateway failures, then returns false
 * and never throws — the DM has already happened, and the stamps'
 * IS NULL guards make the pre-send filter absorb an eventual re-run.
 */
export async function reportNotifyOutcomes(outcomes: NotifyOutcomeReport[]): Promise<boolean> {
  if (outcomes.length === 0) {
    return true;
  }
  const { result, attempts } = await withGatewayRetry(
    () => getServiceClient().retentionNotifyReport({ outcomes }),
    {
      maxAttempts: REPORT_MAX_ATTEMPTS,
      baseDelayMs: REPORT_RETRY_BASE_DELAY_MS,
      operation: 'reporting notify outcomes',
    }
  );
  if (!result.ok) {
    logger.error(
      { status: result.status, attempts },
      'Failed to report notify outcomes — un-stamped users ride the next run'
    );
    return false;
  }
  return true;
}

/** One reported delivery outcome (mirrors the internal-route contract). */
export interface DeliveryReport {
  deliveryLogId: string;
  status: DeliveryOutcome;
  errorCode?: string;
  /** Snowflake of the sent DM (status 'sent' only) — enables later cleanup. */
  sentMessageId?: string;
  /**
   * Ledger row of the user's prior release DM this send deleted (or found
   * already gone) — the gateway stamps its messageDeletedAt.
   */
  deletedPreviousDeliveryLogId?: string;
}

/** The slice of the deliveries response the worker acts on (ops report). */
export interface DeliveryReportOutcome {
  /** True only on the report that flipped the announcement to completed. */
  completed: boolean;
  /** The blast's final tally; present exactly when completed is true. */
  summary?: BroadcastCompletionSummary;
}

/**
 * Report a batch's delivery outcomes to the gateway ledger, retrying
 * transient failures — a lost report leaves a SENT row looking pending, and a
 * later stall-rerun would re-DM it (redeploys of gateway and bot-client are
 * correlated on this platform, so "report failed" and "job stalls" co-occur).
 *
 * After the retries this still NEVER throws — the DM is already sent, and a
 * thrown error would fail the job, retry the batch, and re-DM the very row
 * whose report was lost. The asymmetry with filterPendingDeliveries (which
 * throws) is deliberate: throw before spend, absorb after spend. The
 * all-retries-failed path returns undefined ("no outcome"), which callers
 * must treat as "no ops report" — never as a reason to fail the job.
 */
export async function reportDeliveries(
  releaseId: string,
  results: DeliveryReport[]
): Promise<DeliveryReportOutcome | undefined> {
  if (results.length === 0) {
    return undefined;
  }
  const { result, attempts } = await withGatewayRetry(
    () => getServiceClient().releaseBroadcastDeliveries(releaseId, { results }),
    {
      maxAttempts: REPORT_MAX_ATTEMPTS,
      baseDelayMs: REPORT_RETRY_BASE_DELAY_MS,
      operation: 'reporting delivery outcomes',
      context: { releaseId },
    }
  );
  if (!result.ok) {
    logger.error(
      { status: result.status, releaseId, attempts },
      'Failed to report delivery outcomes — rows stay pending (re-DM risk on stall-rerun)'
    );
    return undefined;
  }
  logger.debug(
    { releaseId, updated: result.data.updated, completed: result.data.completed },
    'Delivery outcomes reported'
  );
  return {
    completed: result.data.completed,
    ...(result.data.summary !== undefined ? { summary: result.data.summary } : {}),
  };
}

/**
 * Reports a permanent persona-DM delivery failure so the retention purge's
 * per-user unreachability signal stays fresh. Fire-and-forget: the reply
 * path already failed to deliver, so it must not also wait on (or fail
 * because of) a gateway round trip. Never throws, and no retry loop — the
 * next persona-DM failure for this user is the retry, and the gateway's
 * stamp is idempotently guarded, so a missed report only delays the signal.
 * The gateway alone owns the error-code -> column mapping.
 */
export function reportPersonaDmUndeliverable(discordId: string, errorCode: string): void {
  void getServiceClient()
    .stampUserDmUndeliverable({ discordId, errorCode })
    .then(result => {
      if (!result.ok) {
        logger.warn(
          { discordId, errorCode, status: result.status },
          'Failed to stamp persona-DM unreachability'
        );
      }
    })
    .catch((error: unknown) => {
      logger.warn(
        { err: error, discordId, errorCode },
        'Failed to stamp persona-DM unreachability'
      );
    });
}
