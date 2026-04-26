/**
 * Job Age Gate
 *
 * Shared helper for failing fast on BullMQ jobs that have sat in the queue
 * long enough that their Discord CDN URLs are likely to have expired. Produces
 * a classified `ExpiredJobError` so telemetry can distinguish "CDN URL stale
 * from queue backpressure" from "attachment fetch failed for some other reason."
 *
 * Threshold rationale: Discord CDN tokens last ~24h. Failing at 12h gives a
 * safety margin that still lets pathological backpressure surface cleanly
 * instead of silently producing 403s from the CDN.
 */

import type { Job } from 'bullmq';
import type { Logger } from 'pino';

/**
 * Default queue-age threshold. The single source of truth for both LLM
 * generation and audio transcription job families.
 */
export const MAX_QUEUE_AGE_MS = 12 * 60 * 60 * 1000;

/**
 * Error thrown when a job's timestamp suggests its Discord CDN URLs have expired.
 * Surfaces to the user as a classified async error result; distinguishable from
 * download failures so telemetry can track queue-backpressure incidents.
 *
 * Lives here (not in attachmentFetch.ts) because it's a job-lifecycle error,
 * not a fetch concern — its only producer is `checkQueueAge`.
 */
export class ExpiredJobError extends Error {
  readonly queueAgeMs: number;
  constructor(queueAgeMs: number) {
    super(
      `Job sat in queue for ${Math.round(queueAgeMs / 1000)}s, Discord CDN URLs have likely expired`
    );
    this.name = 'ExpiredJobError';
    this.queueAgeMs = queueAgeMs;
  }
}

/**
 * Throw `ExpiredJobError` if `job.timestamp` is older than `maxAgeMs` ago.
 * Otherwise does nothing. Callers should invoke this before any outbound
 * fetch of URLs that were enqueued alongside `job.timestamp`.
 *
 * @param job - The BullMQ job (any data shape — we only read `timestamp` and `id`)
 * @param jobLogger - Logger to warn on threshold trip (structured log with queueAgeMs + jobId)
 * @param maxAgeMs - Maximum allowed age in milliseconds (defaults to MAX_QUEUE_AGE_MS).
 *   Override only when a job family needs a tighter or looser threshold; the
 *   default keeps both LLM generation and audio transcription on a 12h boundary.
 */
export function checkQueueAge(
  job: Pick<Job, 'id' | 'timestamp'>,
  jobLogger: Logger,
  maxAgeMs: number = MAX_QUEUE_AGE_MS
): void {
  const queueAgeMs = Date.now() - job.timestamp;
  if (queueAgeMs > maxAgeMs) {
    jobLogger.warn(
      { jobId: job.id, queueAgeMs, maxQueueAgeMs: maxAgeMs },
      'Job exceeded queue-age threshold; Discord CDN URLs likely expired'
    );
    throw new ExpiredJobError(queueAgeMs);
  }
}
