/**
 * Fire-and-forget owner-channel reporting for bot-client-observable SYSTEM
 * errors (P0.2 of the telemetry seam) — distinct from the P0.1 command-
 * telemetry emission in `emitCommandEvent.ts`, which this module sits beside
 * rather than modifies.
 *
 * A SYSTEM error is one that reached a top-level catch or the process-level
 * unhandledRejection handler: a bug, not an expected user- or provider-side
 * outcome. Reporting is deduped per stack-frame hash so a tight error loop
 * posts once per window instead of flooding the channel, and every call site
 * stays a single line via the module-level client + fail-open guard.
 *
 * Fail-open, mirroring `emitCommandEvent.ts`'s double guard: a synchronous
 * throw is caught by the outer try/catch, and the returned promise carries a
 * `.catch()` so nothing here can become an unhandled rejection — the reporter
 * itself must never be the thing that breaks a caller.
 */

import { createHash } from 'node:crypto';
import { EmbedBuilder, type Client } from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { ApiErrorCategory, GUEST_MODE_CATEGORY } from '@tzurot/common-types/constants/error';
import { TTLCache } from '@tzurot/common-types/utils/TTLCache';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { postOwnerChannelEmbed } from '../utils/ownerChannel.js';

const logger = createLogger('ErrorChannelReporter');

/** One report handed to {@link reportError}. */
export interface ErrorReport {
  source: 'command' | 'job' | 'unhandled-rejection';
  errorCode: string;
  command?: string;
  jobErrorCategory?: string;
  latencyMs?: number;
  requestId?: string;
  error?: unknown;
  /**
   * True when this report describes a SUCCESSFUL turn that only succeeded
   * because a fallback retargeted away from the configured model (see
   * {@link reportQuotaFallbackRescue}) — as opposed to a genuine failure of
   * the same category. Rendered distinctly by {@link buildEmbed} and folded
   * into the dedup hash so a rescue and a failure never share a bucket.
   */
  rescued?: boolean;
}

/**
 * Job-error categories that are expected user/provider outcomes rather than
 * bot-client bugs — a deny-list, so anything NOT listed here reports by
 * default. Three classes:
 *   - the user (or the shared free pool) hit a limit they can act on
 *     (rate_limit, quota_exceeded, free_tier_quota, credit_exhaustion);
 *   - the user's own content was refused by a provider or the model
 *     (content_policy, censored, provider_content_refused);
 *   - the guest/free ladder proactively substituted a free model at
 *     admission time (guest_mode) — not a failure at all, so it must never
 *     reach the owner channel on the quota-fallback success-path report.
 * Everything else — auth failures, bad requests, model/media lookups,
 * server errors, timeouts, network errors, empty responses, TTS voice
 * errors, and any unrecognized category — reports.
 */
export const JOB_ERROR_SKIP_CATEGORIES: readonly string[] = [
  ApiErrorCategory.RATE_LIMIT,
  ApiErrorCategory.QUOTA_EXCEEDED,
  ApiErrorCategory.FREE_TIER_QUOTA,
  ApiErrorCategory.CREDIT_EXHAUSTION,
  ApiErrorCategory.CONTENT_POLICY,
  ApiErrorCategory.CENSORED,
  ApiErrorCategory.PROVIDER_CONTENT_REFUSED,
  // The guest/free ladder's admission-time substitution — not a retargetable
  // failure (see the `guest_mode` member of QUOTA_FALLBACK_CATEGORIES in
  // common-types' error.ts). `GUEST_MODE_CATEGORY` is single-sourced in
  // common-types, importable from both ai-worker (the producer) and
  // bot-client (this consumer) alike.
  GUEST_MODE_CATEGORY,
];

const WINDOW_TTL_MS = 60 * 60 * 1000; // 1h
const HISTORY_TTL_MS = 2 * WINDOW_TTL_MS; // 2x the window, per decision B
const CACHE_MAX_SIZE = 200;
const MAX_STACK_FRAMES = 5;
/** Leaves room for the emoji prefix under Discord's 256-char embed title cap. */
const MAX_TITLE_LENGTH = 200;

interface WindowEntry {
  count: number;
  /** Wall-clock start of THIS dedup window. The window boundary is decided
   *  by comparing against this, never by the cache entry's own TTL:
   *  `TTLCache.set` re-stamps the TTL on every write, so a sustained loop
   *  (repeats more often than once an hour) would otherwise keep the entry
   *  alive forever and the owner would get exactly one alert per incident.
   *  The cache TTL is garbage collection for quiet hashes, not the window. */
  windowStart: number;
}

let client: Client | undefined;
let windowCache = new TTLCache<WindowEntry>({ ttl: WINDOW_TTL_MS, maxSize: CACHE_MAX_SIZE });
let historyCache = new TTLCache<number>({ ttl: HISTORY_TTL_MS, maxSize: CACHE_MAX_SIZE });

/** Wires the Discord client the reporter posts through. Call once at startup. */
export function initErrorChannelReporter(discordClient: Client): void {
  client = discordClient;
}

