/**
 * The durable record of a reroll that has begun editing Discord.
 *
 * The in-memory handler that runs begin → commit → finish/restore dies with the
 * process. Without a record, a restart between the first Discord edit and the
 * end of the commit leaves the new text on Discord and the old text in history
 * (and, once the job record was deleted, nothing that would notice). The handler
 * writes this record BEFORE it edits anything, keeps its extra-message list
 * current, and deletes it once finish or restore has completed. Startup recovery
 * (`rerollRecovery.ts`) settles whatever a dead process left.
 *
 * Every record carries the boot id of the process that wrote it, so recovery can
 * skip the records of live handlers in its own process. The record holds the
 * pre-edit chunk text (needed to put it back), never logged: log ids only.
 */

import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { GATEWAY_TIMEOUTS } from '@tzurot/common-types/constants/discord';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { z } from 'zod';

const logger = createLogger('reroll-inflight');

const KEY_PREFIX = 'reroll:inflight:';

/** SCAN page size hint. */
const SCAN_COUNT = 100;

/**
 * How long an unsettled record survives. A day: long enough that a bot down
 * overnight still repairs its Discord message at the next boot, short enough
 * that an abandoned record cannot outlive the reply it describes.
 */
export const REROLL_INFLIGHT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * How long a Discord phase (begin, restore or finish: one edit or send per
 * chunk, up to `MAX_REPLY_CHUNKS`, through discord.js's rate limiter) is
 * budgeted to take. An assumption, not a measurement: nothing bounds those
 * phases in code, so this is the figure the minimum record age leans on.
 */
const DISCORD_PHASE_BUDGET_MS = 90_000;

/**
 * Recovery claims only a record last written at least this long ago; a younger
 * one may belong to a handler still running in an OLD process (a rolling deploy
 * boots the new process before the old one has stopped). Derived from the
 * longest path a live handler spends between `writeInflight` and its final
 * delete: begin (a Discord phase) → commit (a gateway write) → abort (a gateway
 * write) → restore (a Discord phase) → the definite-refusal path's second abort
 * (a gateway write), i.e. three gateway writes plus two Discord phases.
 */
export const REROLL_INFLIGHT_MIN_AGE_MS = 3 * GATEWAY_TIMEOUTS.WRITE + 2 * DISCORD_PHASE_BUDGET_MS;

/** Identifies this process; a record carrying it belongs to a live handler here. */
export const REROLL_BOOT_ID: string = randomUUID();

const recordSchema = z.object({
  jobId: z.string().min(1),
  rowId: z.string().min(1),
  attemptId: z.string().min(1),
  /** Boot id of the process that last wrote the record. */
  bootId: z.string().min(1),
  /** Discord id the gateway calls act as (the clicker). */
  actorId: z.string().min(1),
  /** First stored Discord chunk id: the gateway's route key for the row. */
  routeKey: z.string().min(1),
  /** The old reply's planned memory ids, which an abort must not touch. */
  keepMemoryIds: z.array(z.string()),
  /** Channel or thread the chunks live in. */
  channelId: z.string().min(1),
  personalityId: z.string().min(1),
  /** The old row's content when the record was written: recovery refuses to restore over a row that changed. */
  rowContent: z.string(),
  /** Every live chunk of the old reply, in order, with the text it held before the edit. */
  chunks: z.array(z.object({ id: z.string().min(1), before: z.string() })).min(1),
  /** How many leading chunks the edit overwrites; the rest are surplus a commit deletes. */
  editedCount: z.number().int().nonnegative(),
  /** Extra chunks sent so far (updated after each send); an undo deletes them. */
  extraIds: z.array(z.string()),
  /** The memory and pending ids the attempt reported: the abort's fallback when `job_results` has no row. */
  newMemoryIds: z.array(z.string()),
  newPendingIds: z.array(z.string()),
  /** When the record was first written (ms epoch): write-backs keep it, so the TTL is counted from here. */
  createdAt: z.number().int().nonnegative(),
  /** When the record was last written (ms epoch); recovery leaves a record younger than the minimum age alone. */
  writtenAt: z.number().int().nonnegative(),
});

export type RerollInflightRecord = z.infer<typeof recordSchema>;

export interface InflightRecordInput {
  jobId: string;
  rowId: string;
  attemptId: string;
  actorId: string;
  routeKey: string;
  keepMemoryIds: string[];
  newMemoryIds: string[];
  newPendingIds: string[];
  channelId: string;
  personalityId: string;
  rowContent: string;
  /** The live chunks about to be edited, in order. */
  liveChunks: readonly { id: string; content: string }[];
  /** How many chunks the new reply needs; the overlap with `liveChunks` is overwritten. */
  newChunkCount: number;
}

/** The record for an edit about to begin, owned by this process. */
export function buildInflightRecord(input: InflightRecordInput): RerollInflightRecord {
  const { liveChunks, newChunkCount, ...rest } = input;
  const now = Date.now();
  return {
    ...rest,
    bootId: REROLL_BOOT_ID,
    createdAt: now,
    writtenAt: now,
    chunks: liveChunks.map(chunk => ({ id: chunk.id, before: chunk.content })),
    editedCount: Math.min(liveChunks.length, newChunkCount),
    extraIds: [],
  };
}

function keyFor(jobId: string): string {
  return `${KEY_PREFIX}${jobId}`;
}

function parseRecord(raw: unknown): RerollInflightRecord | null {
  if (typeof raw !== 'string') {
    return null;
  }
  try {
    const parsed = recordSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Milliseconds the record may still live: its TTL counted from `createdAt`, so write-backs never extend it. */
export function inflightRemainingMs(record: RerollInflightRecord, now = Date.now()): number {
  return record.createdAt + REROLL_INFLIGHT_TTL_MS - now;
}

/**
 * Write (or overwrite) the record, stamping `writtenAt` on it. The key expires
 * on the record's ORIGINAL schedule (`createdAt` + TTL), never a fresh TTL: a
 * record rewritten across restarts must not outlive the reroll it describes. A
 * record already past that point is not written. Never throws: a lost record
 * costs the restart repair, not the reroll. True when the record was stored.
 */
export async function writeInflight(redis: Redis, record: RerollInflightRecord): Promise<boolean> {
  const now = Date.now();
  const ttl = inflightRemainingMs(record, now);
  if (ttl <= 0) {
    return false;
  }
  record.writtenAt = now;
  try {
    await redis.set(keyFor(record.jobId), JSON.stringify(record), 'PX', ttl);
    return true;
  } catch (err) {
    logger.warn(
      { err, jobId: record.jobId },
      'Could not write the reroll in-flight record; a restart now would not repair Discord'
    );
    return false;
  }
}

/** Add a sent extra chunk to the record (and to `record`, the caller's live copy). Never throws. */
export async function appendInflightExtra(
  redis: Redis,
  record: RerollInflightRecord,
  messageId: string
): Promise<void> {
  record.extraIds.push(messageId);
  await writeInflight(redis, record);
}

/** Remove the record once its reroll is settled. Never throws. */
export async function deleteInflight(redis: Redis, jobId: string): Promise<void> {
  try {
    await redis.del(keyFor(jobId));
  } catch (err) {
    logger.warn({ err, jobId }, 'Could not delete the reroll in-flight record; its TTL will');
  }
}

/** The job's record, read without claiming it. Null when absent, unreadable or on a Redis failure. Never throws. */
export async function peekInflight(
  redis: Redis,
  jobId: string
): Promise<RerollInflightRecord | null> {
  try {
    return parseRecord(await redis.get(keyFor(jobId)));
  } catch {
    return null;
  }
}

/** Job ids of every stored record, by SCAN (never KEYS). Never throws; a failed page ends the walk. */
export async function scanInflightJobIds(redis: Redis): Promise<string[]> {
  const jobIds: string[] = [];
  let cursor = '0';
  try {
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${KEY_PREFIX}*`, 'COUNT', SCAN_COUNT);
      cursor = next;
      jobIds.push(...keys.map(key => key.slice(KEY_PREFIX.length)));
    } while (cursor !== '0');
  } catch (err) {
    logger.warn({ err }, 'Reroll in-flight scan failed part-way');
  }
  return jobIds;
}

/**
 * Claim a record: peek, and when `accept` takes it, read-and-delete in one
 * MULTI so of two concurrent claimers exactly one gets it (the same shape as
 * `takeRerollJob`). The claimed value is checked against `accept` again; one
 * that no longer qualifies (a live handler rewrote the key between the peek and
 * the claim) is put back untouched. Null when absent, refused, malformed or
 * claimed by someone else. Never throws.
 */
export async function claimInflight(
  redis: Redis,
  jobId: string,
  accept: (record: RerollInflightRecord) => boolean
): Promise<RerollInflightRecord | null> {
  try {
    const key = keyFor(jobId);
    const peeked = parseRecord(await redis.get(key));
    if (peeked === null || !accept(peeked)) {
      return null;
    }
    const replies = await redis.multi().get(key).del(key).exec();
    const raw: unknown = replies?.[0]?.[1];
    const claimed = parseRecord(raw);
    if (claimed === null) {
      return null;
    }
    if (!accept(claimed)) {
      const remaining = inflightRemainingMs(claimed);
      if (remaining > 0) {
        await redis.set(key, JSON.stringify(claimed), 'PX', remaining);
      }
      return null;
    }
    return claimed;
  } catch (err) {
    logger.warn({ err, jobId }, 'Could not claim the reroll in-flight record');
    return null;
  }
}
