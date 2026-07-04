/**
 * MultiTagPersistence — Redis adapter for multi-tag coordinator state.
 *
 * Survives bot restart: when the bot shuts down with in-flight fan-outs,
 * recovery scans the entries, marks old jobIds stale, and re-submits fresh
 * jobs. The stale-jobid set ensures pre-restart results that arrive after
 * recovery are discarded rather than double-delivered.
 *
 * Keys (see `REDIS_KEY_PREFIXES.MULTI_TAG_*`):
 *   `multitag:entry:${groupId}`               → CoordinatorEntrySnapshot JSON
 *   `multitag:job-index:${jobId}`             → groupId (reverse lookup)
 *   `multitag:source-index:${sourceMessageId}` → groupId (dedupe/source lookup)
 *   `multitag:stale-jobids`                    → SET of pre-restart jobIds
 *
 * The `Date` objects in `CoordinatorEntry` serialize as ISO strings; the
 * `fromSnapshot` reader converts back. We do NOT persist `timeoutHandle`
 * (re-armed in coordinator after rehydrate) or `personality` (re-loaded from
 * personality service via `personalitySlug`).
 */

import type { Redis } from 'ioredis';
import { MULTI_TAG } from '@tzurot/common-types/constants/message';
import { REDIS_KEY_PREFIXES } from '@tzurot/common-types/constants/queue';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { SlotSource } from './SlotResolver.js';

const logger = createLogger('MultiTagPersistence');

/**
 * TTL applied to the stale-jobs SET key on every `markStale` call. Each
 * call slides the expiry forward; the SET self-prunes when no shutdown
 * has happened for this window. 24 hours comfortably exceeds the
 * coordinator-entry TTL (`MULTI_TAG.REDIS_TTL_SEC`, 30 min) plus the
 * BullMQ default-retry budget, so live entries are never aged out
 * prematurely.
 */
const STALE_SET_TTL_SEC = 24 * 60 * 60;

/**
 * TTL for the "we already tried history-scan backfill for this DM" sentinel.
 * 1 hour balances two failure modes: too short and we keep re-scanning DMs
 * that legitimately have no session; too long and a session that
 * materializes via /activate (admin path) waits in vain for its sentinel to
 * expire. 1 hour is comfortably below any reasonable "user noticed and
 * complained" window.
 */
const DM_BACKFILL_TRIED_TTL_SEC = 60 * 60;

/**
 * TTL for the per-slot "already delivered" marker. Bound to
 * `STALE_SET_TTL_SEC` because both guard the same invariant: "recovery
 * sees stale state and decides to act." Sharing the constant keeps the
 * two markers aligned through any future tuning of the stale-window.
 */
const SLOT_DELIVERED_TTL_SEC = STALE_SET_TTL_SEC;

/**
 * SCAN COUNT hint for `scanAllEntries`. Not a hard cap — Redis treats this
 * as a per-call guideline. 100 matches the Redis convention for "moderate
 * batch" scans; small enough to avoid blocking, large enough that recovery
 * scans complete in O(entries / 100) round trips rather than O(entries).
 */
const SCAN_COUNT = 100;

/**
 * Defensive upper bound on a single Redis entry's serialized size. Snapshots
 * are bounded structurally (≤5 slots, short string fields), so a realistic
 * entry is well under 4 KB. 64 KB leaves comfortable headroom for legitimate
 * growth while preventing a malformed or unexpectedly large value from
 * blocking the recovery scan on `JSON.parse`. Redis is internal so the
 * threat surface is small; this is hardening, not security.
 */
const MAX_ENTRY_BYTES = 64 * 1024;

/**
 * Delivery context persisted when the coordinator gives up on a slot and
 * delivers a synthetic timeout. Enough to reconstruct a follow-up send if
 * the real result lands late — after `deleteEntry` has wiped the snapshot +
 * jobId index. The personality is re-loaded by slug (access-scoped to
 * `recipientUserId`) and the channel re-fetched by id; everything else here
 * feeds `DiscordResponseSender.sendResponse` directly.
 */
