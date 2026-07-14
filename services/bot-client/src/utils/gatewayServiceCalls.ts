/**
 * Service-to-service gateway calls (typed-client backed).
 *
 * These wrap the generated `ServiceClient` for the bot's own infrastructure
 * calls — channel/admin-settings reads, DM-session writes, conversation
 * personality lookup, diagnostic response-id updates. They previously lived as
 * hand-written `fetch()` methods on `GatewayClient`; they were migrated here so
 * their paths are codegen'd from the route manifest (and so can never drift out
 * of sync with the gateway mounts again).
 *
 * Each helper preserves the old method's ergonomics — bot-side TTL caching for
 * the hot reads, null-on-error for safe reads, and fire-and-forget (log, never
 * throw) for the best-effort writes — so call sites only swap the import, not
 * their control flow. The `ServiceClient` is minted per-call via the cheap,
 * stateless `getServiceClient()` factory.
 */

import { getConfig } from '@tzurot/common-types/config/config';
import { CONTENT_TYPES } from '@tzurot/common-types/constants/media';
import { JobStatus } from '@tzurot/common-types/constants/queue';
import { TIMEOUTS } from '@tzurot/common-types/constants/timing';
import { type GetAdminSettingsResponse } from '@tzurot/common-types/schemas/api/adminSettings';
import { type GetChannelSettingsResponse } from '@tzurot/common-types/schemas/api/channel';
import { type SttProvider } from '@tzurot/common-types/types/sttProvider';
import {
  TimeoutError,
  AudioTooLongError,
  SttUnavailableError,
} from '@tzurot/common-types/utils/errors';
import type { DeliveryOutcome } from '@tzurot/common-types/schemas/api/broadcast';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { TTLCache } from '@tzurot/common-types/utils/TTLCache';
import type { LoadedPersonality, MessageContext, TranscribeResponse } from '../types.js';
import { getValidatedServiceSecret } from '../startup.js';
import { getServiceClient } from './gatewayClients.js';

const logger = createLogger('gatewayServiceCalls');

/**
 * Channel settings lookups. 30s TTL balances per-message performance with
 * responsiveness to activation changes; 1000-entry cap bounds memory.
 */
const channelSettingsCache = new TTLCache<GetChannelSettingsResponse>({
  ttl: 30 * 1000,
  maxSize: 1000,
});

/**
 * AdminSettings singleton. Longer TTL (changes rarely, admin-only); single
 * entry since it's a singleton.
 */
const adminSettingsCache = new TTLCache<GetAdminSettingsResponse>({
  ttl: 60 * 1000,
  maxSize: 1,
});

const ADMIN_SETTINGS_CACHE_KEY = 'admin-settings';

/**
 * Invalidate channel settings cache for a specific channel.
 * Call when a channel is activated, deactivated, or its settings change.
 */
export function invalidateChannelSettingsCache(channelId: string): void {
  channelSettingsCache.delete(channelId);
  logger.debug({ channelId }, 'Invalidated channel settings cache');
}

/**
 * Clear all channel settings cache entries.
 * Used by pub/sub invalidation for 'all' events and for testing.
 */
export function clearAllChannelSettingsCache(): void {
  channelSettingsCache.clear();
}

/**
 * Invalidate the admin settings cache. Call when admin settings are updated.
 */
export function invalidateAdminSettingsCache(): void {
  adminSettingsCache.delete(ADMIN_SETTINGS_CACHE_KEY);
  logger.debug('Invalidated admin settings cache');
}

/** @internal For testing only. */
export function _clearAdminSettingsCacheForTesting(): void {
  adminSettingsCache.clear();
}

/**
 * Channel settings (activation + override state) for a channel. Cached 30s.
 * Returns null on any gateway error so callers can treat "unknown" as
 * "not activated" without a try/catch. Used per-message by the auto-response
 * processors, so the cache matters.
 */
