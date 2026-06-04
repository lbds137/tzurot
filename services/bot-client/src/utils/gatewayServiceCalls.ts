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

import {
  createLogger,
  getConfig,
  CONTENT_TYPES,
  JobStatus,
  SYNC_LIMITS,
  TIMEOUTS,
  TTLCache,
  type GetChannelSettingsResponse,
  type GetAdminSettingsResponse,
  type SttProvider,
} from '@tzurot/common-types';
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

// ---------------------------------------------------------------------------
// Context dual-write (Phase 2.5 burn-in instrumentation)
//
// When CONTEXT_DUAL_WRITE=true, bot-client's Prisma-backed conversation
// writes are mirrored to the gateway's internal endpoints AFTER the
// authoritative local write. The gateway compares instead of overwriting
// (assistant-message) or finds zero work (sync) when the paths agree; any
// other outcome is the divergence signal logged below. Remove alongside the
// flag at cutover, when the gateway endpoints become the only write path.
// ---------------------------------------------------------------------------

export function isContextDualWriteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CONTEXT_DUAL_WRITE === 'true';
}

interface DualWriteAssistantMessageParams {
  channelId: string;
  guildId: string | null;
  personalityId: string;
  personaId: string;
  content: string;
  chunkMessageIds: string[];
  userMessageTime: Date;
}

/**
 * Mirror a just-persisted assistant message to the gateway endpoint.
 * Fire-and-forget: never throws. Expected outcome is `created: false,
 * matched: true` (the local write landed first with identical data);
 * anything else is logged as a divergence signal.
 */
export async function dualWritePersistAssistantMessage(
  params: DualWriteAssistantMessageParams
): Promise<void> {
  if (!isContextDualWriteEnabled()) {
    return;
  }
  try {
    const result = await getServiceClient().persistAssistantMessage({
      channelId: params.channelId,
      guildId: params.guildId,
      personalityId: params.personalityId,
      personaId: params.personaId,
      content: params.content,
      chunkMessageIds: params.chunkMessageIds,
      userMessageTime: params.userMessageTime.toISOString(),
    });
    if (!result.ok) {
      logger.warn(
        { status: result.status, channelId: params.channelId },
        'Assistant-message dual-write request failed'
      );
      return;
    }
    if (result.data.created || result.data.matched === false) {
      // created=true means the local write is missing from the DB (or wrote a
      // different deterministic id); matched=false means the row content or
      // chunk IDs differ. Both are burn-in divergence signals.
      logger.warn(
        { ...result.data, channelId: params.channelId },
        'Assistant-message dual-write DIVERGED from local write'
      );
    } else {
      logger.debug({ id: result.data.id }, 'Assistant-message dual-write matched');
    }
  } catch (error) {
    logger.warn({ err: error, channelId: params.channelId }, 'Assistant-message dual-write error');
  }
}

/**
 * Mirror an already-applied edit/delete sync snapshot to the gateway
 * endpoint. Fire-and-forget: never throws. The local sync ran first, so the
 * gateway should find zero remaining work — nonzero counts mean the two
 * paths disagreed.
 */
export async function dualWriteConversationSync(
  channelId: string,
  personalityId: string,
  observedMessages: { id: string; content: string; createdAt: Date }[]
): Promise<void> {
  if (!isContextDualWriteEnabled() || observedMessages.length === 0) {
    return;
  }
  try {
    // The wire schema caps the snapshot at SYNC_LIMITS.MAX_DISCORD_ID_LOOKUP;
    // Discord fetches are far smaller in practice, but slice defensively
    // rather than letting an oversized snapshot 400. A truncated snapshot
    // makes the gateway's delete pass see fewer messages than the local sync
    // did — i.e. false-positive divergence — so make the cap loudly
    // observable if it ever fires.
    const dropped = observedMessages.length - SYNC_LIMITS.MAX_DISCORD_ID_LOOKUP;
    if (dropped > 0) {
      logger.warn(
        { channelId, dropped, sent: SYNC_LIMITS.MAX_DISCORD_ID_LOOKUP },
        'Conversation-sync dual-write truncated snapshot; divergence signals unreliable for this pass'
      );
    }
    const result = await getServiceClient().syncConversation({
      channelId,
      personalityId,
      observedMessages: observedMessages.slice(0, SYNC_LIMITS.MAX_DISCORD_ID_LOOKUP).map(m => ({
        discordMessageId: m.id,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
    });
    if (!result.ok) {
      logger.warn(
        { status: result.status, channelId },
        'Conversation-sync dual-write request failed'
      );
      return;
    }
    if (result.data.updated > 0 || result.data.deleted > 0) {
      logger.warn(
        { ...result.data, channelId, personalityId },
        'Conversation-sync dual-write found work the local sync missed (DIVERGED)'
      );
    } else {
      logger.debug({ channelId }, 'Conversation-sync dual-write matched (zero work)');
    }
  } catch (error) {
    logger.warn({ err: error, channelId }, 'Conversation-sync dual-write error');
  }
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
    context: {
      ...context,
      conversationHistory: context.conversationHistory ?? [],
    },
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