export interface SyntheticTimeoutContext {
  channelId: string;
  guildId: string | null;
  // `string | undefined` matches the codebase-wide clientId convention (JobTracker,
  // SlotDeliveryService, DiscordResponseSender). JSON.stringify drops an undefined
  // key, so it reads back absent rather than null — harmless here, since the consumer
  // (sendResponse) also takes `string | undefined` and treats both the same.
  clientId: string | undefined;
  personalitySlug: string;
  recipientUserId: string;
  isAutoResponse: boolean;
}

/**
 * Serializable snapshot of a single slot. Strips runtime-only fields
 * (personality object, result, timeoutHandle) — the coordinator rehydrates
 * those during recovery.
 */
export interface SlotSnapshot {
  slotIndex: number;
  personalityId: string;
  personalitySlug: string;
  /**
   * The persona UUID resolved for this (user, personality) at fan-out time —
   * captured here so crash-recovery persists the assistant message against the
   * persona that was active WHEN THE MESSAGE WAS GENERATED, not the user's
   * current persona (which may have changed while the bot was down). Empty
   * string = system-default (no real persona). Optional for backward
   * compatibility: snapshots written before this field existed lack it;
   * recovery falls back to a synthetic id in that case. bot-client no longer
   * re-resolves it (would need Prisma).
   */
  personaId?: string;
  source: SlotSource;
  isAutoResponse: boolean;
  jobId: string;
  status: 'pending' | 'completed' | 'errored' | 'timedout';
}

/**
 * Serializable snapshot of a coordinator entry. ISO timestamps; everything
 * else is plain JSON.
 */
export interface CoordinatorEntrySnapshot {
  groupId: string;
  sourceMessageId: string;
  channelId: string;
  guildId: string | null;
  userId: string;
  userMessageTime: string; // ISO
  userMessageContent: string;
  slots: SlotSnapshot[];
  createdAt: number; // epoch ms
  /**
   * Did the resolver's cap drop tagged personalities? Persisted so a
   * post-restart recovery still appends the truncation notice when the
   * group finally delivers.
   */
  truncated: boolean;
}

export class MultiTagPersistence {
  constructor(private readonly redis: Redis) {}

  /**
   * Write the entry and both reverse indices (job-index per slot,
   * source-index) atomically via a Redis MULTI. TTL is uniform so they
   * expire together if the coordinator forgets to delete them.
   */
  async putEntry(entry: CoordinatorEntrySnapshot): Promise<void> {
    const ttl = MULTI_TAG.REDIS_TTL_SEC;
    const entryKey = `${REDIS_KEY_PREFIXES.MULTI_TAG_ENTRY}${entry.groupId}`;
    const sourceKey = `${REDIS_KEY_PREFIXES.MULTI_TAG_SOURCE_INDEX}${entry.sourceMessageId}`;

    const pipeline = this.redis.multi();
    pipeline.set(entryKey, JSON.stringify(entry), 'EX', ttl);
    pipeline.set(sourceKey, entry.groupId, 'EX', ttl);
    for (const slot of entry.slots) {
      pipeline.set(
        `${REDIS_KEY_PREFIXES.MULTI_TAG_JOB_INDEX}${slot.jobId}`,
        entry.groupId,
        'EX',
        ttl
      );
    }
    await pipeline.exec();
  }

