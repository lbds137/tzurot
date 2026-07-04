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
 * The Set memo bounds calls to once-per-user-per-process-lifetime. Set growth
 * is bounded by the number of unique users who interact with the bot during
 * a single process — typically well under 10k for this scale of bot. Process
 * restart clears the memo, matching Discord-side cache lifecycle.
 */

import { createLogger } from '@tzurot/common-types/utils/logger';
import type { User } from 'discord.js';

const logger = createLogger('DMCacheWarmer');

export class DMCacheWarmer {
  private warmedUserIds = new Set<string>();

  /**
   * Idempotently ensure the DM channel for `user` is cached in Discord.js.
   * Fire-and-forget: failures are logged but don't propagate.
   */
  warm(user: User): void {
    if (this.warmedUserIds.has(user.id)) {
      return;
    }

    this.warmedUserIds.add(user.id);
    void user.createDM().catch((err: unknown) => {
      // DM creation can fail for users with privacy DMs blocked, deleted
      // accounts, etc. We just lose the warming optimization for this user;
      // their DMs would fail dispatch the same way, but slash-command-based
      // recovery still works as a fallback path.
      logger.debug({ err, userId: user.id }, 'createDM failed during warming');
    });
  }

  /** Number of users currently in the warmed-set memo. */
  get size(): number {
    return this.warmedUserIds.size;
  }

  /** Test hook: clear the warmed-set memo. */
  clear(): void {
    this.warmedUserIds.clear();
  }

  /** Test hook: check whether a user has been warmed. */
  has(userId: string): boolean {
    return this.warmedUserIds.has(userId);
  }
}
