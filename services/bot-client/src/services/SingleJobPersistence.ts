/**
 * SingleJobPersistence — Redis adapter for single-personality job delivery
 * context.
 *
 * **Why this exists**: `JobTracker.activeJobs` is an in-memory Map. A restart
 * empties it, so a job that was in flight across the restart loses its
 * delivery target — the result arrives on the `job-results` stream, finds no
 * context, and is discarded. `MultiTagRecovery` covers the fan-out case only
 * (it scans `multitag:entry:*`), which is why a single-personality request in
 * flight across a deploy had nothing to recover from.
 *
 * Keys (see `REDIS_KEY_PREFIXES.SINGLE_JOB_CONTEXT`):
 *   `singlejob:context:${jobId}` → PersistedJobContext JSON
 *
 * A `TrackedJob` holds live objects — a `NodeJS.Timeout`, a discord.js
 * channel, a `Message` — none of which survive JSON. We persist IDENTIFIERS
 * and re-fetch the Discord objects at recovery, the same shape
 * `MultiTagPersistence` uses for its slot snapshots (channel by id, source
 * message by id, personality by slug/id, persona from the snapshot).
 */

import type { Redis } from 'ioredis';
import { z } from 'zod';
import { REDIS_KEY_PREFIXES } from '@tzurot/common-types/constants/queue';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { DEFAULT_SCAN_COUNT, scanJsonEntries } from '../utils/scanJsonEntries.js';
import {
  TRACKED_JOB_MAX_LIFETIME_MS,
  type PendingJobContext,
  type TrackedJobRecorder,
} from './JobTracker.js';

const logger = createLogger('SingleJobPersistence');

/**
 * TTL for a persisted single-job context.
 *
 * Derived from `TRACKED_JOB_MAX_LIFETIME_MS` — the in-memory tracker's own
 * ceiling (typing-indicator cutoff plus the orphan-sweep grace period) — so a
 * persisted entry never outlives the tracker slot it mirrors. Had the process
 * stayed up, `JobTracker`'s orphan sweep would have released the job at
 * exactly this age; a restart must not extend that budget.
 */
export const SINGLE_JOB_CONTEXT_TTL_SEC = Math.ceil(TRACKED_JOB_MAX_LIFETIME_MS / 1000);

/**
 * SCAN COUNT hint for `scanAll`. Shared with `MultiTagPersistence` via
 * `scanJsonEntries`, whose default this re-states explicitly so the value
 * stays visible at the call site.
 */
const SCAN_COUNT = DEFAULT_SCAN_COUNT;

/**
 * Defensive upper bound on one serialized entry, mirroring
 * `MultiTagPersistence`'s cap. Compared against `raw.length` — UTF-16 code
 * units, not bytes — so multi-byte content is admitted up to roughly this
 * many characters rather than exactly this many bytes. Deliberately loose:
 * a single-job context is structurally small (a handful of ids plus the
 * user's message content), and the cap exists only to stop a malformed
 * value from dominating the boot scan, not to enforce a precise size.
 */
const MAX_ENTRY_BYTES = 64 * 1024;

/**
 * Fields shared by both persisted context variants — the serializable half of
 * `BaseJobContext`. `channel`, `personality` and the typing timer are absent
 * by design: they are re-fetched/re-loaded at recovery.
 */
