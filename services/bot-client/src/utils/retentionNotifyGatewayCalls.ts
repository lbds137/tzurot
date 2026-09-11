/**
 * Retention notify gateway calls — the worker's two write seams into the
 * grace bookkeeping, for both notice kinds (the warning and the reminder).
 * Split out of gatewayServiceCalls.ts (same typed-client pattern) to keep
 * that file under its line budget; nothing here is architecturally distinct
 * from its siblings there.
 */

import type { RetentionNoticeKind } from '@tzurot/common-types/schemas/api/internal';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { getServiceClient } from './gatewayClients.js';
import {
  withGatewayRetry,
  REPORT_MAX_ATTEMPTS,
  REPORT_RETRY_BASE_DELAY_MS,
} from './gatewayRetry.js';

const logger = createLogger('retentionNotifyGatewayCalls');

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