/**
 * Test-only reset. `lru-cache` snapshots `performance.now` at module load
 * (see `TTLCache.ts`), so fake timers alone cannot advance its TTLs unless a
 * `now` callback is supplied that itself resolves to `Date.now()` — the same
 * pattern `HttpPersonalityLoader` uses for its own TTLCache instances,
 * paired with `vi.useFakeTimers()`/`vi.advanceTimersByTime()` in the test.
 * @internal test-only
 */
export function __resetErrorChannelReporterForTests(now?: () => number): void {
  client = undefined;
  windowCache = new TTLCache<WindowEntry>({
    ttl: WINDOW_TTL_MS,
    maxSize: CACHE_MAX_SIZE,
    ...(now !== undefined ? { now } : {}),
  });
  historyCache = new TTLCache<number>({
    ttl: HISTORY_TTL_MS,
    maxSize: CACHE_MAX_SIZE,
    ...(now !== undefined ? { now } : {}),
  });
}

/**
 * Matches a V8 stack FRAME line: `at fn (/path/file.ts:12:5)` or the bare
 * `at /path/file.ts:12:5` form. Both the `at ` prefix and the trailing
 * `:line:column` are required, which is what excludes message text.
 */
const STACK_FRAME_PATTERN = /^at\s.*:\d+:\d+\)?$/;

/**
 * Extract up to the top `MAX_STACK_FRAMES` stack frame lines from an error,
 * keeping ONLY lines that match {@link STACK_FRAME_PATTERN} and never
 * touching `error.message` directly.
 *
 * Dropping `stack[0]` is NOT sufficient on its own: an Error whose message
 * contains newlines spreads that message across several leading lines, so a
 * positional slice alone leaks user text into the embed. Matching the frame
 * shape is what makes the exclusion structural. Pinned by the multi-line
 * message case in the no-PII test.
 */
export function extractStackFrames(error: unknown): string[] {
  if (!(error instanceof Error) || typeof error.stack !== 'string') {
    return [];
  }
  return error.stack
    .split('\n')
    .map(line => line.trim())
    .filter(line => STACK_FRAME_PATTERN.test(line))
    .slice(0, MAX_STACK_FRAMES);
}

function hashFrames(frames: string[], errorCode: string, rescued: boolean): string {
  // The rescued flag is folded into the hash material (not just the
  // errorCode/category) so a rescue report and a genuine failure report of
  // the SAME category land in separate dedup buckets — see the invariant
  // paragraph on `reportQuotaFallbackRescue`.
  const material = `${frames.length > 0 ? frames.join('\n') : errorCode}::rescued=${String(rescued)}`;
  return createHash('sha256').update(material).digest('hex');
}

function buildEmbed(
  report: ErrorReport,
  frames: string[],
  hash: string,
  previousWindowCount: number | null
): EmbedBuilder {
  // Capped because the job path's category arrives off the wire with no
  // length validation at this boundary, and Discord rejects the whole embed
  // over its 256-char title limit — which would silently drop the report.
  const rawTitle =
    report.source === 'job' ? (report.jobErrorCategory ?? report.errorCode) : report.errorCode;
  const rescued = report.rescued === true;
  const embed = new EmbedBuilder()
    .setTitle(
      rescued
        ? `⚠️ ${rawTitle.slice(0, MAX_TITLE_LENGTH)} (rescued)`
        : `🚨 ${rawTitle.slice(0, MAX_TITLE_LENGTH)}`
    )
    .setColor(rescued ? DISCORD_COLORS.WARNING : DISCORD_COLORS.ERROR)
    .addFields(
      { name: 'Source', value: report.source, inline: true },
      { name: 'Stack Hash', value: hash.slice(0, 8), inline: true }
    );

  if (rescued) {
    embed.addFields({
      name: 'Outcome',
      value: 'rescued — turn succeeded via fallback',
    });
  }

  if (report.command !== undefined) {
    embed.addFields({ name: 'Command', value: report.command, inline: true });
  }
  if (report.latencyMs !== undefined) {
    embed.addFields({ name: 'Latency', value: `${report.latencyMs}ms`, inline: true });
  }
  if (report.requestId !== undefined) {
    embed.addFields({ name: 'Request ID', value: report.requestId, inline: true });
  }
  if (frames.length > 0) {
    embed.addFields({ name: 'Frames', value: frames.join('\n').slice(0, 1024) });
  }
  if (previousWindowCount !== null && previousWindowCount > 1) {
    embed.addFields({
      name: 'Suppressed since last report',
      value: String(previousWindowCount - 1),
    });
  }

  return embed;
}

/**
 * Report a bot-client-observable SYSTEM error to the private owner channel,
 * deduped per stack hash within a rolling window. Never throws, and no-ops
 * (after a debug log) before {@link initErrorChannelReporter} has run.
 *
 * Fail-open double guard, mirroring `emitCommandEvent.ts`: the outer
 * try/catch below catches a SYNCHRONOUS throw building or posting the embed,
 * and the `.catch()` on the returned promise catches an ASYNC rejection —
 * together nothing this function does can escape into the caller.
 */
