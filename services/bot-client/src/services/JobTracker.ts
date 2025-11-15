/**
 * Job Tracker
 *
 * Tracks active AI jobs and manages Discord typing indicators while waiting.
 * Coordinates between job submission and async result delivery.
 * Stores all context needed to handle async results (moved from MessageHandler).
 */

import { createLogger } from '@tzurot/common-types';
import type { LoadedPersonality } from '@tzurot/common-types';
import type { Message, TextChannel, DMChannel, NewsChannel } from 'discord.js';

const logger = createLogger('JobTracker');

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
}

interface TrackedJob {
  jobId: string;
  channelId: string;
  channel: TextChannel | DMChannel | NewsChannel;
  typingInterval: NodeJS.Timeout;
  startTime: number;
  context: PendingJobContext;
}

export class JobTracker {
  private activeJobs = new Map<string, TrackedJob>();

  /**
   * Start tracking a job and maintain typing indicator
   */
  trackJob(
    jobId: string,
    channel: TextChannel | DMChannel | NewsChannel,
    context: PendingJobContext
  ): void {
    // Clear any existing tracking for this jobId (shouldn't happen, but be safe)
    if (this.activeJobs.has(jobId)) {
      logger.warn({ jobId }, '[JobTracker] Job already tracked - clearing old tracker');
      this.completeJob(jobId);
    }

    // Start typing indicator loop (Discord typing lasts ~10s, refresh every 8s)
    const typingInterval = setInterval(async () => {
      try {
        await channel.sendTyping();
        logger.debug({ jobId }, '[JobTracker] Sent typing indicator');
      } catch (error) {
        logger.error({ err: error, jobId }, '[JobTracker] Failed to send typing indicator');
        // Don't clear interval - channel might be temporarily unavailable
      }
    }, 8000);

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

    logger.info(
      { jobId, channelId: channel.id },
      '[JobTracker] Started tracking job with context'
    );
  }

  /**
   * Stop tracking a job and clear typing indicator
   * Returns the channel if job was tracked, null otherwise
   */
  completeJob(jobId: string): (TextChannel | DMChannel | NewsChannel) | null {
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