export async function getChannelSettingsCached(
  channelId: string
): Promise<GetChannelSettingsResponse | null> {
  const cached = channelSettingsCache.get(channelId);
  if (cached !== null) {
    logger.debug({ channelId }, 'Channel settings cache hit');
    return cached;
  }

  const result = await getServiceClient().getChannelSettings(channelId);
  if (!result.ok) {
    logger.warn({ channelId, status: result.status }, 'Channel settings check failed');
    return null;
  }

  // Cache the result (including "no settings" responses).
  channelSettingsCache.set(channelId, result.data);
  logger.debug({ channelId, hasSettings: result.data.hasSettings }, 'Cached channel settings');
  return result.data;
}

/**
 * AdminSettings singleton. Cached 60s; null on error. Reads the service-only
 * `/api/internal/admin-settings` alias (the owner `/api/admin/settings` route
 * hard-rejects service callers via requireUserAuth before the handler's
 * service-or-owner check can run).
 */
export async function getAdminSettingsCached(): Promise<GetAdminSettingsResponse | null> {
  const cached = adminSettingsCache.get(ADMIN_SETTINGS_CACHE_KEY);
  if (cached !== null) {
    logger.debug('Admin settings cache hit');
    return cached;
  }

  const result = await getServiceClient().getAdminSettingsInternal();
  if (!result.ok) {
    logger.warn({ status: result.status }, 'Admin settings fetch failed');
    return null;
  }

  adminSettingsCache.set(ADMIN_SETTINGS_CACHE_KEY, result.data);
  logger.debug('Admin settings fetched and cached');
  return result.data;
}

/**
 * Record the active personality in a DM channel after a multi-tag fan-out.
 * Idempotent; best-effort (logs on failure, never throws — a transient gateway
 * hiccup must not break the delivery itself).
 *
 * On success, invalidates the 30s channel-settings cache so the next bare DM
 * message sees the newly-recorded active personality instead of the stale
 * previous-session one for up to 30s.
 */
export async function setDmSessionPersonality(
  channelId: string,
  personalitySlug: string
): Promise<void> {
  const result = await getServiceClient().setDmSession({ channelId, personalitySlug });
  if (!result.ok) {
    logger.error(
      { status: result.status, channelId, personalitySlug },
      'Failed to record DM session'
    );
    return;
  }
  invalidateChannelSettingsCache(channelId);
  logger.debug({ channelId, personalitySlug }, 'DM session personality recorded');
}

/**
 * Look up which personality sent a message by Discord message ID (the tier-2
 * DB fallback for reply resolution when the Redis cache misses). Returns null
 * when no message is found (404) or on any error. Works for DMs and guild
 * channels — the query is keyed on `discordMessageId` only.
 */
export async function lookupPersonalityFromMessage(
  discordMessageId: string
): Promise<{ personalityId: string; personalityName?: string } | null> {
  const result = await getServiceClient().lookupPersonalityFromMessage({ discordMessageId });
  if (!result.ok) {
    // 404 (no message) and other errors both resolve to "not found" here.
    logger.debug(
      { discordMessageId, status: result.status },
      'No personality found for Discord message ID'
    );
    return null;
  }
  logger.debug(
    { discordMessageId, personalityId: result.data.personalityId },
    'Found personality via conversation lookup'
  );
  // Normalize null → undefined to preserve the original method's contract
  // (the route schema permits null; callers only ever expected string | undefined).
  return {
    personalityId: result.data.personalityId,
    personalityName: result.data.personalityName ?? undefined,
  };
}

/**
 * Link a diagnostic log with the Discord message IDs of its response chunks so
 * future /inspect lookups by response-message-ID resolve. Fire-and-forget:
 * logs on failure, never throws.
 */
export async function updateDiagnosticResponseIds(
  requestId: string,
  responseMessageIds: string[]
): Promise<void> {
  const result = await getServiceClient().updateDiagnosticResponseIds(requestId, {
    responseMessageIds,
  });
  if (!result.ok) {
    logger.warn({ requestId, status: result.status }, 'Failed to update diagnostic response IDs');
    return;
  }
  logger.debug({ requestId, responseMessageIds }, 'Updated diagnostic response IDs');
}

