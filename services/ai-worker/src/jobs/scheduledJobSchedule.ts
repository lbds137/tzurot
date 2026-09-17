/**
 * Scheduled-job name registry + repeatable-job cron schedule for ai-worker's
 * scheduled worker.
 *
 * Split out of `index.ts` purely to stay under the `max-lines` limit — no
 * behavior change. `index.ts` imports all three exports and keeps the
 * dispatch if-chain itself, since that chain also references the job
 * handler functions `index.ts` already wires up.
 */

import type { Queue } from 'bullmq';
import {
  RECENT_DAYS_DIGEST_SWEEP_JOB,
  RECENT_DAYS_DIGEST_SWEEP_PATTERN,
} from '@tzurot/common-types/constants/recentDaysDigest';

/** Scheduled job names */
export const SCHEDULED_JOBS = {
  PROCESS_PENDING_MEMORIES: 'process-pending-memories',
  CLEANUP_DIAGNOSTIC_LOGS: 'cleanup-diagnostic-logs',
  CLEANUP_STUCK_IMPORTS: 'cleanup-stuck-imports',
  CLEANUP_STUCK_EXPORTS: 'cleanup-stuck-exports',
  CLEANUP_EXPIRED_EXPORTS: 'cleanup-expired-exports',
  CLEANUP_CONVERSATION_RETENTION: 'cleanup-conversation-retention',
  CLEANUP_NOTIFICATIONS_RETENTION: 'cleanup-notifications-retention',
  CLEANUP_COMMAND_EVENTS: 'cleanup-command-events',
  REEMBED_NULL_VECTORS: 'reembed-null-vectors',
  RELEASE_RECONCILE: 'release-reconcile',
  ROSTER_BLURB_SWEEP: 'roster-blurb-sweep',
  RECENT_DAYS_DIGEST_SWEEP: RECENT_DAYS_DIGEST_SWEEP_JOB,
} as const;

/**
 * Repeatable-job schedule. Minute offsets are deliberate: they spread the
 * hourly/15-min jobs across the hour so runs don't stack on shared resources.
 * Conversation retention runs daily at 09:10 UTC — off-peak for the
 * primarily-US user base, offset off the hourly jobs' minute marks.
 */
export const REPEATABLE_JOB_SCHEDULE: readonly { name: string; pattern: string }[] = [
  { name: SCHEDULED_JOBS.PROCESS_PENDING_MEMORIES, pattern: '*/10 * * * *' },
  { name: SCHEDULED_JOBS.REEMBED_NULL_VECTORS, pattern: '13 * * * *' },
  { name: SCHEDULED_JOBS.CLEANUP_DIAGNOSTIC_LOGS, pattern: '0 * * * *' },
  { name: SCHEDULED_JOBS.CLEANUP_STUCK_IMPORTS, pattern: '*/15 * * * *' },
  { name: SCHEDULED_JOBS.CLEANUP_STUCK_EXPORTS, pattern: '7,22,37,52 * * * *' },
  { name: SCHEDULED_JOBS.CLEANUP_EXPIRED_EXPORTS, pattern: '30 * * * *' },
  { name: SCHEDULED_JOBS.CLEANUP_CONVERSATION_RETENTION, pattern: '10 9 * * *' },
  { name: SCHEDULED_JOBS.CLEANUP_NOTIFICATIONS_RETENTION, pattern: '25 9 * * *' },
  { name: SCHEDULED_JOBS.CLEANUP_COMMAND_EVENTS, pattern: '35 9 * * *' },
  { name: SCHEDULED_JOBS.RELEASE_RECONCILE, pattern: '41 * * * *' },
  // Every 10 minutes, on marks no other job in this list uses. The offset is
  // load-bearing, not cosmetic: a tick can run up to MAX_GENERATIONS_PER_SWEEP
  // sequential model calls at a 60s timeout each, and this worker sets no
  // concurrency (BullMQ default 1) — so any job sharing a mark queues behind a
  // generation storm rather than running.
  //
  // The marks above occupy {0,7,10,13,15,20,22,25,30,37,40,41,45,50,52}. An
  // earlier revision used :3,13,… which dodged process-pending-memories and
  // landed squarely on reembed-null-vectors' :13 — so derive the free set from
  // the whole list rather than from the one job you are avoiding. The evenly
  // spaced sets that miss everything are :4, :6, :8 and :9.
  { name: SCHEDULED_JOBS.ROSTER_BLURB_SWEEP, pattern: '4,14,24,34,44,54 * * * *' },
  // Offset off the roster-blurb sweep's :04 marks so the two inline sweeps —
  // both of which can run a string of sequential model calls on this same
  // concurrency-1 worker — never land on the same tick.
  {
    name: SCHEDULED_JOBS.RECENT_DAYS_DIGEST_SWEEP,
    pattern: RECENT_DAYS_DIGEST_SWEEP_PATTERN,
  },
];

export async function registerRepeatableJobs(scheduledQueue: Queue): Promise<void> {
  for (const { name, pattern } of REPEATABLE_JOB_SCHEDULE) {
    await scheduledQueue.add(name, {}, { repeat: { pattern }, jobId: name });
  }
}
