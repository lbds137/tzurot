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
import { EmbedBuilder, escapeMarkdown, type Client } from 'discord.js';
import { DISCORD_COLORS, stripMarkdownDelimiters } from '@tzurot/common-types/constants/discord';
import { ApiErrorCategory, GUEST_MODE_CATEGORY } from '@tzurot/common-types/constants/error';
import { TTLCache } from '@tzurot/common-types/utils/TTLCache';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { postOwnerChannelEmbed } from '../utils/ownerChannel.js';
import { cappedInlineField } from '../utils/embedLimits.js';

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
  /** Persona in play for this turn, from the call site's own scope — this is
   *  never present on `metadata`, so it can't be derived from a result alone. */
  personalityName?: string;
  /** The model that actually served the turn. On a rescue report this is
   *  rendered as `fromModel → toModel` (see {@link deriveDiagnosticFields}). */
  model?: string;
  /** AI provider that served the turn (`metadata.providerUsed`). */
  provider?: string;
  /** Generation duration in ms (`metadata.processingTimeMs`). */
  durationMs?: number;
}

/**
 * Narrow structural subset of `LLMGenerationResult` (common-types) that this
 * module reads diagnostic fields from. Kept local — rather than importing the
 * full generated type — so call sites can pass partial/synthetic results
 * (several already do) without a hard schema dependency on every field.
 */
