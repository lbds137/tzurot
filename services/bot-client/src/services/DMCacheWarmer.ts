/**
 * DMCacheWarmer — pre-establishes Discord DM channels in the Discord.js cache.
 *
 * Why this exists: Discord.js v14+ MessageCreateAction silently drops DM
 * MESSAGE_CREATE events when the channel isn't already cached, because the
 * payload lacks the `recipients` field needed to construct a partial channel
 * (even with Partials.Channel set). The channel must be in cache *before*
 * the MESSAGE_CREATE event arrives.
 *
 * Empirically diagnosed via the [DJS DEBUG] listener in PR #915, which
 * captured `"Failed to find guild, or unknown type for channel <id> undefined"`
 * on every plain-text DM until a slash-command interaction populated the
 * cache for that user. This service replicates the cache-population side
 * effect by calling `user.createDM()` proactively whenever we encounter a
 * user via any event channel.
 *
 * The memo bounds createDM to once-per-user-per-process-lifetime and stores the
 * ATTEMPT itself (a promise of its outcome), not merely "attempted" — so a
 * repeat or concurrent caller awaits the same attempt and receives its REAL
 * result, never a hardcoded success over a prior failure. Growth is bounded by
 * the number of unique users who interact with the bot during a single process
 * — typically well under 10k for this scale of bot. Process restart clears the
 * memo, matching Discord-side cache lifecycle.
 */

import { createLogger } from '@tzurot/common-types/utils/logger';
import type { User } from 'discord.js';

const logger = createLogger('DMCacheWarmer');

export class DMCacheWarmer {
  // userId → the single memoized createDM attempt. Storing the PROMISE (not a
  // bare "attempted" flag) means a repeat call — or a concurrent one, e.g. the
  // startup prewarmer racing the live event path for the same active user —
  // awaits the same attempt and gets its true outcome. A prior FAILED attempt
  // therefore reports false on the next call, never a hardcoded true.
  private warmAttempts = new Map<string, Promise<boolean>>();

  /**
   * Idempotently ensure the DM channel for `user` is cached, RETURNING the real
   * outcome: true if createDM resolved, false if it failed. At most one
   * createDM() per user per process lifetime; repeat/concurrent callers await
   * the same memoized attempt and receive its actual result. Use this where the
   * caller needs an honest success signal (the startup pre-warm tally);
   * event-path callers use the fire-and-forget `warm`.
   */
  warmAwaitable(user: User): Promise<boolean> {
    const existing = this.warmAttempts.get(user.id);
    if (existing !== undefined) {
      return existing;
    }
    // Create the attempt (createDM fires synchronously here) and memoize it
    // BEFORE returning, so a concurrent caller in the same tick reuses it
    // instead of firing a second createDM.
    const attempt = this.attemptWarm(user);
    this.warmAttempts.set(user.id, attempt);
    return attempt;
  }

  private async attemptWarm(user: User): Promise<boolean> {
    try {
      await user.createDM();
      return true;
    } catch (err: unknown) {
      // DM creation can fail for users with privacy DMs blocked, deleted
      // accounts, or while the bot itself is quarantined. We just lose the
      // warming optimization for this user; their DMs would fail dispatch the
      // same way, but slash-command-based recovery still works as a fallback.
      logger.debug({ err, userId: user.id }, 'createDM failed during warming');
      return false;
    }
  }

  /**
   * Idempotently ensure the DM channel for `user` is cached in Discord.js.
   * Fire-and-forget: failures are logged but don't propagate. For event-path
   * callers that must not block on createDM latency.
   */
  warm(user: User): void {
    void this.warmAwaitable(user);
  }

  /** Number of users with a memoized warm attempt. */
  get size(): number {
    return this.warmAttempts.size;
  }

  /** Test hook: clear the attempt memo. */
  clear(): void {
    this.warmAttempts.clear();
  }

  /** Test hook: check whether a user has a memoized warm attempt. */
  has(userId: string): boolean {
    return this.warmAttempts.has(userId);
  }
}