/**
 * Submit an async AI generation job. Returns the job/request IDs immediately;
 * the result is delivered later via the Redis result stream (JobTracker).
 * Throws on failure — the chat path needs to surface submission errors.
 */
export async function generate(
  personality: LoadedPersonality,
  context: MessageContext
): Promise<{ jobId: string; requestId: string }> {
  // Attachment-payload context — kept because the gateway downloads
  // extended-context attachments synchronously before responding, so this is
  // the first place to look if the heavy-attachment submit timeout recurs.
  logger.debug(
    {
      hasReferencedMessages:
        context.referencedMessages !== undefined && context.referencedMessages !== null,
      referencedCount: context.referencedMessages?.length ?? 0,
      contextKeys: Object.keys(context),
    },
    'Submitting generation context'
  );
  const result = await getServiceClient().aiGenerate({
    personality,
    message: context.messageContent,
    context,
  });
  if (!result.ok) {
    logger.error({ status: result.status, error: result.error }, 'Failed to submit job');
    throw new Error(`Gateway request failed: ${result.status} ${result.error}`);
  }
  logger.info({ jobId: result.data.jobId }, 'Job submitted successfully');
  return { jobId: result.data.jobId, requestId: result.data.requestId };
}

/**
 * Confirm a job result was delivered to Discord (PENDING_DELIVERY → DELIVERED).
 * Best-effort: logs on failure, never throws — the cleanup job eventually
 * removes unconfirmed results.
 */
export async function confirmDelivery(jobId: string): Promise<void> {
  const result = await getServiceClient().aiConfirmDelivery(jobId);
  if (!result.ok) {
    logger.error({ status: result.status, jobId }, 'Failed to confirm delivery');
    return;
  }
  logger.debug({ jobId }, 'Delivery confirmed');
}

/**
 * Filter a broadcast batch's delivery-log ids down to the still-pending
 * subset — the DM worker's stall-rerun double-DM guard. THROWS on gateway
 * failure: this runs BEFORE any DM is sent, so failing the job here is safe
 * and lets BullMQ's queue-level retry (attempts + backoff) actually re-run
 * the batch. Swallowing the error would complete the job with the whole
 * batch silently undelivered.
 */
export async function filterPendingDeliveries(
  releaseId: string,
  deliveryLogIds: string[]
): Promise<string[]> {
  const result = await getServiceClient().releaseBroadcastPending(releaseId, { deliveryLogIds });
  if (!result.ok) {
    logger.error({ status: result.status, releaseId }, 'Failed to filter pending deliveries');
    throw new Error(`Pending-delivery filter failed: ${result.status} ${result.error}`);
  }
  return result.data.pendingDeliveryLogIds;
}

/** One reported delivery outcome (mirrors the internal-route contract). */
export interface DeliveryReport {
  deliveryLogId: string;
  status: DeliveryOutcome;
  errorCode?: string;
}

const REPORT_MAX_ATTEMPTS = 3;
const REPORT_RETRY_BASE_DELAY_MS = 500;

/** Gateway failures worth retrying: infrastructure states, never 4xx rejections. */
function isRetryableGatewayFailure(failure: { kind: string; status: number }): boolean {
  return failure.kind === 'network' || failure.kind === 'timeout' || failure.status >= 500;
}

/**
 * Report a batch's delivery outcomes to the gateway ledger, retrying
 * transient failures — a lost report leaves a SENT row looking pending, and a
 * later stall-rerun would re-DM it (redeploys of gateway and bot-client are
 * correlated on this platform, so "report failed" and "job stalls" co-occur).
 *
 * After the retries this still NEVER throws — the DM is already sent, and a
 * thrown error would fail the job, retry the batch, and re-DM the very row
 * whose report was lost. The asymmetry with filterPendingDeliveries (which
 * throws) is deliberate: throw before spend, absorb after spend.
 */