  /**
   * Replace the entry JSON and refresh its reverse indices.
   *
   * Slot status changes during fan-out (each slot result extends the
   * entry's effective lifetime); the reverse-index keys must slide along
   * with the main entry key so we don't end up with an entry whose
   * `multitag:job-index:{jobId}` pointers have already expired. Without
   * the slide, a slow-flushing group whose total wall time approaches
   * `MULTI_TAG.REDIS_TTL_SEC` could break the jobId → groupId lookup
   * silently in recovery scans.
   *
   * Uses `SET` (not `EXPIRE`) for job-index keys so recovery's new jobIds
   * also get created here — `EXPIRE` is a no-op on non-existent keys, so
   * resubmitted slots would otherwise leave the new jobId without any
   * reverse-index entry. `SET` is idempotent: refreshes if exists, creates
   * if not.
   */
  async updateEntry(entry: CoordinatorEntrySnapshot): Promise<void> {
    const ttl = MULTI_TAG.REDIS_TTL_SEC;
    const pipeline = this.redis.multi();
    pipeline.set(
      `${REDIS_KEY_PREFIXES.MULTI_TAG_ENTRY}${entry.groupId}`,
      JSON.stringify(entry),
      'EX',
      ttl
    );
    pipeline.expire(`${REDIS_KEY_PREFIXES.MULTI_TAG_SOURCE_INDEX}${entry.sourceMessageId}`, ttl);
    for (const slot of entry.slots) {
      pipeline.set(
        `${REDIS_KEY_PREFIXES.MULTI_TAG_JOB_INDEX}${slot.jobId}`,
        entry.groupId,
        'EX',
        ttl
      );
    }
    await pipeline.exec();
  }

  /**
   * Delete the entry and all its reverse indices. Called after successful
   * flush (the group has been delivered).
   */
  async deleteEntry(entry: CoordinatorEntrySnapshot): Promise<void> {
    const pipeline = this.redis.multi();
    pipeline.del(`${REDIS_KEY_PREFIXES.MULTI_TAG_ENTRY}${entry.groupId}`);
    pipeline.del(`${REDIS_KEY_PREFIXES.MULTI_TAG_SOURCE_INDEX}${entry.sourceMessageId}`);
    for (const slot of entry.slots) {
      pipeline.del(`${REDIS_KEY_PREFIXES.MULTI_TAG_JOB_INDEX}${slot.jobId}`);
    }
    await pipeline.exec();
  }

