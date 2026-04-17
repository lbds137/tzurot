/**
 * Job Tracker
 *
 * Tracks active AI jobs and manages Discord typing indicators while waiting.
 * Coordinates between job submission and async result delivery.
 * Stores all context needed to handle async results (moved from MessageHandler).
 */

import { createLogger, type TypingChannel } from '@tzurot/common-types';
import type { LoadedPersonality } from '@tzurot/common-types';
import type { Message } from 'discord.js';
import type { ResponseOrderingService } from './ResponseOrderingService.js';

const logger = createLogger('JobTracker');

// How long to keep sending the typing indicator before giving up. Typing
// indicator is purely visual; after this point we stop refreshing so Discord
// isn't showing a stale indicator forever. The job itself stays tracked so
// the result still delivers when it arrives.
const TYPING_INDICATOR_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// When to surface a "this is taking longer than expected" notification to the
// user. Decoupled from TYPING_INDICATOR_TIMEOUT_MS so we can tune each
// independently — historical mistake was using one constant for both, which
// meant the notification fired too late (users gave up by 10 min) because it
// was bounded by the typing-indicator policy, not by UX desirability.
const TAKING_LONGER_NOTIFY_MS = 5 * 60 * 1000; // 5 minutes

// Discord typing lasts ~10s, refresh every 8s
const TYPING_INDICATOR_INTERVAL_MS = 8000;

// How long past TYPING_INDICATOR_TIMEOUT_MS to wait before force-releasing
// the tracker slot if no result has arrived. Generous by design: legitimate
// late results should still land, but a genuine orphan (worker crashed,
// Redis partition never recovered, BullMQ lost the job) shouldn't sit in
// memory forever. Total ceiling: 10 min typing + 30 min grace = 40 min.
const ORPHAN_SWEEP_GRACE_MS = 30 * 60 * 1000;

/**
 * Context needed to handle async job results
 * Stored here instead of in MessageHandler for statelessness
 */
export interface PendingJobContext {
  message: Message;
  personality: LoadedPersonality;
  personaId: string;
  userMessageContent: string;
  userMessageTime: Date;
  /** If true, this is an auto-response from channel activation (not @mention) */
  isAutoResponse?: boolean;
}

interface TrackedJob {
  jobId: string;
  channelId: string;
  channel: TypingChannel;
  typingInterval: NodeJS.Timeout;
  startTime: number;
  context: PendingJobContext;
  /** Sent notification message, captured so completeJob can delete it on cleanup. */
  takingLongerMessage?: Message;
  /** Prevents re-sending the notification on every typing-interval tick. */
  notificationSent?: boolean;
  /**
   * Grace-period sweep timer scheduled when the typing cutoff fires. If the
   * real result arrives first, completeJob clears this. If it never arrives,
   * the sweep releases the tracker slot so activeJobs doesn't leak.
   */
  orphanSweep?: NodeJS.Timeout;
}

export class JobTracker {
  private activeJobs = new Map<string, TrackedJob>();
  private orderingService?: ResponseOrderingService;

  /**
   * Create a new JobTracker
   * @param orderingService - Optional service to ensure responses are delivered in order
   */
  constructor(orderingService?: ResponseOrderingService) {
    this.orderingService = orderingService;
  }

  /**
   * Start tracking a job and maintain typing indicator
   */
  trackJob(jobId: string, channel: TypingChannel, context: PendingJobContext): void {
    // Clear any existing tracking for this jobId (shouldn't happen, but be safe)
    if (this.activeJobs.has(jobId)) {
      logger.warn({ jobId }, '[JobTracker] Job already tracked - clearing old tracker');
      this.completeJob(jobId);
    }

    const startTime = Date.now();

    // Start typing indicator loop
    // Wrap async function to explicitly handle promise (setInterval expects void return)
    const typingInterval = setInterval(() => {
      void (async () => {
        const age = Date.now() - startTime;

        // Send "taking longer" notification once at the 5 min mark. Previously
        // this was bundled with the typing cutoff at 10 min — too late, users
        // gave up before seeing it.
        const tracked = this.activeJobs.get(jobId);
        if (tracked && tracked.notificationSent !== true && age > TAKING_LONGER_NOTIFY_MS) {
          // Set the flag BEFORE the await so concurrent interval ticks don't
          // double-send. Trade-off: if the send below fails, we don't retry
          // — user gets no notification in a degraded-channel scenario.
          // That's the intentional default (don't spam on transient errors);
          // do NOT move this flag after the await without understanding why.
          tracked.notificationSent = true;
          try {
            const notification = await channel.send(
              "⏱️ This is taking longer than expected. I'm still working on it - " +
                "you'll get a response when it's ready!"
            );
            // Race guard: if completeJob fired during the send's round-trip,
            // the tracked entry has been removed from activeJobs — completeJob
            // saw `takingLongerMessage === undefined` and skipped the delete.
            // Writing to the orphaned `tracked` object would leak the
            // notification. Detect and delete immediately in that case.
            if (this.activeJobs.get(jobId) === tracked) {
              tracked.takingLongerMessage = notification;
            } else {
              void notification.delete().catch(deleteErr => {
                logger.debug(
                  { err: deleteErr, jobId },
                  '[JobTracker] Delete of orphaned taking-longer notification failed'
                );
              });
            }
          } catch (err) {
            logger.error(
              { err, jobId },
              '[JobTracker] Failed to send taking-longer notification to user'
            );
          }
        }

        // Stop typing indicator after max age, but KEEP tracking the job
        // (result will still be delivered when it arrives)
        if (age > TYPING_INDICATOR_TIMEOUT_MS) {
          logger.warn(
            { jobId, ageMs: age },
            '[JobTracker] Job exceeded typing timeout - stopping indicator but keeping job tracked'
          );
          // Clear the typing interval to avoid rate limits, but DON'T remove the job
          // The job context must remain so we can deliver the result when it arrives
          clearInterval(typingInterval);
          // Arm an orphan sweep: if the result never arrives within the
          // grace period, release the tracker slot instead of leaking.
          this.scheduleOrphanSweep(jobId, startTime);
          return;
        }

        try {
          await channel.sendTyping();
          logger.debug({ jobId }, '[JobTracker] Sent typing indicator');
        } catch (error) {
          logger.error({ err: error, jobId }, '[JobTracker] Failed to send typing indicator');
          // Don't clear interval - channel might be temporarily unavailable
        }
      })();
    }, TYPING_INDICATOR_INTERVAL_MS);

    // Send initial typing indicator immediately
    channel.sendTyping().catch(error => {
      logger.error({ err: error, jobId }, '[JobTracker] Failed to send initial typing indicator');
    });

    this.activeJobs.set(jobId, {
      jobId,
      channelId: channel.id,
      channel,
      typingInterval,
      // Reuse the same clock reading captured at line 81 so the interval
      // closure's `age` calculation and any future caller inspecting
      // `TrackedJob.startTime` share one source of truth.
      startTime,
      context,
    });

    // Register with ordering service to ensure responses are delivered in message order
    if (this.orderingService) {
      this.orderingService.registerJob(channel.id, jobId, context.userMessageTime);
    }

    logger.info({ jobId, channelId: channel.id }, '[JobTracker] Started tracking job with context');
  }