export interface ReportableJobResult {
  requestId?: string;
  errorInfo?: { category?: string };
  metadata?: {
    modelUsed?: string;
    providerUsed?: string;
    processingTimeMs?: number;
    quotaFallback?: {
      fromModel: string;
      toModel: string;
      category: string;
      mode: 'proactive' | 'reactive';
    };
  };
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
/** Long enough to survive the observed 7h gap between recurrences of the same
 *  bug — HISTORY_TTL_MS (2h) had already expired by then, which is why two
 *  cards sharing a stack hash showed no link between them.
 *
 *  BOUNDED BY PROCESS LIFETIME, not by this TTL. Like the two caches above it
 *  is in-memory, so a bot-client deploy between two recurrences resets the
 *  count to #1 and the second card again reads as new. Closing that would take
 *  a persistent store, which is more machinery than an alert channel warrants
 *  — but do not read "#1" as proof a failure is novel. */
const OCCURRENCE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
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

interface OccurrenceEntry {
  count: number;
  /** Wall-clock start of THIS 24h occurrence horizon. Compared against
   *  explicitly, never inferred from the cache entry's own TTL — same
   *  reasoning as `WindowEntry.windowStart`: `TTLCache.set` re-stamps the
   *  TTL on every write, so a hash recurring more often than once per 24h
   *  would otherwise keep the entry alive forever and `firstSeen` would
   *  drift arbitrarily far into the past. The cache TTL is garbage
   *  collection for quiet hashes, never the horizon. */
  firstSeen: number;
}

let client: Client | undefined;
let windowCache = new TTLCache<WindowEntry>({ ttl: WINDOW_TTL_MS, maxSize: CACHE_MAX_SIZE });
let historyCache = new TTLCache<number>({ ttl: HISTORY_TTL_MS, maxSize: CACHE_MAX_SIZE });
let occurrenceCache = new TTLCache<OccurrenceEntry>({
  ttl: OCCURRENCE_TTL_MS,
  maxSize: CACHE_MAX_SIZE,
});

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
  occurrenceCache = new TTLCache<OccurrenceEntry>({
    ttl: OCCURRENCE_TTL_MS,
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

/**
 * Bump (or start) the 24h occurrence tally for a stack hash. Called on EVERY
 * `reportError` invocation — including the deduped-repeat early-return path
 * (a suppressed repeat is still an occurrence) — so the counter survives past
 * `HISTORY_TTL_MS` (2h), which is what let the owner's two 7h-apart cards read
 * as unrelated blips instead of the same recurring bug.
 *
 * Deliberately hung off the shared `reportError` path rather than the job
 * one, so `command` and `unhandled-rejection` reports get the counter too.
 * "Is this new, or the same thing again?" is the question every alert in this
 * channel raises, and the answer is keyed on the stack hash, which every
 * source already has. Narrowing it to `source === 'job'` would be the odd
 * choice, not the generalization.
 */
function bumpOccurrence(hash: string, now: number): OccurrenceEntry {
  const existing = occurrenceCache.get(hash);
  const fresh =
    existing !== null && now - existing.firstSeen < OCCURRENCE_TTL_MS
      ? { count: existing.count + 1, firstSeen: existing.firstSeen }
      : { count: 1, firstSeen: now };
  occurrenceCache.set(hash, fresh);
  return fresh;
}

/** Formats an age in ms as `<N>m` under an hour, `<N>h` otherwise — no date
 *  dependency, just enough precision for a glance at the embed. */
function formatRelativeAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  return `${Math.floor(minutes / 60)}h`;
}

/**
 * Derives the Model/Provider/Duration embed fields from a result's metadata.
 * On a RESCUE report, the interesting model is the one that actually served —
 * `quotaFallback.toModel` — rendered as `fromModel → toModel` so the card
 * shows what was retargeted away from, instead of `metadata.modelUsed` alone
 * (which a rescue report may not even carry).
 */
function deriveDiagnosticFields(
  result: ReportableJobResult | undefined,
  rescued: boolean
): Pick<ErrorReport, 'model' | 'provider' | 'durationMs'> {
  const metadata = result?.metadata;
  const quotaFallback = metadata?.quotaFallback;
  const model =
    rescued && quotaFallback !== undefined
      ? `${quotaFallback.fromModel} → ${quotaFallback.toModel}`
      : metadata?.modelUsed;
  return {
    ...(model !== undefined ? { model } : {}),
    ...(metadata?.providerUsed !== undefined ? { provider: metadata.providerUsed } : {}),
    ...(metadata?.processingTimeMs !== undefined ? { durationMs: metadata.processingTimeMs } : {}),
  };
}

/**
 * Escape a persona name for an embed field.
 *
 * `escapeMarkdown`'s DEFAULTS DO NOT TOUCH MASKED-LINK SYNTAX — probed against
 * the installed discord.js, not assumed: bare `escapeMarkdown` returns
 * `[Free Nitro](http://evil.example)` unchanged, so a persona name renders as
 * a live clickable link in the owner's alert channel. `{ maskedLink: true }`
 * escapes the opening bracket, which renders the whole thing as literal text.
 *
 * Escaped rather than stripped (the treatment `model`/`provider` get) because
 * persona names legitimately contain parentheses — `Lilith (v2)` survives this
 * untouched, and stripping would mangle it.
 *
 * `Personality.name` is `VarChar(255)` with no character restriction and any
 * user can set one via `/character create`, so this is as reachable as the
 * `/preset` model field. The bare-`escapeMarkdown` pattern is used at many
 * other call sites across bot-client; that wider sweep is TASK-802.
 */
function escapePersonaName(value: string): string {
  return escapeMarkdown(value, { maskedLink: true });
}

/**
 * Add one inline field carrying a USER-AUTHORED value, sanitized and clamped —
 * or add nothing, when sanitizing leaves it empty.
 *
 * The empty case is why this exists as a helper rather than three inline `if`s.
 * Discord rejects an empty field VALUE at build time, discord.js throws, and
 * that throw lands in `reportError`'s own fail-open catch — so one unusable
 * value silently drops the WHOLE alert, which is the worst failure this module
 * has. Both an absent value and one that sanitizes away (a model id of `()`,
 * a persona name that is already empty) reach it, and the guard was originally
 * written for only one of the three fields. Routing every sanitized field
 * through one function is what stops the next field being added without it.
 *
 * Sanitize BEFORE clamping: the cap must apply to what is actually rendered,
 * and escaping afterwards could push an at-cap value back over the limit.
 */
function addSanitizedField(
  embed: EmbedBuilder,
  name: string,
  value: string | undefined,
  sanitize: (input: string) => string
): void {
  if (value === undefined) {
    return;
  }
  const sanitized = sanitize(value);
  if (sanitized === '') {
    return;
  }
  embed.addFields(cappedInlineField(name, sanitized));
}

interface BuildEmbedOptions {
  report: ErrorReport;
  frames: string[];
  hash: string;
  previousWindowCount: number | null;
  occurrence: OccurrenceEntry;
  now: number;
}

function buildEmbed({
  report,
  frames,
  hash,
  previousWindowCount,
  occurrence,
  now,
}: BuildEmbedOptions): EmbedBuilder {
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

  // Every dynamic value below goes through `cappedInlineField`. discord.js
  // validates embed parts at BUILD time, so one over-cap string throws rather
  // than truncating — here that throw lands in `reportError`'s own catch and
  // the report is silently dropped, which is the worst failure this module
  // has: it is how a failure becomes visible at all. Several of these arrive
  // off the wire with no length validation at this boundary. `command`,
  // `requestId` and `personalityName` are bounded upstream today (the last by
  // schema, VarChar(255)) and still go through the helper, so no future field
  // joins this block uncapped. This module is a member of TASK-704's class.
  if (report.command !== undefined) {
    embed.addFields(cappedInlineField('Command', report.command));
  }
  if (report.latencyMs !== undefined) {
    embed.addFields({ name: 'Latency', value: `${report.latencyMs}ms`, inline: true });
  }
  if (report.requestId !== undefined) {
    embed.addFields(cappedInlineField('Request ID', report.requestId));
  }
  // Sanitized values go through `addSanitizedField`, which drops the field when
  // sanitizing leaves it empty. Every one of these is user-authored, and both
  // sanitizers can return '' from a non-empty input — `escapeMarkdown` cannot,
  // but `stripMarkdownDelimiters('()')` does, and an empty field value throws.
  addSanitizedField(embed, 'Personality', report.personalityName, escapePersonaName);
  addSanitizedField(embed, 'Model', report.model, stripMarkdownDelimiters);
  addSanitizedField(embed, 'Provider', report.provider, stripMarkdownDelimiters);
  if (report.durationMs !== undefined) {
    embed.addFields({ name: 'Duration', value: `${report.durationMs}ms`, inline: true });
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
  embed.addFields({
    name: 'Occurrence',
    value: `#${occurrence.count}, first seen ${formatRelativeAge(now - occurrence.firstSeen)} ago`,
  });

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
    // Bumped unconditionally — a suppressed repeat is still an occurrence —
    // so the counter survives the dedup early-return below.
    const occurrence = bumpOccurrence(hash, now);
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

    const embed = buildEmbed({ report, frames, hash, previousWindowCount, occurrence, now });
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
export function reportDeliveryFailure(
  error: unknown,
  result: ReportableJobResult | undefined,
  personalityName: string | undefined
): void {
  const name = error instanceof Error ? error.constructor.name : 'UnknownError';
  reportError({
    source: 'job',
    errorCode: name,
    ...(result?.requestId !== undefined ? { requestId: result.requestId } : {}),
    ...(personalityName !== undefined ? { personalityName } : {}),
    // `rescued: false` — a delivery failure is a genuine failure, never a
    // fallback-rescued success, so the Model field is `metadata.modelUsed`
    // rather than a swap chain.
    ...deriveDiagnosticFields(result, false),
    error,
  });
}

/**
 * Shared implementation behind {@link reportJobError} and
 * {@link reportQuotaFallbackRescue} — both need the deny-list check and the
 * same diagnostic-field derivation, but resolve `category` from a different
 * place on the result (errorInfo.category vs. quotaFallback.category), so the
 * category is resolved by the caller and passed in explicitly here.
 */
function reportJobErrorInternal(
  category: string,
  result: ReportableJobResult | undefined,
  personalityName: string | undefined,
  rescued: boolean
): void {
  if (JOB_ERROR_SKIP_CATEGORIES.includes(category)) {
    return;
  }
  reportError({
    source: 'job',
    errorCode: category,
    jobErrorCategory: category,
    ...(result?.requestId !== undefined ? { requestId: result.requestId } : {}),
    ...(personalityName !== undefined ? { personalityName } : {}),
    ...deriveDiagnosticFields(result, rescued),
    ...(rescued ? { rescued: true } : {}),
  });
}

/**
 * Report a job-failure category to the owner channel, skipping the deny-
 * listed expected-outcome categories (see {@link JOB_ERROR_SKIP_CATEGORIES}).
 * Centralizes the skip check so every call site stays one line — four in
 * `MessageHandler`, two in `multiTagDeliveryFlow`, which calls this
 * directly rather than through the handler.
 */
export function reportJobError(
  result: ReportableJobResult | undefined,
  personalityName: string | undefined
): void {
  const category = result?.errorInfo?.category ?? 'unknown';
  reportJobErrorInternal(category, result, personalityName, false);
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
  result: ReportableJobResult | undefined,
  personalityName: string | undefined
): void {
  const quotaFallback = result?.metadata?.quotaFallback;
  if (quotaFallback !== undefined) {
    reportJobErrorInternal(quotaFallback.category, result, personalityName, true);
  }
}
