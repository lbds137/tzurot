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

/**
 * What became of a job result handed to `handleJobResult`.
 *
 * `'delivered'` means the result reached a path that produced a user-visible
 * outcome, or one that owns its own delivery confirmation. `'dropped'` means
 * it was discarded with nothing shown to the user — the caller MUST NOT
 * confirm delivery for it, because a confirmed row records a reply the user
 * never received and nothing ever revisits `PENDING_DELIVERY` rows to notice.
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
 * confirm decision itself is made here and nowhere else.
 */
export async function deliverJobResult(
  deps: JobResultDeliveryDeps,
  jobId: string,
  result: LLMGenerationResult
): Promise<JobResultDisposition> {
  const disposition = await deps.handleJobResult(jobId, result);
  if (disposition === 'delivered') {
    await deps.confirmDelivery(jobId);
  }
  return disposition;
}
