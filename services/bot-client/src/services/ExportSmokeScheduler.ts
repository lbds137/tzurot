/**
 * Export-Path Smoke Scheduler
 *
 * Weekly end-to-end exercise of the real account-export pipeline (assembler
 * → ZIP → download) against the gateway's system-reserved sentinel account,
 * validated against a source-DB row-count snapshot
 * (`exportSmokeValidator.ts`). Never touches a real user's export quota or
 * cooldown — the gateway's `startExportSmoke` route runs on its own cadence.
 *
 * Cadence design mirrors the other daily nag schedulers (see
 * `SecretRotationNagScheduler.ts`): bot-client restarts on every deploy, so
 * the CHECK runs daily/on-startup (restart-friendly) while a Redis cooldown
 * caps the actual SMOKE at once a week.
 *
 * NO production-only gate. `RetentionRunScheduler` keeps its live run (and
 * its nag) production-only because the dev DB mirrors prod's users, so
 * dev-side retention data carries no dev-specific signal — dev only
 * rehearses. That reasoning does not transfer here, and the inverse applies:
 * this smoke exercises a CODE PATH (the export pipeline), and dev runs a
 * different build than prod — a dev-side failure is exactly the early
 * warning this exists to surface, catching a breaking change before it
 * reaches a release.
 *
 * Cooldown ordering is INVERTED from the other nags. `SecretRotationNagScheduler`
 * and the retention job's nag mode check their condition first and read the
 * cooldown only once there's something to report — the cooldown there guards
 * the ALERT. Here the cooldown is read FIRST, before starting anything:
 * starting a real export job is the expensive action (a real write —
 * job-row upsert + BullMQ enqueue + a full assembler run), so the cooling
 * window must prevent the WORK, not just a duplicate notification.
 *
 * The cooldown is armed on BOTH outcomes — success and failure — which also
 * differs from `SecretRotationNagScheduler` (cooldown only on confirmed
 * embed delivery). There, a swallowed post failure should retry the very
 * next tick because posting is cheap. Here the cooldown governs the
 * EXPENSIVE WORK: a failed embed post must not buy a same-day re-export, so
 * the cooldown is armed unconditionally once a cycle reaches a terminal
 * outcome, win or lose — with one exception. On the startup run only, a
 * failure to even START the smoke where the request cannot have reached the
 * route handler (the deploy-window case: bot-client restarted, but the
 * gateway may still be rolling over) arms nothing and retries once after a
 * fixed delay instead — that failure isn't a real smoke result, just bad
 * timing. A startup timeout or an HTTP 504 is deliberately NOT retried this
 * way: either could mean the request reached a live gateway that started the
 * export job before timing out. The gateway's start route 409s on a
 * pending/in-progress job and on one completed within its short
 * recent-completion window; the latter carries the
 * `EXPORT_SMOKE_RECENT_COMPLETION` subcode and, checked first on every
 * trigger (before the startup-retry branch), posts a skipped note instead of
 * alerting and leaves the cooldown unarmed, so the next daily tick runs a
 * real smoke. A pending/in-progress 409 (no subcode) keeps the
 * immediate-alert, cooldown-armed behavior instead. The retry is an ordinary
 * run: any other failure on it — not-ready or otherwise — alerts and arms
 * the cooldown like normal.
 * A not-ready failure MID-run (a poll or download hiccup after the job
 * already started) is unaffected and still alerts-and-arms immediately,
 * since by then a real job exists server-side.
 */

import { EmbedBuilder, type Client } from 'discord.js';
import type { Redis } from 'ioredis';
import { API_ERROR_SUBCODE } from '@tzurot/common-types/constants/error';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { getServiceClient } from '../utils/gatewayClients.js';
import { createIntervalScheduler } from '@tzurot/common-types/utils/intervalScheduler';
import { postOwnerChannelEmbed } from '../utils/ownerChannel.js';
import { clampEmbedText, EMBED_CAPS } from '../utils/embedLimits.js';
import { isGatewayUnreachedFailure, type GatewayFailure } from '../utils/gatewayNotReady.js';
import { createStartupRetry, STARTUP_RETRY_DELAY_MS } from '../utils/startupRetry.js';
import { validateExportArtifact, type ExportSmokeExpectedCounts } from './exportSmokeValidator.js';

const logger = createLogger('export-smoke');

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 60_000;
/** At most one real export smoke per week, across restarts. */
const SMOKE_COOLDOWN_SECONDS = 7 * 24 * 60 * 60;
const COOLDOWN_KEY = 'export-smoke:cooldown';
const POLL_INTERVAL_MS = 15_000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;
/** Bounds the artifact download the way POLL_TIMEOUT_MS bounds polling — a
 *  hung /exports/:token connection must not stall the daily check. */