export function reportError(report: ErrorReport): void {
  if (client === undefined) {
    logger.debug({ source: report.source }, 'Error-channel reporter not initialized; skipping');
    return;
  }

  const activeClient = client;

  // The ENTIRE body sits inside the guard — hashing and the cache reads
  // included — so the "nothing escapes into the caller" claim above holds for
  // every statement, not just the post. `hash` is therefore not in scope for
  // the catch's log fields.
  try {
    const frames = extractStackFrames(report.error);
    const hash = hashFrames(frames, report.errorCode, report.rescued === true);

    // Dedup: a repeat within the window bumps the running tally and returns
    // WITHOUT posting (decision B) — this early return is the dedup canary's
    // target, so removing it must turn the "repeat does not post" test red.
    const now = Date.now();
    const existing = windowCache.get(hash);
    if (existing !== null && now - existing.windowStart < WINDOW_TTL_MS) {
      // Repeat inside the live window: count it, post nothing. Re-setting the
      // cache entry re-stamps its TTL, which is fine — the rollover below
      // reads windowStart, not the TTL.
      existing.count += 1;
      windowCache.set(hash, existing);
      historyCache.set(hash, existing.count);
      return;
    }

    // New window: either a fresh hash, an expired entry, or a LIVE entry
    // whose windowStart has aged past the window (the sustained-loop case).
    // The live entry is the authoritative previous-window tally; the history
    // cache covers the expired-entry gap (quiet for >1h but <2h).
    const previousWindowCount = existing !== null ? existing.count : historyCache.get(hash);
    windowCache.set(hash, { count: 1, windowStart: now });
    historyCache.set(hash, 1);

    const embed = buildEmbed(report, frames, hash, previousWindowCount);
    void postOwnerChannelEmbed(activeClient, embed).catch((err: unknown) => {
      logger.warn({ err, hash }, 'Error-channel post rejected');
    });
  } catch (err) {
    logger.warn({ err, source: report.source }, 'Error-channel report threw synchronously');
  }
}

/**
 * Report a bot-client-side failure with the original error in hand. Always
 * pageable (never deny-listed) — both caller classes are OUR failures, not
 * model/provider outcomes: a delivery failure on an already-successful result
 * (Discord API failure or formatter bug while sending a good response —
 * MessageHandler's async/slash/late-recovery catches), and a submit-time
 * throw where the job never reached the queue (PersonalityMessageHandler's
 * DM-session catch). Passing the real error lets the reporter hash its stack
 * frames for dedup, unlike the category-keyed reportJobError below.
 */
export function reportDeliveryFailure(error: unknown, requestId?: string): void {
  const name = error instanceof Error ? error.constructor.name : 'UnknownError';
  reportError({
    source: 'job',
    errorCode: name,
    ...(requestId !== undefined ? { requestId } : {}),
    error,
  });
}

/**
 * Report a job-failure category to the owner channel, skipping the deny-
 * listed expected-outcome categories (see {@link JOB_ERROR_SKIP_CATEGORIES}).
 * Centralizes the skip check so both MessageHandler call sites stay one line.
 */
export function reportJobError(
  category: string | undefined,
  requestId?: string,
  opts?: { rescued?: boolean }
): void {
  const resolvedCategory = category ?? 'unknown';
  if (JOB_ERROR_SKIP_CATEGORIES.includes(resolvedCategory)) {
    return;
  }
  reportError({
    source: 'job',
    errorCode: resolvedCategory,
    jobErrorCategory: resolvedCategory,
    ...(requestId !== undefined ? { requestId } : {}),
    ...(opts?.rescued !== undefined ? { rescued: opts.rescued } : {}),
  });
}

/**
 * Report a SUCCESSFUL turn's quota-fallback rescue to the owner channel —
 * a job can arrive `success: true` only because the tier-aware fallback (or
 * the guest/free ladder) retargeted away from the configured model, and that
 * rescue can itself be owner-visible (e.g. a delisted-model persona silently
 * self-healing every turn instead of surfacing the misconfiguration).
 * Shares {@link reportJobError}'s deny-list, so routine rescues (rate
 * limits, quota, guest-mode admission) stay silent — only unusual categories
 * like `model_not_found` report. No-ops when the result carries no
 * quotaFallback metadata. Centralizes the check so every success-path call
 * site (MessageHandler's message + slash paths, multiTagDeliveryFlow's
 * per-slot delivery) stays one line.
 *
 * Invariant: a rescue report is rendered distinctly from a genuine failure
 * report of the same category (⚠️ warning-colored title + an Outcome field
 * vs. the plain 🚨 failure embed — see {@link buildEmbed}) and occupies a
 * SEPARATE dedup bucket, because the rescued flag is folded into the dedup
 * hash. A rescue and a failure of the same category can therefore both post
 * within one window; two rescues of the same category still dedup as usual.
 */
export function reportQuotaFallbackRescue(
  quotaFallback: { category: string } | undefined,
  requestId: string | undefined
): void {
  if (quotaFallback !== undefined) {
    reportJobError(quotaFallback.category, requestId, { rescued: true });
  }
}
