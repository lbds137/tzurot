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
import { createLogger, MULTI_TAG, REDIS_KEY_PREFIXES } from '@tzurot/common-types';
import type { SlotSource } from './SlotResolver.js';

const logger = createLogger('MultiTagPersistence');

/**
 * Serializable snapshot of a single slot. Strips runtime-only fields
 * (personality object, result, timeoutHandle) — the coordinator rehydrates
 * those during recovery.
 */
export interface SlotSnapshot {
  slotIndex: number;
  personalityId: string;
  personalitySlug: string;
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
   * Replace just the entry JSON (e.g., after a slot's status changed). The
   * source-index and job-indices don't need refreshing on every update —
   * they're set once at `putEntry` time with the same TTL.
   */
  async updateEntry(entry: CoordinatorEntrySnapshot): Promise<void> {
    const entryKey = `${REDIS_KEY_PREFIXES.MULTI_TAG_ENTRY}${entry.groupId}`;
    await this.redis.set(entryKey, JSON.stringify(entry), 'EX', MULTI_TAG.REDIS_TTL_SEC);
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
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', matchPattern, 'COUNT', 100);
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
   */
  async markStale(...jobIds: string[]): Promise<void> {
    if (jobIds.length === 0) {
      return;
    }
    await this.redis.sadd(REDIS_KEY_PREFIXES.MULTI_TAG_STALE_JOBS, ...jobIds);
  }

  /** Check whether a single jobId is in the stale set. */
  async isStale(jobId: string): Promise<boolean> {
    const result = await this.redis.sismember(REDIS_KEY_PREFIXES.MULTI_TAG_STALE_JOBS, jobId);
    return result === 1;
  }

  /** Remove a jobId from the stale set after its result has been discarded. */
  async clearStale(jobId: string): Promise<void> {
    await this.redis.srem(REDIS_KEY_PREFIXES.MULTI_TAG_STALE_JOBS, jobId);
  }

  /**
   * Set the "we already tried history-scan backfill for this DM" sentinel.
   * TTL prevents the scan from being permanently skipped if a session
   * eventually materializes.
   */
  async markDMBackfillTried(channelId: string, ttlSec = 3600): Promise<void> {
    const key = `${REDIS_KEY_PREFIXES.MULTI_TAG_DM_BACKFILL_TRIED}${channelId}`;
    await this.redis.set(key, '1', 'EX', ttlSec);
  }

  /** Returns true if we already attempted (and gave up on) backfilling this DM. */
  async wasDMBackfillTried(channelId: string): Promise<boolean> {
    const key = `${REDIS_KEY_PREFIXES.MULTI_TAG_DM_BACKFILL_TRIED}${channelId}`;
    const v = await this.redis.get(key);
    return v !== null;
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
  try {
    const parsed = JSON.parse(raw) as CoordinatorEntrySnapshot;
    if (
      typeof parsed.groupId === 'string' &&
      Array.isArray(parsed.slots) &&
      parsed.slots.length > 0
    ) {
      return parsed;
    }
    logger.warn({ key }, 'Skipping malformed multi-tag entry (missing required fields)');
    return null;
  } catch (err) {
    logger.warn({ err, key }, 'Skipping multi-tag entry: JSON parse failed');
    return null;
  }
}
