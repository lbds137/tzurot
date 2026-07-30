/**
 * DescriptionPromptService — the system prompt used when DESCRIBING an image.
 *
 * Why this exists at all: a vision description is a SHARED artifact. It is
 * cached model-agnostically (`VisionDescriptionCache`, keyed by attachment id
 * or URL hash) and served to every personality that later encounters the same
 * image, so it must not be framed by whichever personality happened to see it
 * first.
 *
 * Scope of the reuse, stated precisely: the cache is Redis with a 1h TTL
 * (`INTERVALS.VISION_DESCRIPTION_TTL`), so a mis-framed entry today self-heals
 * within the hour. What makes this worth fixing rather than waiting is the
 * sticker case — its key is an immutable snowflake, so the SAME entry is
 * rewritten and reused indefinitely, and doc-55's planned durable table turns
 * that into a genuinely permanent record. Getting the framing right before that
 * table exists is cheaper than migrating rows written under the wrong one.
 *
 * It was. `describeImage` passed `personality.systemPrompt`, and even though
 * system prompts are a SHARED admin-managed table (`system_prompts`) rather
 * than per-character text, `PersonalityDefaults.applyPlaceholders` substitutes
 * `{{char}}` / `{assistant}` / `{shape}` / `{personality}` with the
 * personality's NAME before the loader hands it over. One shared row therefore
 * still resolves to a different string per character — "You are Lila…" gets
 * cached and then read by Saturn.
 *
 * The fix is to describe under the INSTANCE's prompt: the `isDefault` row of
 * `system_prompts`, un-substituted, identical for every describe.
 *
 * Deliberately mirrors `SystemSettingsService`'s ambient-registration shape
 * (register once at boot where Prisma exists; deep call sites read
 * synchronously with no injection) because `describeImage` sits several layers
 * below anything holding a Prisma client, and threading one down to it would
 * touch every caller for a single string.
 *
 * Hot-path contract, same as SystemSettingsService: `get()` is a synchronous
 * in-memory read — never a per-call DB hit, never throws. Refresh is
 * stale-while-revalidate behind a single-flight guard; on DB failure the last
 * known value keeps serving, and before the first successful load the value is
 * `undefined`, which the caller treats as "send no system message" (the
 * description instruction in the user message stands on its own).
 */

import { INTERVALS } from '@tzurot/common-types/constants/timing';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('DescriptionPromptService');

export class DescriptionPromptService {
  private content: string | undefined = undefined;
  private fetchedAt = 0;
  private refreshInFlight: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly ttlMs: number = INTERVALS.API_KEY_CACHE_TTL
  ) {}

  /**
   * The instance description prompt, or `undefined` when none is configured or
   * nothing has loaded yet. Synchronous by contract; triggers a background
   * refresh when the cached value is stale.
   */
  get(nowMs: number = Date.now()): string | undefined {
    if (nowMs - this.fetchedAt > this.ttlMs) {
      void this.refresh();
    }
    return this.content;
  }

  /**
   * Reload from the `isDefault` system-prompt row. Single-flight: a second
   * caller during an in-flight refresh joins it rather than issuing a second
   * query. Never rejects — a failure leaves the previous value in place.
   */
  async refresh(): Promise<void> {
    if (this.refreshInFlight !== null) {
      return this.refreshInFlight;
    }
    this.refreshInFlight = this.load().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async load(): Promise<void> {
    try {
      const row = await this.prisma.systemPrompt.findFirst({
        where: { isDefault: true },
        // Nothing constrains `system_prompts` to a single default row — unlike
        // llm_configs/tts_configs, which carry partial unique indexes for
        // exactly this (TASK-362). Without an order, Postgres is free to return
        // either row and to change its mind between queries, which would make
        // the framing of every description non-deterministic. Oldest-first is
        // arbitrary but stable, which is the property that matters.
        orderBy: { createdAt: 'asc' },
        select: { content: true },
      });
      // A configured-but-empty prompt is the same as none: an empty system
      // message adds nothing and would still cost a message slot.
      const next = row?.content;
      this.content = next !== undefined && next.length > 0 ? next : undefined;
    } catch (error) {
      logger.warn(
        { err: error },
        'Failed to load the instance description prompt — serving the previous value'
      );
    } finally {
      // Stamped on BOTH paths, so retries after a failure are TTL-paced rather
      // than firing on every read — a `finally` for the same reason
      // SystemSettingsService uses one.
      //
      // An earlier version deliberately skipped the failure stamp to recover
      // faster, reasoning that a failure here means Prisma is unreachable and
      // the describe path is therefore already dead upstream. That reasoning
      // was wrong: `LoadedPersonality` arrives as resolved job-payload data,
      // not a per-call fetch, so this one query can fail while describes keep
      // flowing — exactly the shape that would turn every describe into a
      // retry for the duration of an outage.
      //
      // Pacing is cheap precisely because boot priming exists: after a
      // successful prime there is always a previous value, so a failed refresh
      // degrades to a slightly stale prompt rather than to no prompt at all.
      // Recovering within one TTL is plenty for a string that changes about
      // never.
      this.fetchedAt = Date.now();
    }
  }
}

let ambientInstance: DescriptionPromptService | null = null;

/** Register the wired instance (once at boot, per process). */
export function registerDescriptionPrompt(instance: DescriptionPromptService): void {
  ambientInstance = instance;
}

/**
 * The system prompt for a description call. `undefined` when no instance is
 * registered (boot order, tests) or none is configured — callers then send no
 * system message at all, which is correct rather than degraded: the
 * "objective description for archival purposes" instruction lives in the user
 * message and does not depend on this.
 */
export function getDescriptionPrompt(): string | undefined {
  return ambientInstance?.get();
}

/** Test-only: clear the ambient registration between suites. */
export function resetDescriptionPromptRegistration(): void {
  ambientInstance = null;
}
