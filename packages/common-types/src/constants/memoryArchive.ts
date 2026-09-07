/**
 * Shared constants for the memory-archive summarizer. Lives in common-types
 * because both ai-worker (the summarizer itself) and packages/tooling (the
 * operator pre-warm sweep) need the prompt version, and tooling cannot import
 * from a service.
 */

/** Bump when the summarizer's system/user prompt text changes meaningfully —
 *  a re-summarize sweep keys off this to know which stored summaries are stale. */
export const ARCHIVE_SUMMARY_PROMPT_VERSION = 1;

/**
 * Shared BullMQ job options for the archive-summary queue. Both the live
 * queue's `defaultJobOptions` (`services/ai-worker/src/jobs/archiveSummarySetup.ts`)
 * and the operator pre-warm sweep's per-add options
 * (`packages/tooling/src/memory/summarize-sweep.ts`) read from here — BullMQ
 * applies job options per `Queue` instance, and the two are separate
 * instances, so without a shared source they'd drift independently.
 *
 * `removeOnComplete`/`removeOnFail` are plain booleans rather than history
 * counts because the memory ROW is the ledger (summary_status,
 * summary_attempts, summary_last_error) — Redis only needs to keep the
 * in-flight job set, so a completed or failed job leaves Redis immediately.
 * That's what lets a later re-enqueue of the same memory id (the
 * deterministic jobId) be accepted rather than silently deduped against a
 * stale completed/failed entry.
 */
export const ARCHIVE_SUMMARY_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 30_000 },
  removeOnComplete: true,
  removeOnFail: true,
} as const;