const DOWNLOAD_TIMEOUT_MS = 60_000;
/**
 * Consecutive failed status-poll responses tolerated before treating polling
 * itself as the failure. A single transient gateway blip must not abort a
 * smoke that would otherwise complete a tick or two later; a run of these is
 * a real signal.
 */
const MAX_CONSECUTIVE_POLL_FAILURES = 3;
/** Embed line cap — findings carry no content, but a validation failure can enumerate many. */
const MAX_RENDERED_LINES = 15;

/** True when the gateway refused because a smoke export completed inside the recent-completion window. */
function isExportSmokeRecentCompletionFailure(failure: GatewayFailure): boolean {
  return (
    failure.kind === 'http' && failure.code === API_ERROR_SUBCODE.EXPORT_SMOKE_RECENT_COMPLETION
  );
}

const startupRetry = createStartupRetry();

const scheduler = createIntervalScheduler<[Client, Redis]>({
  intervalMs: CHECK_INTERVAL_MS,
  startupDelayMs: STARTUP_DELAY_MS,
  logger,
  run: (client, redis) =>
    runExportSmokeCheck(client, redis, { isStartupRun: startupRetry.consume() }),
});

/** Start the daily check (call once from the composition root). */
export function startExportSmokeScheduler(client: Client, redis: Redis): void {
  startupRetry.arm();
  scheduler.start(client, redis);
}

/** Stop the scheduler (graceful shutdown). Also clears a pending startup retry. */
export function stopExportSmokeScheduler(): void {
  scheduler.stop();
  startupRetry.reset();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

type PollOutcome =
  | { kind: 'completed'; downloadUrl: string }
  | { kind: 'completed-no-url' }
  | { kind: 'failed' }
  | { kind: 'poll-error' }
  | { kind: 'timeout' };

/** Polls export-smoke job status until completed/failed/timeout/poll-error. */
async function pollExportJob(jobId: string): Promise<PollOutcome> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let consecutiveFailures = 0;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const result = await getServiceClient().getExportSmokeStatus({ jobId });
    if (!result.ok) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
        return { kind: 'poll-error' };
      }
      continue;
    }
    consecutiveFailures = 0;

    if (result.data.status === 'completed') {
      return result.data.downloadUrl === null
        ? { kind: 'completed-no-url' }
        : { kind: 'completed', downloadUrl: result.data.downloadUrl };
    }
    if (result.data.status === 'failed') {
      return { kind: 'failed' };
    }
    // Any other status (pending/running) — keep polling.
  }
  return { kind: 'timeout' };
}

/**
 * Downloads the finished artifact from the gateway's public `/exports/:token`
 * route via plain `fetch`. This is NOT the "direct fetch to gateway"
 * antipattern the architecture rules warn about: that route is a PUBLIC,
 * rate-limited, token-authenticated download endpoint mounted OUTSIDE the
 * `/api/*` typed-client surface (api-gateway mounts it before the
 * service-auth gate), so no typed client covers it — a raw `fetch` against
 * the one-time download URL is the only way to reach it.
 */
async function downloadArtifact(
  url: string
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: string }> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch (error) {
    return {
      ok: false,
      reason: `download request threw (${error instanceof Error ? error.message : 'unknown error'})`,
    };
  }
  if (!response.ok) {
    return { ok: false, reason: `download responded with status ${String(response.status)}` };
  }
  const buffer = await response.arrayBuffer();
  return { ok: true, bytes: new Uint8Array(buffer) };
}

/** Builds the owner-channel failure embed. Findings/lines carry no exported content. */
function buildFailureEmbed(title: string, lines: string[]): EmbedBuilder {
  const rendered = lines.slice(0, MAX_RENDERED_LINES);
  const omitted = lines.length - rendered.length;
  const bodyLines = rendered.map(line => `- ${line}`);
  if (omitted > 0) {
    bodyLines.push(`…and ${String(omitted)} more.`);
  }
  const body = bodyLines.length > 0 ? bodyLines.join('\n') : 'No further detail available.';

  return new EmbedBuilder()
    .setTitle('🧯 Weekly export-path smoke failed')
    .setDescription(clampEmbedText(`**${title}**\n${body}`, EMBED_CAPS.description))
    .setFooter({ text: 'Investigate the gateway export pipeline; the smoke re-runs next week.' })
    .setTimestamp();
}

/** Builds the owner-channel informational embed for a recent-completion skip. */
function buildSkippedEmbed(detail: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('ℹ️ Weekly export-path smoke skipped')
    .setDescription(
      clampEmbedText(
        `${detail} This run could not verify that export itself (the attempt that started it never finished its download and checks).`,
        EMBED_CAPS.description
      )
    )
    .setFooter({ text: 'No action needed; the next daily check runs a full smoke.' })
    .setTimestamp();
}

