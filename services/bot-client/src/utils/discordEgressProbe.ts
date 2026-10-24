/**
 * Boot-time Discord egress probe.
 *
 * A Railway container whose shared egress IP is Cloudflare-banned by Discord
 * gets HTTP 429 with a multi-hour `retry-after` from the UNAUTHENTICATED
 * `GET /api/v10/gateway` endpoint, and discord.js waits the ban out silently —
 * while the boot watchdog can only restart the process into the same banned
 * container. This probe fires once per boot, before login, and classifies
 * that shape so the caller can log the verdict and alert the owner while
 * still proceeding: alerting, not exiting, is the lever, because an exit
 * restarts into the same container.
 *
 * Owner-surface honesty: the ERROR log line for a banned verdict is the
 * guaranteed owner-visible surface — it goes to the platform's stdout log
 * capture, which does not traverse discord.com — pinned by the
 * outcome-logger's banned-branch test. The webhook alert is BEST-EFFORT
 * only: the ban blocks this container's egress IP at Discord's edge, and
 * the alert POST leaves from that same IP toward discord.com, so delivery
 * during a ban is unproven until a webhook POST from a banned container
 * has been probed at the next occurrence and recorded on the tracking
 * task. Until then, treat the log line as the surface that always arrives
 * and the webhook as a convenience that the very ban it reports may block.
 *
 * Design property: the request is deliberately UNAUTHENTICATED — no
 * Authorization header. The probe must work before any token is validated,
 * and must never put the bot token on the wire. Pinned by the
 * no-authorization-header test in discordEgressProbe.test.ts.
 *
 * Fail-open property: every failure shape (network error, abort/timeout,
 * unexpected status) resolves to `verdict: 'unavailable'` — the probe never
 * rejects, so no probe outcome can block a boot. Pinned by the
 * rejecting-fetch and classifies-undefined-status tests.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWebhookAlertSender } from './webhookAlertSender.js';
import type { createLogger } from '@tzurot/common-types/utils/logger';

type Logger = ReturnType<typeof createLogger>;

/** The unauthenticated endpoint Discord serves for pre-login gateway discovery. */
export const EGRESS_PROBE_URL = 'https://discord.com/api/v10/gateway';

/**
 * A retry-after at or above this threshold classifies the egress as banned.
 * 5 minutes — exact parity with bootWatchdog's exported BOOT_DEADLINE_MS,
 * pinned by the threshold-parity test importing that constant instead of a
 * literal. The probe runs after some boot time has already passed, so the
 * guarantee holds only at or above the full deadline: a wait that long
 * cannot fit in what remains of the boot budget. Waits below it classify as
 * transient even though an unusually long boot may already have consumed
 * part of the budget — a deliberate conservative under-alert, never an
 * over-alert.
 */
export const EGRESS_BAN_THRESHOLD_MS = 5 * 60 * 1000;

/** Ceiling on the probe's own request so a black-holed egress cannot stall boot. */
const EGRESS_PROBE_TIMEOUT_MS = 5000;

export type EgressVerdict = 'ok' | 'banned' | 'unavailable';

export interface EgressProbeResult {
  verdict: EgressVerdict;
  /** HTTP status when a response arrived; absent on fetch rejection or timeout. */
  status?: number;
  /** Retry-After parsed to milliseconds when the header was present and parseable. */
  retryAfterMs?: number;
  elapsedMs: number;
}

/**
 * Pure classification so tests need no network. A 429 whose retry-after
 * clears `thresholdMs` is the ban shape; a 429 below it (or without a
 * parseable retry-after, which cannot prove the ban shape) is transient and
 * boot may proceed.
 */
export function classifyEgress(
  status: number | undefined,
  retryAfterMs: number | undefined,
  thresholdMs: number = EGRESS_BAN_THRESHOLD_MS
): EgressVerdict {
  if (status === 200) {
    return 'ok';
  }
  if (status === 429) {
    return retryAfterMs !== undefined && retryAfterMs >= thresholdMs ? 'banned' : 'ok';
  }
  return 'unavailable';
}

/**
 * Parse the Retry-After header into milliseconds. Discord sends SECONDS;
 * @discordjs/rest converts with `Number(header) * 1e3` (installed
 * @discordjs/rest@2.6.3, dist/index.mjs, runRequest) — this parser matches
 * that unit convention. Absent, empty, or non-numeric headers parse to
 * undefined rather than 0, so a missing header can never read as "no wait".
 */
export function retryAfterHeaderToMs(headerValue: string | null): number | undefined {
  if (headerValue === null || headerValue.trim() === '') {
    return undefined;
  }
  const seconds = Number(headerValue);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return undefined;
  }
  return seconds * 1000;
}

/** Humanize a retry-after for alert text: `9.0h`, `4.5m`, or `12s`. */
export function humanizeRetryAfterMs(retryAfterMs: number): string {
  if (retryAfterMs >= 3_600_000) {
    return `${(retryAfterMs / 3_600_000).toFixed(1)}h`;
  }
  if (retryAfterMs >= 60_000) {
    return `${(retryAfterMs / 60_000).toFixed(1)}m`;
  }
  return `${Math.round(retryAfterMs / 1000)}s`;
}

