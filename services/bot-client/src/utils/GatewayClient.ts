/**
 * API Gateway HTTP Client
 *
 * Handles HTTP requests to the API Gateway service for AI generation.
 */

import {
  createLogger,
  getConfig,
  CONTENT_TYPES,
  JobStatus,
  TIMEOUTS,
  TTLCache,
  type GetChannelSettingsResponse,
  type GetAdminSettingsResponse,
  type DenylistCacheResponse,
  type SttProvider,
} from '@tzurot/common-types';
import type { LoadedPersonality, MessageContext, TranscribeResponse } from '../types.js';

const logger = createLogger('GatewayClient');
const config = getConfig();

/**
 * Transport-layer error codes that indicate the api-gateway is mid-restart
 * (Railway container swap). The TCP connection is accepted but the HTTP
 * listener isn't bound yet, so undici closes the socket. Safe to retry.
 */
const TRANSIENT_NETWORK_CODES = new Set(['UND_ERR_SOCKET', 'ECONNRESET', 'ECONNREFUSED']);
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
  return fn();
}

/**
 * Cache for channel settings lookups.
 * TTL of 30 seconds balances performance with responsiveness to changes.
 * Max 1000 channels to prevent unbounded memory growth.
 */
const channelSettingsCache = new TTLCache<GetChannelSettingsResponse>({
  ttl: 30 * 1000, // 30 seconds
  maxSize: 1000,
});

/**
 * Cache for admin settings singleton.
 * Longer TTL since these change rarely (admin-only).
 * Single entry since AdminSettings is a singleton.
 */
const adminSettingsCache = new TTLCache<GetAdminSettingsResponse>({
  ttl: 60 * 1000, // 60 seconds
  maxSize: 1, // Singleton - only one entry needed
});

/**
 * Invalidate channel settings cache for a specific channel.
 * Call this when a channel is activated, deactivated, or settings change.
 */
export function invalidateChannelSettingsCache(channelId: string): void {
  channelSettingsCache.delete(channelId);
  logger.debug({ channelId }, 'Invalidated channel settings cache');
}

/**
 * Clear all entries in the channel settings cache.
 * Used by pub/sub invalidation for 'all' events and for testing.
 */
export function clearAllChannelSettingsCache(): void {
  channelSettingsCache.clear();
}

/**
 * Clear admin settings cache.
 * @internal For testing only
 */
export function _clearAdminSettingsCacheForTesting(): void {
  adminSettingsCache.clear();
}

/**
 * API Gateway client for making AI generation requests
 */
export class GatewayClient {
  private readonly baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? config.GATEWAY_URL;