  /**
   * Scan all entries (used by MultiTagRecovery at startup). Uses SCAN
   * (non-blocking) rather than KEYS — safe on large datasets.
   */
  async scanAllEntries(): Promise<CoordinatorEntrySnapshot[]> {
    const matchPattern = `${REDIS_KEY_PREFIXES.MULTI_TAG_ENTRY}*`;
    const found: CoordinatorEntrySnapshot[] = [];
    let cursor = '0';

    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        matchPattern,
        'COUNT',
        SCAN_COUNT
      );
      cursor = next;
      if (keys.length === 0) {
        continue;
      }
      const values = await this.redis.mget(...keys);
      for (let i = 0; i < values.length; i++) {
        const parsed = parseSnapshotOrLog(keys[i], values[i]);
        if (parsed !== null) {
          found.push(parsed);
        }
      }
    } while (cursor !== '0');

    return found;
  }

  /**
   * Mark jobIds as stale. Subsequent `isStale` checks will return true; the
   * MessageHandler interception path discards their results.
   *
   * Bumps a sliding TTL on the SET key itself so orphaned jobIds (results
   * that never arrive — e.g., ai-worker also crashed between shutdown and
   * recovery) eventually fall out of the SET instead of accumulating
   * forever. The 24-hour window comfortably exceeds the coordinator-entry
   * TTL (30 min) plus any reasonable retry/grace period, so live entries
   * are never aged out prematurely.
   */
  async markStale(...jobIds: string[]): Promise<void> {
    if (jobIds.length === 0) {
      return;
    }
    const pipeline = this.redis.multi();
    pipeline.sadd(REDIS_KEY_PREFIXES.MULTI_TAG_STALE_JOBS, ...jobIds);
    pipeline.expire(REDIS_KEY_PREFIXES.MULTI_TAG_STALE_JOBS, STALE_SET_TTL_SEC);
    await pipeline.exec();
  }

  /**
   * Check whether a single jobId is in the stale set.
   *
   * Fails open on Redis errors: a transient connection blip must NOT drop
   * a user's response. The cost of a false negative here is "one duplicate
   * delivery in a restart-and-immediate-Redis-blip race" — far better than
   * silently swallowing every result during the blip window.
   */
  async isStale(jobId: string): Promise<boolean> {
    try {
      const result = await this.redis.sismember(REDIS_KEY_PREFIXES.MULTI_TAG_STALE_JOBS, jobId);
      return result === 1;
    } catch (err) {
      logger.warn(
        { err, jobId },
        'isStale Redis check failed; failing open (treating as not stale)'
      );
      return false;
    }
  }

  /**
   * Remove a jobId from the stale set after its result has been discarded.
   *
   * Fails soft on Redis errors: the stale-jobs SET has a sliding 24h TTL,
   * so an unconsumed jobId eventually self-prunes. A blip on clearStale is
   * "the SET grows by 1 for at most 24h" — worth a log line but not worth
   * propagating to the caller (which already does best-effort `.catch`).
   * Aligns the error-handling shape with sibling `isStale` and
   * `wasDMBackfillTried`, both fail-open.
   */
  async clearStale(jobId: string): Promise<void> {
    try {
      await this.redis.srem(REDIS_KEY_PREFIXES.MULTI_TAG_STALE_JOBS, jobId);
    } catch (err) {
      logger.warn({ err, jobId }, 'clearStale Redis call failed — stale entry will expire via TTL');
    }
  }

  /**
   * Record that a slot was synthetically timed out, with the delivery context
   * needed to send the real result as a follow-up if it lands late. Keyed by
   * jobId, TTL `MULTI_TAG.REDIS_TTL_SEC` (30 min) — past that, a late result
   * is dropped as before (the observed real-world lateness was ~1 min).
   *
   * Fails soft: if the marker write blips, we simply lose late-recovery for
   * that one job (it drops as it did pre-fix). Never throws into the
   * safety-timeout path.
   */
  async markSyntheticTimeout(jobId: string, ctx: SyntheticTimeoutContext): Promise<void> {
    const key = `${REDIS_KEY_PREFIXES.MULTI_TAG_SYNTHETIC_TIMEOUT}${jobId}`;
    try {
      await this.redis.set(key, JSON.stringify(ctx), 'EX', MULTI_TAG.REDIS_TTL_SEC);
    } catch (err) {
      logger.warn(
        { err, jobId },
        'markSyntheticTimeout Redis call failed — a late result for this job will be dropped, not recovered'
      );
    }
  }

  /**
   * Read the synthetic-timeout recovery context for a jobId, or null if none
   * (not a synthetic-timeout job, or marker expired). Fails soft → null.
   */
  async getSyntheticTimeout(jobId: string): Promise<SyntheticTimeoutContext | null> {
    const key = `${REDIS_KEY_PREFIXES.MULTI_TAG_SYNTHETIC_TIMEOUT}${jobId}`;
    try {
      const raw = await this.redis.get(key);
      // No deep schema validation: we wrote this marker ourselves minutes earlier and
      // the 30-min TTL keeps any cross-deploy shape drift transient. A structurally
      // valid but wrong-shaped marker would surface downstream (e.g. sendResponse),
      // not here — acceptable for a best-effort recovery path.
      return raw === null ? null : (JSON.parse(raw) as SyntheticTimeoutContext);
    } catch (err) {
      logger.warn(
        { err, jobId },
        'getSyntheticTimeout failed (Redis or JSON) — treating as no recovery marker'
      );
      return null;
    }
  }

  /**
   * Delete the synthetic-timeout marker once a late result has been recovered
   * (or determined unrecoverable). Fails soft — the marker self-expires via TTL.
   */
  async clearSyntheticTimeout(jobId: string): Promise<void> {
    const key = `${REDIS_KEY_PREFIXES.MULTI_TAG_SYNTHETIC_TIMEOUT}${jobId}`;
    try {
      await this.redis.del(key);
    } catch (err) {
      logger.warn(
        { err, jobId },
        'clearSyntheticTimeout Redis call failed — marker will expire via TTL'
      );
    }
  }

  /**
   * Set the "we already tried history-scan backfill for this DM" sentinel.
   * TTL (`DM_BACKFILL_TRIED_TTL_SEC`) prevents the scan from being
   * permanently skipped if a session eventually materializes.
   */
  async markDMBackfillTried(channelId: string, ttlSec = DM_BACKFILL_TRIED_TTL_SEC): Promise<void> {
    const key = `${REDIS_KEY_PREFIXES.MULTI_TAG_DM_BACKFILL_TRIED}${channelId}`;
    await this.redis.set(key, '1', 'EX', ttlSec);
  }

  /**
   * Returns true if we already attempted (and gave up on) backfilling this DM.
   *
   * Fails open on Redis errors: a hiccup must NOT cause the whole DM
   * processor chain to throw and swallow the user's message. The cost
   * of a false negative is "one extra history scan during the blip" —
   * acceptable.
   */
  async wasDMBackfillTried(channelId: string): Promise<boolean> {
    const key = `${REDIS_KEY_PREFIXES.MULTI_TAG_DM_BACKFILL_TRIED}${channelId}`;
    try {
      const v = await this.redis.get(key);
      return v !== null;
    } catch (err) {
      logger.warn(
        { err, channelId },
        'wasDMBackfillTried Redis check failed; failing open (will re-scan)'
      );
      return false;
    }
  }

  /**
   * Clear the "backfill tried" sentinel for a channel. Called after a
   * session materializes via the activation path so a future bare DM
   * doesn't get short-circuited to "no session" by the stale negative
   * cache. Without this, a session set via `/activate` (admin path) would
   * wait up to 1 hour for the sentinel TTL to expire before bare DMs
   * could route correctly.
   *
   * Fails soft on Redis errors — the sentinel will expire naturally via
   * its 1-hour TTL.
   */
  async clearDMBackfillTried(channelId: string): Promise<void> {
    const key = `${REDIS_KEY_PREFIXES.MULTI_TAG_DM_BACKFILL_TRIED}${channelId}`;
    try {
      await this.redis.del(key);
    } catch (err) {
      logger.warn(
        { err, channelId },
        'clearDMBackfillTried Redis call failed — sentinel will expire via TTL'
      );
    }
  }

  /**
   * Mark a slot's jobId as delivered. Written by `deliverSlot` after a
   * successful Discord send so a subsequent recovery run knows not to
   * re-dispatch the same result. Closes the narrow crash window between
   * Discord send and `deleteEntry` in `deliverGroup` where the entry
   * snapshot still shows the flush-trigger slot as pending — without
   * this marker, recovery polls BullMQ, finds the job completed, and
   * re-dispatches → duplicate user-visible delivery.
   *
   * Soft-fails on Redis errors: a marker that didn't get written results
   * in at-worst one duplicate message on a crash-during-flush, which is
   * the same failure mode the marker is designed to prevent. Logging the
   * miss is the only meaningful action.
   */
  async markSlotDelivered(jobId: string): Promise<void> {
    const key = `${REDIS_KEY_PREFIXES.MULTI_TAG_SLOT_DELIVERED}${jobId}`;
    try {
      await this.redis.set(key, '1', 'EX', SLOT_DELIVERED_TTL_SEC);
    } catch (err) {
      logger.warn(
        { err, jobId },
        'markSlotDelivered Redis call failed — recovery may re-dispatch this slot if a crash follows before deleteEntry runs'
      );
    }
  }

  /**
   * Returns true if a previous run already delivered this slot to Discord.
   * Used by `MultiTagRecovery` to skip re-dispatching deferred deliveries
   * for slots already sent. Fails closed (returns false) on Redis errors
   * because re-dispatching is safer than silently dropping: the failure
   * mode of a false negative is duplicate message; of a false positive,
   * permanently missing message. Duplicate is the better mode.
   */
  async isSlotDelivered(jobId: string): Promise<boolean> {
    const key = `${REDIS_KEY_PREFIXES.MULTI_TAG_SLOT_DELIVERED}${jobId}`;
    try {
      const v = await this.redis.get(key);
      return v !== null;
    } catch (err) {
      logger.warn(
        { err, jobId },
        'isSlotDelivered Redis check failed; failing closed (will re-dispatch — accepts duplicate over missing)'
      );
      return false;
    }
  }
}