export async function reportDeliveries(
  releaseId: string,
  results: DeliveryReport[]
): Promise<void> {
  if (results.length === 0) {
    return;
  }
  for (let attempt = 1; attempt <= REPORT_MAX_ATTEMPTS; attempt++) {
    const result = await getServiceClient().releaseBroadcastDeliveries(releaseId, { results });
    if (result.ok) {
      logger.debug(
        { releaseId, updated: result.data.updated, completed: result.data.completed },
        'Delivery outcomes reported'
      );
      return;
    }
    if (!isRetryableGatewayFailure(result) || attempt === REPORT_MAX_ATTEMPTS) {
      logger.error(
        { status: result.status, releaseId, attempt },
        'Failed to report delivery outcomes — rows stay pending (re-DM risk on stall-rerun)'
      );
      return;
    }
    const delayMs = REPORT_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
    logger.warn(
      { status: result.status, releaseId, attempt, nextDelayMs: delayMs },
      'Transient failure reporting delivery outcomes; retrying'
    );
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
}

// ---------------------------------------------------------------------------
// Raw-fetch helpers (the two sanctioned exceptions to typed-client usage).
//
//   transcribe — a synchronous job-wait (`?wait=true`) that can legitimately
//     run up to STT_GATEWAY (240s), exceeding the route-manifest's 60s
//     timeoutMs cap. It's a long-poll job pattern, not RPC, so it stays a raw
//     call with its own timeout + transient-network retry.
//   healthCheck — `/health` is a public root-level liveness probe, not part of
//     the gateway's typed `/api/*` contract.
//
// Both are allow-listed in gatewayFetchGuard.test.ts via the
// `raw-fetch-allowed:` marker on their fetch lines.
// ---------------------------------------------------------------------------

const TRANSIENT_NETWORK_CODES = new Set(['UND_ERR_SOCKET', 'ECONNRESET', 'ECONNREFUSED']);
// Total attempts = (MAX - 1) loop iterations + one final attempt outside the
// loop, so MAX=3 means three tries. The final attempt is split out so its
// failure can log the exhausted-retries context before re-throwing.
const TRANSCRIBE_MAX_ATTEMPTS = 3;
const TRANSCRIBE_RETRY_BASE_DELAY_MS = 500;

function isTransientNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  const cause = (err as Error & { cause?: { code?: string } }).cause;
  return cause?.code !== undefined && TRANSIENT_NETWORK_CODES.has(cause.code);
}

async function retryTranscribeOnTransientNetworkError<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt < TRANSCRIBE_MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isTransientNetworkError(err)) {
        throw err;
      }
      const delayMs = TRANSCRIBE_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      logger.warn(
        { err, attempt, nextDelayMs: delayMs },
        'Transient network error during transcribe; retrying'
      );
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  // Final attempt — log on failure before re-throwing so attempt-count context
  // survives propagation to the caller's error handler.
  try {
    return await fn();
  } catch (err) {
    logger.warn(
      { err, attempt: TRANSCRIBE_MAX_ATTEMPTS },
      'Transcribe failed on final attempt; no more retries'
    );
    throw err;
  }
}

// Bot-client-side shapes (NOT the common-types route schema). The wire
// contract is validated server-side against TranscribeRequestSchema; these
// describe what bot-client builds from Discord attachments / reads off the
// raw transcribe response, so they intentionally live here rather than being
// imported.
interface TranscribeAttachment {
  url: string;
  contentType: string;
  name?: string;
  size?: number;
  isVoiceMessage?: boolean;
  duration?: number;
  waveform?: string;
}