    logger.info({ baseUrl: this.baseUrl }, 'GatewayClient initialized');
  }

  /**
   * Request AI generation from the gateway (ASYNC PATTERN)
   *
   * Returns job ID immediately. Result will be delivered via Redis Stream.
   * Use JobTracker to manage the job and receive results.
   */
  async generate(
    personality: LoadedPersonality,
    context: MessageContext
  ): Promise<{ jobId: string; requestId: string }> {
    try {
      // Debug: Check what fields are in context before sending
      logger.debug(
        {
          hasReferencedMessages:
            context.referencedMessages !== undefined && context.referencedMessages !== null,
          count: context.referencedMessages?.length ?? 0,
          contextKeys: Object.keys(context),
        },
        'Sending context'
      );

      // ASYNC PATTERN: Don't use wait=true, get job ID immediately
      const response = await fetch(`${this.baseUrl}/ai/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': CONTENT_TYPES.JSON,
          'X-Service-Auth': config.INTERNAL_SERVICE_SECRET ?? '',
        },
        body: JSON.stringify({
          personality: personality,
          message: context.messageContent,
          context: {
            ...context,
            conversationHistory: context.conversationHistory ?? [],
          },
        }),
        // "Just submitting" is misleading: api-gateway currently downloads
        // all extended-context attachments synchronously inside the
        // /ai/generate handler before responding, so response time scales
        // with attachment payload size. Observed timeouts in prod with
        // 12-attachment requests (~several MB total) taking >10s. 60s
        // accommodates heavy-attachment cases; structural fix (move
        // downloads to ai-worker lazy-load) tracked in BACKLOG.md
        // § Production Issues.
        signal: AbortSignal.timeout(60000), // 60s
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gateway request failed: ${response.status} ${errorText}`);
      }

      // Response contains job ID (202 Accepted)
      const data = (await response.json()) as { jobId: string; requestId: string; status: string };

      logger.info({ jobId: data.jobId }, 'Job submitted successfully');

      return { jobId: data.jobId, requestId: data.requestId };
    } catch (error) {
      logger.error({ err: error }, 'Failed to submit job');
      throw error;
    }
  }

  /**
   * Request voice transcription from the gateway
   *
   * Retries on transient network errors (api-gateway container swap during
   * Railway deploy: socket accepted but HTTP listener not bound yet, surfacing
   * as `UND_ERR_SOCKET` / `ECONNRESET` / `ECONNREFUSED`). Safe to retry
   * because transcription is idempotent — the ai-worker job is keyed by
   * `requestId`. HTTP-level errors (non-2xx responses, validation failures,
   * empty results) are NOT retried — only transport-layer failures.
   */
  async transcribe(
    attachments: {
      url: string;
      contentType: string;
      name?: string;
      size?: number;
      isVoiceMessage?: boolean;
      duration?: number;
      waveform?: string;
    }[],
    userId?: string
  ): Promise<{
    content: string;
    /** Which STT provider produced the transcript; surfaced as user-visible attribution. */
    provider?: SttProvider;
    metadata?: {
      processingTimeMs?: number;
    };
  }> {
    try {
      return await retryTranscribeOnTransientNetworkError(() =>
        this.transcribeOnce(attachments, userId)
      );
    } catch (error) {
      logger.error({ err: error }, 'Transcription failed');
      throw error;
    }
  }

  private async transcribeOnce(
    attachments: Parameters<GatewayClient['transcribe']>[0],
    userId: string | undefined
  ): Promise<{
    content: string;
    provider?: SttProvider;
    metadata?: { processingTimeMs?: number };
  }> {
    const response = await fetch(`${this.baseUrl}/ai/transcribe?wait=true`, {
      method: 'POST',
      headers: {
        'Content-Type': CONTENT_TYPES.JSON,
        'X-Service-Auth': config.INTERNAL_SERVICE_SECRET ?? '',
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
      metadata: data.result.metadata,
    };
  }

  /**
   * Confirm job delivery to Discord
   * Updates job_results status to DELIVERED
   */
  async confirmDelivery(jobId: string): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/ai/job/${jobId}/confirm-delivery`, {
        method: 'POST',
        headers: {
          'Content-Type': CONTENT_TYPES.JSON,
          'X-Service-Auth': config.INTERNAL_SERVICE_SECRET ?? '',
        },
        signal: AbortSignal.timeout(5000), // 5s timeout
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Delivery confirmation failed: ${response.status} ${errorText}`);
      }

      logger.debug({ jobId }, 'Delivery confirmed');
    } catch (error) {
      logger.error({ err: error, jobId }, 'Failed to confirm delivery');
      // Don't throw - delivery confirmation is best-effort
      // The cleanup job will eventually remove unconfirmed results
    }
  }

  /**
   * Get channel settings
   *
   * Checks if a channel has settings including activated personality for auto-responses.
   * Used by ActivatedChannelProcessor to determine if messages should
   * receive automatic responses.
   *
   * Results are cached for 30 seconds to avoid HTTP requests on every message.
   * Use invalidateChannelSettingsCache() when settings change.
   *
   * @param channelId - Discord channel ID to check
   * @returns Channel settings including activation status
   */
  async getChannelSettings(channelId: string): Promise<GetChannelSettingsResponse | null> {
    // Check cache first
    const cached = channelSettingsCache.get(channelId);
    if (cached !== null) {
      logger.debug({ channelId }, 'Channel settings cache hit');
      return cached;
    }

    try {
      const response = await fetch(`${this.baseUrl}/user/channel/${channelId}`, {
        headers: {
          'X-Service-Auth': config.INTERNAL_SERVICE_SECRET ?? '',
          // Note: No X-User-Id needed - this is a service-to-service lookup
        },
        signal: AbortSignal.timeout(5000), // 5s timeout
      });

      if (!response.ok) {
        logger.warn({ channelId, status: response.status }, 'Channel settings check failed');
        return null;
      }

      const data = (await response.json()) as GetChannelSettingsResponse;

      // Cache the result (including "no settings" responses)
      channelSettingsCache.set(channelId, data);
      logger.debug({ channelId, hasSettings: data.hasSettings }, 'Cached channel settings');

      return data;
    } catch (error) {
      logger.error({ err: error, channelId }, 'Channel settings check error');
      return null;
    }
  }

  /**
   * Get channel activation status (backward compatibility)
   * @deprecated Use getChannelSettings instead
   */
  async getChannelActivation(channelId: string): Promise<GetChannelSettingsResponse | null> {
    return this.getChannelSettings(channelId);
  }

  /**
   * Fetch all denylist entries for cache hydration.
   * Called once on startup to populate the in-memory DenylistCache.
   */
  async getDenylistEntries(): Promise<DenylistCacheResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/admin/denylist/cache`, {
        headers: {
          'X-Service-Auth': config.INTERNAL_SERVICE_SECRET ?? '',
        },
        signal: AbortSignal.timeout(10000), // 10s - potentially large payload
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Denylist cache fetch failed: ${response.status} ${errorText}`);
      }

      return (await response.json()) as DenylistCacheResponse;
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch denylist entries');
      throw error;
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      return response.ok;
    } catch (error) {
      logger.error({ err: error }, 'Health check failed');
      return false;
    }
  }

  /**
   * Cache key for admin settings singleton
   */
  private static readonly ADMIN_SETTINGS_CACHE_KEY = 'admin-settings';

  /**
   * Get admin settings singleton
   * Uses cache to reduce API calls for frequently accessed settings.
   *
   * @returns Admin settings or null on error
   */
  async getAdminSettings(): Promise<GetAdminSettingsResponse | null> {
    // Check cache first
    const cached = adminSettingsCache.get(GatewayClient.ADMIN_SETTINGS_CACHE_KEY);
    if (cached !== null) {
      logger.debug('Admin settings cache hit');
      return cached;
    }

    try {
      const response = await fetch(`${this.baseUrl}/admin/settings`, {
        headers: {
          'X-Service-Auth': config.INTERNAL_SERVICE_SECRET ?? '',
        },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        logger.warn({ status: response.status }, 'Admin settings fetch failed');
        return null;
      }

      const result = (await response.json()) as GetAdminSettingsResponse;

      // Cache the result
      adminSettingsCache.set(GatewayClient.ADMIN_SETTINGS_CACHE_KEY, result);
      logger.debug('Admin settings fetched and cached');

      return result;
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch admin settings');
      return null;
    }
  }

  /**
   * Invalidate the admin settings cache.
   * Call this when admin settings are updated.
   */
  invalidateAdminSettingsCache(): void {
    adminSettingsCache.delete(GatewayClient.ADMIN_SETTINGS_CACHE_KEY);
    logger.debug('Invalidated admin settings cache');
  }

  /**
   * Lookup which personality sent a message by Discord message ID.
   * Used by ReplyResolutionService to resolve DM reply targets.
   *
   * This is a database lookup fallback when Redis cache misses (messages >7 days old).
   *
   * @param discordMessageId - The Discord snowflake ID to look up
   * @returns Personality info if found, null otherwise
   */
  async lookupPersonalityFromConversation(
    discordMessageId: string
  ): Promise<{ personalityId: string; personalityName?: string } | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}/user/conversation/message-personality?discordMessageId=${encodeURIComponent(discordMessageId)}`,
        {
          headers: {
            'X-Service-Auth': config.INTERNAL_SERVICE_SECRET ?? '',
          },
          signal: AbortSignal.timeout(5000), // 5s timeout
        }
      );

      // 404 means no message found - not an error
      if (response.status === 404) {
        logger.debug({ discordMessageId }, 'No personality found for Discord message ID');
        return null;
      }

      if (!response.ok) {
        logger.warn({ discordMessageId, status: response.status }, 'Personality lookup failed');
        return null;
      }

      const data = (await response.json()) as {
        personalityId: string;
        personalityName?: string;
      };

      logger.debug(
        { discordMessageId, personalityId: data.personalityId },
        'Found personality via conversation lookup'
      );

      return data;
    } catch (error) {
      logger.error({ err: error, discordMessageId }, 'Personality lookup error');
      return null;
    }
  }

  /**
   * Update diagnostic log with response message IDs
   *
   * Called after sending AI response to Discord to link the diagnostic log
   * with the Discord message IDs for the response chunks.
   * This enables /admin debug to lookup by response message ID.
   *
   * Fire-and-forget pattern - errors are logged but don't affect the response flow.
   *
   * @param requestId - The request ID from the AI generation
   * @param responseMessageIds - Array of Discord message IDs for the response chunks
   */
  async updateDiagnosticResponseIds(
    requestId: string,
    responseMessageIds: string[]
  ): Promise<void> {
    try {
      const response = await fetch(
        `${this.baseUrl}/admin/diagnostic/${encodeURIComponent(requestId)}/response-ids`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': CONTENT_TYPES.JSON,
            'X-Service-Auth': config.INTERNAL_SERVICE_SECRET ?? '',
          },
          body: JSON.stringify({ responseMessageIds }),
          signal: AbortSignal.timeout(5000), // 5s timeout
        }
      );

      if (!response.ok) {
        // Log but don't throw - this is best-effort
        logger.warn(
          { requestId, status: response.status },
          'Failed to update diagnostic response IDs'
        );
        return;
      }

      logger.debug({ requestId, responseMessageIds }, 'Updated diagnostic response IDs');
    } catch (error) {
      // Log but don't throw - this is fire-and-forget
      logger.warn({ err: error, requestId }, 'Error updating diagnostic response IDs');
    }
  }
}
