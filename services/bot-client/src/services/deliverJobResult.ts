/**
 * Disposition-gated result delivery.
 *
 * This is the seam where a generated reply either becomes a confirmed delivery
 * or stays visible as an unconfirmed loss. `MessageHandler.handleJobResult`
 * reports what became of the result; only a `'delivered'` verdict may flip the
 * gateway row `PENDING_DELIVERY` → `DELIVERED`.
 *
 * Confirming a dropped result files a success record over a reply the user
 * never received, and nothing ever revisits a `PENDING_DELIVERY` row — the
 * unconfirmed row is the only surviving evidence that the reply was generated,
 * paid for, and lost. That is the exact defect TASK-821 fixed, so the gate
 * lives in its own tested module rather than inline in the composition root,
 * which no test imports.
 */

import { type LLMGenerationResult } from '@tzurot/common-types/types/schemas/generation';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('deliverJobResult');

/**
 * What became of a job result handed to `handleJobResult`.
 *
 * `'delivered'` means the result reached a path that produced a user-visible
 * outcome (including a partial send where some chunks reached the user), one
 * that owns its own delivery confirmation, or a job the system deliberately
 * resolved where confirming records no loss (stale-discard after a restart; a
 * failed/empty late result whose user already saw the synthetic-timeout
 * message). `'dropped'` means it was discarded with nothing shown to the
 * user — the caller MUST NOT confirm delivery for it, because a confirmed row
 * records a reply the user never received and nothing ever revisits
 * `PENDING_DELIVERY` rows to notice.
 */
export type JobResultDisposition = 'delivered' | 'dropped';

/**
 * The two collaborators the gate sits between. Injected rather than imported
 * so the gate is testable without mocking the gateway module: the whole point
 * of this module is that the `if` below is exercised in both directions.
 */
export interface JobResultDeliveryDeps {
  /** Routes the result to its delivery path and reports what became of it. */
  handleJobResult: (jobId: string, result: LLMGenerationResult) => Promise<JobResultDisposition>;
  /** Flips the gateway `job_results` row `PENDING_DELIVERY` → `DELIVERED`. */
  confirmDelivery: (jobId: string) => Promise<void>;
}

/**
 * Hand one job result to the message handler, then confirm delivery only if
 * the handler reports the user actually got something.
 *
 * Returns the handler's disposition so callers can log or branch on it; the
 * confirm decision itself is made here and nowhere else. A rejected confirm
 * is caught and logged at warn: the reply was already delivered, so a confirm
 * failure must not surface as a delivery failure (the row just stays
 * `PENDING_DELIVERY`). This function does not throw on a confirm failure.
 */
export async function deliverJobResult(
  deps: JobResultDeliveryDeps,
  jobId: string,
  result: LLMGenerationResult
): Promise<JobResultDisposition> {
  const disposition = await deps.handleJobResult(jobId, result);
  if (disposition === 'delivered') {
    try {
      await deps.confirmDelivery(jobId);
    } catch (err) {
      logger.warn({ err, jobId }, 'confirm failed after delivery');
    }
  }
  return disposition;
}