/**
 * Posts the failure embed (best-effort — `postOwnerChannelEmbed` never
 * throws) and arms the cooldown unconditionally. See the module docstring
 * for why the cooldown is armed on failure too.
 */
async function alertAndArmCooldown(
  client: Client,
  redis: Redis,
  embed: EmbedBuilder
): Promise<void> {
  const delivered = await postOwnerChannelEmbed(client, embed);
  await redis.setex(COOLDOWN_KEY, SMOKE_COOLDOWN_SECONDS, new Date().toISOString());
  if (!delivered) {
    logger.warn('Export-smoke failure embed was not delivered; cooldown still armed');
  }
}

/** Exported for tests — one full check cycle. */
export async function runExportSmokeCheck(
  client: Client,
  redis: Redis,
  options: { isStartupRun?: boolean } = {}
): Promise<void> {
  try {
    // Cooldown FIRST — see the module docstring: it gates the WORK (a real
    // export job), not just the alert.
    const cooling = await redis.get(COOLDOWN_KEY);
    if (cooling !== null) {
      logger.info('Export-path smoke is in cooldown; skipping this tick');
      return;
    }

    const startResult = await getServiceClient().startExportSmoke({});
    if (!startResult.ok) {
      if (isExportSmokeRecentCompletionFailure(startResult)) {
        logger.info(
          { isStartupRun: options.isStartupRun === true },
          'Export-path smoke skipped — a smoke export completed inside the recent-completion window'
        );
        await postOwnerChannelEmbed(client, buildSkippedEmbed(startResult.error));
        return;
      }
      if (options.isStartupRun === true && isGatewayUnreachedFailure(startResult)) {
        logger.warn(
          {
            kind: startResult.kind,
            status: startResult.status,
            error: startResult.error,
            retryInMs: STARTUP_RETRY_DELAY_MS,
          },
          'Gateway not ready on the startup export smoke — retrying once before alerting'
        );
        // Runs outside the interval scheduler's in-flight guard, so an
        // overlap with the daily tick would need one to land inside this
        // retry's window — it fires STARTUP_DELAY_MS + STARTUP_RETRY_DELAY_MS
        // after start, far below CHECK_INTERVAL_MS.
        startupRetry.schedule(() => runExportSmokeCheck(client, redis));
        return;
      }
      await alertAndArmCooldown(
        client,
        redis,
        buildFailureEmbed('Could not start the export-path smoke', [`start: ${startResult.error}`])
      );
      return;
    }
    const { exportJobId, expectedCounts } = startResult.data;

    const poll = await pollExportJob(exportJobId);
    await handlePollOutcome(client, redis, exportJobId, expectedCounts, poll);
  } catch (error) {
    // Fail-open on our own machinery — the smoke must never affect the
    // bot's real operation.
    logger.warn({ err: error }, 'Export-path smoke check failed');
  }
}

/** Dispatches on the poll outcome; extracted to keep runExportSmokeCheck's line count in budget. */
async function handlePollOutcome(
  client: Client,
  redis: Redis,
  exportJobId: string,
  expectedCounts: ExportSmokeExpectedCounts,
  poll: PollOutcome
): Promise<void> {
  if (poll.kind === 'timeout') {
    await alertAndArmCooldown(
      client,
      redis,
      buildFailureEmbed('Export-path smoke timed out', [
        `job ${exportJobId} did not reach a terminal status within ${String(POLL_TIMEOUT_MS / 60_000)} minutes`,
      ])
    );
    return;
  }
  if (poll.kind === 'poll-error') {
    await alertAndArmCooldown(
      client,
      redis,
      buildFailureEmbed('Export-path smoke status polling failed repeatedly', [
        `job ${exportJobId}`,
      ])
    );
    return;
  }
  if (poll.kind === 'failed') {
    await alertAndArmCooldown(
      client,
      redis,
      buildFailureEmbed('Export-path smoke job reported failure', [`job ${exportJobId}`])
    );
    return;
  }
  if (poll.kind === 'completed-no-url') {
    await alertAndArmCooldown(
      client,
      redis,
      buildFailureEmbed('Export-path smoke completed with no download URL', [`job ${exportJobId}`])
    );
    return;
  }

  const download = await downloadArtifact(poll.downloadUrl);
  if (!download.ok) {
    await alertAndArmCooldown(
      client,
      redis,
      buildFailureEmbed('Export-path smoke artifact download failed', [download.reason])
    );
    return;
  }

  const validation = validateExportArtifact(download.bytes, expectedCounts);
  if (!validation.ok) {
    await alertAndArmCooldown(
      client,
      redis,
      buildFailureEmbed('Export-path smoke artifact failed validation', validation.findings)
    );
    return;
  }

  logger.info({ exportJobId }, 'Export-path smoke passed');
  await redis.setex(COOLDOWN_KEY, SMOKE_COOLDOWN_SECONDS, new Date().toISOString());
}
