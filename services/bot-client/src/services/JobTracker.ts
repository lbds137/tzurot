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

// Maximum age for a job before auto-completing (prevents memory leaks)
const MAX_JOB_AGE_MS = 10 * 60 * 1000; // 10 minutes

// Discord typing lasts ~10s, refresh every 8s
const TYPING_INDICATOR_INTERVAL_MS = 8000;

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

        // Stop typing indicator after max age, but KEEP tracking the job
        // (result will still be delivered when it arrives)
        if (age > MAX_JOB_AGE_MS) {
          logger.warn(
            { jobId, ageMs: age },
            '[JobTracker] Job exceeded typing timeout - stopping indicator but keeping job tracked'
          );

          // Notify user that it's taking longer than expected
          try {
            await channel.send(
              "⏱️ This is taking longer than expected. I'm still working on it - " +
                "you'll get a response when it's ready!"
            );
          } catch (err) {
            logger.error(
              { err, jobId },
              '[JobTracker] Failed to send timeout notification to user'
            );
          }

          // Clear the typing interval to avoid rate limits, but DON'T remove the job
          // The job context must remain so we can deliver the result when it arrives
          clearInterval(typingInterval);
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
      startTime: Date.now(),
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
    }

    this.activeJobs.clear();
  }
}