const BasePersistedContextSchema = z.object({
  jobId: z.string().min(1),
  channelId: z.string().min(1),
  guildId: z.string().nullable(),
  /**
   * `.optional()` rather than nullable: `JSON.stringify` drops an undefined
   * key entirely, so an absent clientId reads back as a missing key. Matches
   * the codebase-wide `string | undefined` clientId convention.
   */
  clientId: z.string().optional(),
  userMessageTime: z.string().min(1),
  personalityId: z.string().min(1),
  personalitySlug: z.string().min(1),
  /**
   * Deliberately NOT `.min(1)`, unlike its sibling identifier fields: the
   * empty string is a meaningful value here, not a missing one. It means
   * "system-default — no real persona", the same convention
   * `MultiTagPersistence.SlotSnapshot.personaId` documents. Requiring a
   * non-empty string would fail validation on a legitimate snapshot and make
   * `SingleJobRecovery` discard a recoverable job — re-creating the silent
   * drop this persistence layer exists to prevent. Pinned by the
   * 'a system-default persona survives the round trip' case in
   * `SingleJobPersistence.test.ts`, which fails if `.min(1)` is added here.
   */
  personaId: z.string(),
  /**
   * The requesting user. Recovery needs it to re-load the personality
   * access-scoped, exactly as `MultiTagRecovery` does. The message variant
   * could derive it from the re-fetched Message, but the slash variant has no
   * Message anchor — carrying it on both keeps one code path.
   */
  userId: z.string().min(1),
  /** Epoch ms at which the job was first tracked; preserves the original budget. */
  startTime: z.number(),
});

const PersistedMessageContextSchema = BasePersistedContextSchema.extend({
  kind: z.literal('message'),
  sourceMessageId: z.string().min(1),
  userMessageContent: z.string(),
  isAutoResponse: z.boolean(),
});

const PersistedSlashContextSchema = BasePersistedContextSchema.extend({
  kind: z.literal('slash'),
  characterSlug: z.string().min(1),
  isWeighInMode: z.boolean(),
});

/**
 * Discriminated on `kind`, mirroring `PendingJobContext`. Parsing (rather than
 * casting) means a snapshot written by an older deploy that lacks a
 * now-required field is skipped cleanly instead of handing recovery an
 * `undefined` it never guards against.
 */
export const PersistedJobContextSchema = z.discriminatedUnion('kind', [
  PersistedMessageContextSchema,
  PersistedSlashContextSchema,
]);

export type PersistedJobContext = z.infer<typeof PersistedJobContextSchema>;

export class SingleJobPersistence {
  constructor(private readonly redis: Redis) {}

  /**
   * Write one job's delivery context.
   *
   * Callers treat this as best-effort (`JobTracker` fires it without
   * awaiting): the write sits on the per-request hot path, and a lost write
   * leaves us exactly where we were before this module existed — the result
   * drops on restart. Never throws into the submission path.
   */
  async put(context: PersistedJobContext): Promise<void> {
    const key = `${REDIS_KEY_PREFIXES.SINGLE_JOB_CONTEXT}${context.jobId}`;
    try {
      await this.redis.set(key, JSON.stringify(context), 'EX', SINGLE_JOB_CONTEXT_TTL_SEC);
    } catch (err) {
      logger.warn(
        { err, jobId: context.jobId },
        'Failed to persist single-job context — a restart before delivery will drop this result'
      );
    }
  }

  /**
   * Delete a job's context once it completes. Fails soft: an undeleted entry
   * self-expires via its TTL, and recovery re-adopting an already-completed
   * job is harmless (no result will arrive for it, so the tracker slot is
   * released by the orphan sweep).
   */
  async delete(jobId: string): Promise<void> {
    const key = `${REDIS_KEY_PREFIXES.SINGLE_JOB_CONTEXT}${jobId}`;
    try {
      await this.redis.del(key);
    } catch (err) {
      logger.warn(
        { err, jobId },
        'Failed to delete single-job context — entry will expire via TTL'
      );
    }
  }

  /**
   * Scan every persisted context (used by `SingleJobRecovery` at startup).
   * SCAN rather than KEYS so a large keyspace never blocks Redis.
   */
  async scanAll(): Promise<PersistedJobContext[]> {
    return scanJsonEntries(
      this.redis,
      REDIS_KEY_PREFIXES.SINGLE_JOB_CONTEXT,
      parseContextOrLog,
      SCAN_COUNT
    );
  }
}