/**
 * One owner-alert line for the banned verdict. Identifiers and infra facts
 * only — no tokens, no message content.
 */
export function buildEgressBanAlertText(context: {
  environment: string | undefined;
  hostname: string;
  probe: EgressProbeResult;
}): string {
  const retryText =
    context.probe.retryAfterMs === undefined
      ? 'unknown-length'
      : humanizeRetryAfterMs(context.probe.retryAfterMs);
  return (
    `🚨 bot-client [${context.environment ?? 'unknown'}] boot egress probe: Discord has banned ` +
    `this container's egress IP (hostname: ${context.hostname}) — HTTP ${String(context.probe.status)} ` +
    `with a ${retryText} retry-after from ${EGRESS_PROBE_URL}. Login will hang until the ban lapses and ` +
    `the boot watchdog keeps restarting into the same container. \`railway redeploy\` gets a fresh ` +
    `container/IP.`
  );
}

/**
 * Fire the egress probe once. Never rejects: every failure shape resolves to
 * `verdict: 'unavailable'` (see the module doc's fail-open property).
 */
export async function probeDiscordEgress(options?: {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  thresholdMs?: number;
}): Promise<EgressProbeResult> {
  const fetchFn = options?.fetchFn ?? globalThis.fetch;
  const timeoutMs = options?.timeoutMs ?? EGRESS_PROBE_TIMEOUT_MS;
  const thresholdMs = options?.thresholdMs ?? EGRESS_BAN_THRESHOLD_MS;
  const startedAt = Date.now();
  try {
    // Deliberately no Authorization header (or any header) — the module doc's
    // unauthenticated design property.
    const response = await fetchFn(EGRESS_PROBE_URL, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const retryAfterMs = retryAfterHeaderToMs(response.headers.get('Retry-After'));
    const result: EgressProbeResult = {
      verdict: classifyEgress(response.status, retryAfterMs, thresholdMs),
      status: response.status,
      elapsedMs: Date.now() - startedAt,
    };
    if (retryAfterMs !== undefined) {
      result.retryAfterMs = retryAfterMs;
    }
    // The ban response is a Cloudflare HTML page, and an unread undici body
    // holds the socket until GC. The cancel failure is swallowed so it can
    // never escape the fail-open contract.
    await response.body?.cancel().catch(() => undefined);
    return result;
  } catch {
    return { verdict: 'unavailable', elapsedMs: Date.now() - startedAt };
  }
}

/**
 * Log a probe outcome per the boot-wiring contract: info for a clean 200 ok,
 * warn for an ok whose status is not 200 (a 429 classified ok — short or
 * missing retry-after — must not read as a clean 200 in the logs, pinned by
 * the 429-classified-ok test), error plus the caller's `onBanned` hook for a
 * ban, warn for unavailable. Returns the onBanned promise so the caller can
 * await the alert; never rejects unless the caller's own hook does.
 */
export function logEgressProbeOutcome(
  logger: Logger,
  probe: EgressProbeResult,
  onBanned?: (probe: EgressProbeResult) => Promise<void>
): Promise<void> {
  switch (probe.verdict) {
    case 'banned': {
      logger.error(
        {
          verdict: probe.verdict,
          status: probe.status,
          elapsedMs: probe.elapsedMs,
          retryAfterMs: probe.retryAfterMs,
          retryAfter:
            probe.retryAfterMs === undefined
              ? 'unknown-length'
              : humanizeRetryAfterMs(probe.retryAfterMs),
        },
        'Discord egress probe: egress IP banned by Discord — login will hang out the retry-after'
      );
      return onBanned?.(probe) ?? Promise.resolve();
    }
    case 'ok': {
      // Keyed on status, not retry-after presence: a 429 below the ban
      // threshold (short OR missing retry-after) is exactly the line a
      // diagnosis wants, and it must not read as a clean 200 — pinned by the
      // 429-classified-ok tests in discordEgressProbe.test.ts.
      if (probe.status !== undefined && probe.status !== 200) {
        logger.warn(
          {
            verdict: probe.verdict,
            status: probe.status,
            elapsedMs: probe.elapsedMs,
            retryAfterMs: probe.retryAfterMs,
          },
          'Discord egress probe: rate-limited below the ban threshold — boot may proceed'
        );
      } else {
        logger.info(
          { verdict: probe.verdict, status: probe.status, elapsedMs: probe.elapsedMs },
          'Discord egress probe: ok'
        );
      }
      return Promise.resolve();
    }
    default: {
      logger.warn(
        { verdict: probe.verdict, elapsedMs: probe.elapsedMs, status: probe.status },
        'Discord egress probe: gateway endpoint unavailable — continuing boot'
      );
      return Promise.resolve();
    }
  }
}

/** Marker file recording a fired ban alert's expiry, in epoch ms. */
export const BAN_ALERT_MARKER_PATH = join(tmpdir(), 'tzurot-egress-ban-alerted');

/** Shortest dedup window: an unknown or short ban still dedups briefly. */
export const BAN_ALERT_DEDUP_FLOOR_MS = 60_000;

/**
 * The dedup window for one fired ban alert: the ban's own retry-after when it
 * is the longer term, else the floor — an unknown or short ban still dedups
 * briefly. Pure so BOTH terms are pinned by direct unit tests; the
 * composition can only ever produce the retry-after-dominated shape, because
 * classifyEgress calls a verdict banned only at or above
 * EGRESS_BAN_THRESHOLD_MS, which always exceeds the floor.
 */
export function computeBanAlertMarkerExpiry(
  nowMs: number,
  retryAfterMs: number | undefined
): number {
  return Math.max(nowMs + (retryAfterMs ?? 0), nowMs + BAN_ALERT_DEDUP_FLOOR_MS);
}

/**
 * Read the dedup marker's expiry. Any read or parse failure (absent file,
 * unreadable path, garbage content) reads as "no marker" — fail-open, so a
 * marker problem can only ever cause an extra alert, never a suppressed one.
 */
function readAlertMarkerExpiry(markerPath: string): number | undefined {
  try {
    const expiry = Number(readFileSync(markerPath, 'utf8').trim());
    return Number.isFinite(expiry) ? expiry : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Write the dedup marker. Swallows every write failure — pinned by the
 * marker-path-is-a-directory test — so the marker can never block the alert
 * or the boot.
 */
function writeAlertMarkerExpiry(markerPath: string, expiryMs: number): void {
  try {
    writeFileSync(markerPath, String(expiryMs), 'utf8');
  } catch {
    // Fail-open by design — see the doc above.
  }
}

export interface RunBootEgressProbeOptions {
  /** Discord webhook-execute URL for the best-effort owner alert; unset = log-only. */
  alertWebhookUrl?: string;
  /** Environment label rendered into the alert text. */
  environment?: string;
  /** Dedup marker path override (tests point it at a per-case temp dir). */
  markerPath?: string;
  /** Injectable fetch for BOTH the probe and the alert webhook (the seam test's stub). */
  fetchFn?: typeof fetch;
}

/**
 * The boot wiring (moved here from index.ts so the composition is pinned):
 * create the sender, probe once, log the verdict, and on a ban send the one
 * owner alert (environment, container hostname, humanized retry-after,
 * redeploy guidance) — deduped across same-container restarts by a marker
 * file, because the boot watchdog restarts the SAME container on every
 * deadline during a ban (~108 restarts over the observed 9h ban) and each
 * boot would otherwise re-alert. A fresh container alerts again —
 * deliberate: a fresh IP is exactly the event worth a fresh alert.
 *
 * not verified: /tmp persistence across a same-container restart and its
 * destruction on replacement are assumed from the container-level
 * observation; record both on the tracking task at the next occurrence.
 * The marker design fails safe either way: a lost marker costs an extra
 * alert, never a suppressed one.
 *
 * Never throws: the outer catch backstops the whole composition (that arm
 * itself is unpinned — every injected part already fails open; it exists so
 * a future part's throw cannot block a boot). The alert is best-effort only,
 * per the module doc's owner-surface note: the ERROR log line is the
 * guaranteed surface, and it fires even when the marker suppresses a repeat
 * webhook alert.
 */
export async function runBootEgressProbe(
  logger: Logger,
  options: RunBootEgressProbeOptions = {}
): Promise<void> {
  try {
    const inject = options.fetchFn === undefined ? undefined : { fetchFn: options.fetchFn };
    const sendBootAlert = createWebhookAlertSender(logger, options.alertWebhookUrl, {
      fetchFn: options.fetchFn,
      source: 'boot-egress-probe',
    });
    const probe = await probeDiscordEgress(inject);
    await logEgressProbeOutcome(logger, probe, banned => {
      const markerPath = options.markerPath ?? BAN_ALERT_MARKER_PATH;
      const now = Date.now();
      const markerExpiry = readAlertMarkerExpiry(markerPath);
      if (markerExpiry !== undefined && markerExpiry > now) {
        logger.info(
          { markerExpiry },
          'Egress-ban owner alert suppressed — an unexpired dedup marker exists (the error log above still fired)'
        );
        return Promise.resolve();
      }
      // Written BEFORE the POST so a failing webhook still dedups the restart
      // storm — the error log line, not the webhook, is the guaranteed
      // surface. The marker's MEANING is "this ban window was already
      // surfaced on the guaranteed surface", so a webhook configured later
      // in the same container stays suppressed for the window — deliberate.
      writeAlertMarkerExpiry(markerPath, computeBanAlertMarkerExpiry(now, banned.retryAfterMs));
      return sendBootAlert(
        buildEgressBanAlertText({
          environment: options.environment,
          hostname: hostname(),
          probe: banned,
        })
      );
    });
  } catch (probeError) {
    logger.warn({ err: probeError }, 'Discord egress probe threw unexpectedly — continuing boot');
  }
}