  /**
   * Stop tracking a job and clear typing indicator
   * Returns the channel if job was tracked, null otherwise
   */
  completeJob(jobId: string): TypingChannel | null {
    const tracked = this.activeJobs.get(jobId);

    if (!tracked) {
      logger.warn({ jobId }, '[JobTracker] Attempted to complete untracked job');
      return null;
    }

    // Clear typing interval
    clearInterval(tracked.typingInterval);

    // Clear the orphan sweep timer if one was armed (job completed before
    // the grace period elapsed — the sweep is no longer needed).
    if (tracked.orphanSweep) {
      clearTimeout(tracked.orphanSweep);
    }

    // Clean up the "taking longer" notification if it was sent. The real
    // response is about to arrive, so leaving the notification in the channel
    // reads like a false signal that something's still wrong. Silent-swallow
    // delete failures — Discord can 404 (user deleted it) or 429 (rate
    // limited) and neither should throw out of completeJob.
    if (tracked.takingLongerMessage) {
      void tracked.takingLongerMessage.delete().catch(err => {
        logger.debug({ err, jobId }, '[JobTracker] Delete of taking-longer notification failed');
      });
    }

    const waitTime = Date.now() - tracked.startTime;
    logger.info(
      { jobId, channelId: tracked.channelId, waitTimeMs: waitTime },
      `[JobTracker] Completed job after ${Math.round(waitTime / 1000)}s`
    );

    this.activeJobs.delete(jobId);
    return tracked.channel;
  }

  /**
   * Check if a job is being tracked
   */
  isTracking(jobId: string): boolean {
    return this.activeJobs.has(jobId);
  }

  /**
   * Get pending job context
   * Returns the context if job is tracked, null otherwise
   */
  getContext(jobId: string): PendingJobContext | null {
    const tracked = this.activeJobs.get(jobId);
    return tracked ? tracked.context : null;
  }

  /**
   * Get stats for monitoring
   */
  getStats(): { activeJobs: number; oldestJobAge: number | null } {
    const count = this.activeJobs.size;

    let oldestAge: number | null = null;
    if (count > 0) {
      const now = Date.now();
      for (const job of this.activeJobs.values()) {
        const age = now - job.startTime;
        if (oldestAge === null || age > oldestAge) {
          oldestAge = age;
        }
      }
    }

    return {
      activeJobs: count,
      oldestJobAge: oldestAge,
    };
  }

  /**
   * Cleanup on shutdown
   */
  cleanup(): void {
    logger.info({ activeJobs: this.activeJobs.size }, '[JobTracker] Cleaning up tracked jobs');

    for (const job of this.activeJobs.values()) {
      clearInterval(job.typingInterval);
      if (job.orphanSweep) {
        clearTimeout(job.orphanSweep);
      }
    }

    this.activeJobs.clear();
  }

  /**
   * Schedule a grace-period sweep that force-completes the job if the result
   * never arrives. Called when the typing indicator cutoff fires. The sweep
   * checks `activeJobs.has(jobId)` at fire time — if the real result landed
   * first, the entry is already gone and the sweep is a no-op.
   */
  private scheduleOrphanSweep(jobId: string, startTime: number): void {
    const tracked = this.activeJobs.get(jobId);
    if (!tracked) {return;}
    tracked.orphanSweep = setTimeout(() => {
      if (this.activeJobs.has(jobId)) {
        logger.warn(
          { jobId, ageMs: Date.now() - startTime },
          '[JobTracker] Orphan sweep — job never completed past grace period, releasing tracker'
        );
        this.completeJob(jobId);
      }
    }, ORPHAN_SWEEP_GRACE_MS);
  }
}