/**
 * Project a live `PendingJobContext` onto its serializable identifiers.
 *
 * The live `channel`, `message` and `personality` objects are replaced by the
 * ids recovery re-fetches them with; everything else is carried verbatim.
 * `userId` comes from the Message author on the message variant and from the
 * explicit field on the slash variant — the two shapes' only divergence in
 * how the same value is reached.
 */
export function toPersistedContext(
  jobId: string,
  context: PendingJobContext,
  startTime: number
): PersistedJobContext {
  const base = {
    jobId,
    channelId: context.channel.id,
    guildId: context.guildId,
    clientId: context.clientId,
    userMessageTime: context.userMessageTime.toISOString(),
    personalityId: context.personality.id,
    personalitySlug: context.personality.slug,
    personaId: context.personaId,
    startTime,
  };

  if (context.kind === 'slash') {
    return {
      ...base,
      kind: 'slash',
      userId: context.userId,
      characterSlug: context.characterSlug,
      isWeighInMode: context.isWeighInMode,
    };
  }

  return {
    ...base,
    kind: 'message',
    userId: context.message.author.id,
    sourceMessageId: context.message.id,
    userMessageContent: context.userMessageContent,
    isAutoResponse: context.isAutoResponse ?? false,
  };
}

/**
 * Adapts `SingleJobPersistence` to the synchronous `TrackedJobRecorder` port
 * `JobTracker` calls.
 *
 * Both methods are deliberately fire-and-forget: `trackJob` sits on the
 * per-request hot path (a Redis round-trip there would delay job submission)
 * and `completeJob` runs immediately before a Discord send. Losing either
 * write degrades to today's behaviour — a dropped result on restart, or an
 * entry that expires via TTL — never to a failed request.
 */
export class SingleJobContextRecorder implements TrackedJobRecorder {
  constructor(private readonly persistence: SingleJobPersistence) {}

  record(jobId: string, context: PendingJobContext, startTime: number): void {
    // The try/catch and the `.catch` cover DIFFERENT failure modes, and the
    // port contract needs both. `toPersistedContext` runs synchronously as an
    // argument expression — before `put` is ever called — and dereferences
    // `context.channel`, `context.userMessageTime`, `context.personality` and
    // (message kind) `context.message.author`, so a malformed context throws
    // past a promise handler entirely and into the live submission path.
    // `put` swallows its own Redis errors, leaving the `.catch` for a
    // rejection `put` itself failed to contain. Pinned by the two
    // 'never throws' cases in `SingleJobPersistence.test.ts`.
    try {
      void this.persistence
        .put(toPersistedContext(jobId, context, startTime))
        .catch(err => logger.warn({ err, jobId }, 'Single-job context record failed'));
    } catch (err) {
      logger.warn({ err, jobId }, 'Single-job context record failed');
    }
  }

  // No try/catch counterpart here: `forget` takes only a `jobId` string and
  // `delete`'s sole synchronous step is a template concat over it, which has
  // no throwing dereference for one to catch.
  forget(jobId: string): void {
    void this.persistence
      .delete(jobId)
      .catch(err => logger.warn({ err, jobId }, 'Single-job context forget failed'));
  }
}

/**
 * Parse one Redis value into a context, logging and skipping anything
 * unusable (oversized, corrupt JSON, wrong shape). Extracted from `scanAll`
 * so the scan loop stays flat.
 */
function parseContextOrLog(key: string, raw: string | null): PersistedJobContext | null {
  if (raw === null) {
    return null;
  }
  if (raw.length > MAX_ENTRY_BYTES) {
    logger.error(
      { key, size: raw.length, max: MAX_ENTRY_BYTES },
      'Skipping single-job context: serialized size exceeds defensive cap'
    );
    return null;
  }
  try {
    const parsed = PersistedJobContextSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      logger.warn({ key }, 'Skipping malformed single-job context (failed shape validation)');
      return null;
    }
    return parsed.data;
  } catch (err) {
    logger.warn({ err, key }, 'Skipping single-job context: JSON parse failed');
    return null;
  }
}