/**
 * Parse one Redis value into a snapshot, logging and skipping on any issue
 * (corrupt JSON, missing required fields). Returns null when the record
 * isn't usable. Extracted from `scanAllEntries` so the scan loop stays
 * under the cognitive-complexity bound.
 */
function parseSnapshotOrLog(key: string, raw: string | null): CoordinatorEntrySnapshot | null {
  if (raw === null) {
    return null;
  }
  if (raw.length > MAX_ENTRY_BYTES) {
    logger.error(
      { key, size: raw.length, max: MAX_ENTRY_BYTES },
      'Skipping multi-tag entry: serialized size exceeds defensive cap'
    );
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as CoordinatorEntrySnapshot;
    // Validate every field the recovery path will consume. Tighter than
    // strictly necessary today (no recovery yet), but locking the gate
    // here keeps the follow-up PR's recovery code from having to add
    // its own validation pass.
    if (
      typeof parsed.groupId === 'string' &&
      typeof parsed.sourceMessageId === 'string' &&
      typeof parsed.channelId === 'string' &&
      typeof parsed.userId === 'string' &&
      typeof parsed.userMessageTime === 'string' &&
      typeof parsed.userMessageContent === 'string' &&
      Array.isArray(parsed.slots) &&
      parsed.slots.length > 0 &&
      parsed.slots.every(
        s =>
          typeof s.jobId === 'string' &&
          s.jobId.length > 0 &&
          typeof s.status === 'string' &&
          typeof s.personalityId === 'string' &&
          s.personalityId.length > 0 &&
          typeof s.personalitySlug === 'string' &&
          s.personalitySlug.length > 0 &&
          typeof s.source === 'string' &&
          // Optional: snapshots predating this field lack personaId; recovery
          // handles its absence with a synthetic id.
          (s.personaId === undefined || typeof s.personaId === 'string')
      )
    ) {
      // Backwards-compat: snapshots written before the `truncated` field
      // existed (or by a roll-back to an older build mid-deploy) won't have
      // it. Default to false so they parse — the worst case is the user
      // doesn't see a truncation notice for a fan-out that started under
      // the older build.
      if (typeof parsed.truncated !== 'boolean') {
        parsed.truncated = false;
      }
      // Same pattern for `isAutoResponse` on each slot. The
      // `SlotDeliveryContext.isAutoResponse` field was narrowed from
      // `boolean | undefined` to `boolean` — without this coercion, a
      // pre-narrowing snapshot (or a malformed entry) would slip through
      // the validation block above (which doesn't check this field
      // because of this default), then surface as `undefined` downstream
      // in `buildSlotContext`. Defaulting to `false` mirrors the
      // pre-narrowing implicit behavior (false-ish = explicit user
      // mention, not ambient).
      for (const slot of parsed.slots) {
        if (typeof slot.isAutoResponse !== 'boolean') {
          slot.isAutoResponse = false;
        }
      }
      return parsed;
    }
    logger.warn({ key }, 'Skipping malformed multi-tag entry (failed field validation)');
    return null;
  } catch (err) {
    logger.warn({ err, key }, 'Skipping multi-tag entry: JSON parse failed');
    return null;
  }
}