interface TranscribeResult {
  content: string;
  /** Which STT provider produced the transcript; surfaced as user-visible attribution. */
  provider?: SttProvider;
  /**
   * User's resolved `showModelFooter` default. `false` ⇒ suppress the
   * `-# Transcribed by X` footer; `undefined`/`true` ⇒ render it.
   */
  showModelFooter?: boolean;
  metadata?: { processingTimeMs?: number };
}

async function transcribeOnce(
  attachments: TranscribeAttachment[],
  userId: string | undefined
): Promise<TranscribeResult> {
  // raw-fetch-allowed: synchronous STT job-wait (up to 240s) exceeds the typed
  // client's 60s timeoutMs cap — long-poll job pattern, not RPC.
  const response = await fetch(`${getConfig().GATEWAY_URL}/ai/transcribe?wait=true`, {
    method: 'POST',
    headers: {
      'Content-Type': CONTENT_TYPES.JSON,
      'X-Service-Auth': getValidatedServiceSecret(),
    },
    body: JSON.stringify({
      attachments,
      ...(userId !== undefined && { userId }),
    }),
    signal: AbortSignal.timeout(TIMEOUTS.STT_GATEWAY),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Transcription request failed: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as TranscribeResponse;

  if (data.status !== JobStatus.Completed) {
    throw new Error(`Transcription job ${data.jobId} status: ${data.status}`);
  }

  // A failed transcription RESOLVES the job (success:false) rather than rejecting, so
  // it arrives here as a Completed status with empty content + a structured
  // failureReason. Reconstruct a typed error from that reason — Error instances can't
  // survive the BullMQ/Redis job boundary, so failureReason is the wire carrier — so
  // VoiceTranscriptionService can show "taking too long" / "too long" instead of the
  // generic "couldn't transcribe".
  const failureReason = data.result?.failureReason;
  if (failureReason === 'timeout') {
    // VOICE_ENGINE_API is the timeout that actually fires upstream (the ai-worker's
    // per-call STT budget); STT_GATEWAY is the bot's own wall. Use the upstream value
    // so TimeoutError.timeoutMs is accurate if it's ever read for diagnostics.
    throw new TimeoutError(TIMEOUTS.VOICE_ENGINE_API, 'voice transcription');
  }
  if (failureReason === 'too_long') {
    throw new AudioTooLongError(data.result?.error);
  }
  if (failureReason === 'unavailable') {
    // The per-provider retries within the cascade already ran server-side
    // (job-level retries deliberately fast-fail this shape) — surface a
    // retry-aware message, not the generic one.
    throw new SttUnavailableError(data.result?.error);
  }

  if (
    data.result?.content === undefined ||
    data.result.content === null ||
    data.result.content.length === 0
  ) {
    throw new Error('No transcript in job result');
  }

  logger.info({ jobId: data.jobId }, 'Transcription completed');
  return {
    content: data.result.content,
    provider: data.result.provider,
    showModelFooter: data.result.showModelFooter,
    metadata: data.result.metadata,
  };
}

/**
 * Request voice transcription (synchronous). Retries on transient network
 * errors (api-gateway container swap during Railway deploy surfaces as
 * `UND_ERR_SOCKET`/`ECONNRESET`/`ECONNREFUSED`); idempotent because the
 * ai-worker job is keyed by requestId. HTTP-level errors are NOT retried.
 */
export async function transcribe(
  attachments: TranscribeAttachment[],
  userId?: string
): Promise<TranscribeResult> {
  try {
    return await retryTranscribeOnTransientNetworkError(() => transcribeOnce(attachments, userId));
  } catch (error) {
    logger.error({ err: error }, 'Transcription failed');
    throw error;
  }
}

/** Liveness probe against the gateway's public /health endpoint. */
export async function healthCheck(): Promise<boolean> {
  try {
    // raw-fetch-allowed: /health is a public root-level liveness probe, not part
    // of the typed /api/* contract.
    const response = await fetch(`${getConfig().GATEWAY_URL}/health`);
    return response.ok;
  } catch (error) {
    logger.error({ err: error }, 'Health check failed');
    return false;
  }
}
