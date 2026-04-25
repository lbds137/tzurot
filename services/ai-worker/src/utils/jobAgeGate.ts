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
import { ExpiredJobError } from './attachmentFetch.js';

/**
 * Default queue-age threshold. Matches `DownloadAttachmentsStep`'s inline
 * constant so both job families fail at the same boundary.
 */
export const MAX_QUEUE_AGE_MS = 12 * 60 * 60 * 1000;

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
