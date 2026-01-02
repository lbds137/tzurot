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
  INTERVALS,
  TIMEOUTS,
  TTLCache,
  type GetChannelSettingsResponse,
  type GetAdminSettingsResponse,
} from '@tzurot/common-types';
import type { LoadedPersonality, MessageContext, GenerateResponse } from '../types.js';

const logger = createLogger('GatewayClient');
const config = getConfig();

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
  logger.debug({ channelId }, '[GatewayClient] Invalidated channel settings cache');
}

/**
 * Clear all entries in the channel settings cache.
 * Used by pub/sub invalidation for 'all' events and for testing.
 */
export function clearAllChannelSettingsCache(): void {
  channelSettingsCache.clear();
}

/**
 * Alias for testing compatibility
 * @internal For testing only
 */
export const _clearChannelSettingsCacheForTesting = clearAllChannelSettingsCache;

// Backward compatibility aliases
/** @deprecated Use invalidateChannelSettingsCache */
export const invalidateChannelActivationCache = invalidateChannelSettingsCache;
/** @deprecated Use clearAllChannelSettingsCache */
export const clearAllChannelActivationCache = clearAllChannelSettingsCache;
/** @deprecated Use _clearChannelSettingsCacheForTesting */
export const _clearChannelActivationCacheForTesting = clearAllChannelSettingsCache;

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

    logger.info(`[GatewayClient] Initialized with base URL: ${this.baseUrl}`);
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
        '[GatewayClient] Sending context'
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
        // Short timeout - we're just submitting the job
        signal: AbortSignal.timeout(10000), // 10s
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gateway request failed: ${response.status} ${errorText}`);
      }

      // Response contains job ID (202 Accepted)
      const data = (await response.json()) as { jobId: string; requestId: string; status: string };

      logger.info({ jobId: data.jobId }, '[GatewayClient] Job submitted successfully');

      return { jobId: data.jobId, requestId: data.requestId };
    } catch (error) {
      logger.error({ err: error }, '[GatewayClient] Failed to submit job');
      throw error;
    }
  }

  /**
   * Request voice transcription from the gateway
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
    }[]
  ): Promise<{
    content: string;
    metadata?: {
      processingTimeMs?: number;
    };
  }> {
    try {
      const response = await fetch(`${this.baseUrl}/ai/transcribe?wait=true`, {
        method: 'POST',
        headers: {
          'Content-Type': CONTENT_TYPES.JSON,
          'X-Service-Auth': config.INTERNAL_SERVICE_SECRET ?? '',
        },
        body: JSON.stringify({
          attachments,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Transcription request failed: ${response.status} ${errorText}`);
      }

      const data = (await response.json()) as GenerateResponse;

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

      logger.info(`[GatewayClient] Transcription completed: ${data.jobId}`);

      return {
        content: data.result.content,
        metadata: data.result.metadata,
      };
    } catch (error) {
      logger.error({ err: error }, '[GatewayClient] Transcription failed');
      throw error;
    }
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

      logger.debug({ jobId }, '[GatewayClient] Delivery confirmed');
    } catch (error) {
      logger.error({ err: error, jobId }, '[GatewayClient] Failed to confirm delivery');
      // Don't throw - delivery confirmation is best-effort
      // The cleanup job will eventually remove unconfirmed results
    }
  }

  /**
   * Poll job status until completed or failed
   *
   * For use by /character chat command which needs synchronous-like behavior.
   * Polls the job status endpoint until the job completes.
   *
   * @param jobId - Job ID to poll
   * @param options - Polling options
   * @returns Job result when complete
   * @throws Error if job fails or times out
   */
  async pollJobUntilComplete(
    jobId: string,
    options: { maxWaitMs?: number; pollIntervalMs?: number } = {}
  ): Promise<GenerateResponse['result']> {
    const maxWaitMs = options.maxWaitMs ?? TIMEOUTS.JOB_BASE;
    const pollIntervalMs = options.pollIntervalMs ?? INTERVALS.JOB_POLL_INTERVAL;
    const startTime = Date.now();

    logger.info({ jobId, maxWaitMs, pollIntervalMs }, '[GatewayClient] Starting job poll');

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const response = await fetch(`${this.baseUrl}/ai/job/${jobId}`, {
          headers: {
            'X-Service-Auth': config.INTERNAL_SERVICE_SECRET ?? '',
          },
          signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) {
          throw new Error(`Job status check failed: ${response.status}`);
        }

        const data = (await response.json()) as {
          status: string;
          result?: GenerateResponse['result'];
        };

        logger.debug({ jobId, status: data.status }, '[GatewayClient] Job status check');

        if (data.status === 'completed') {
          logger.info({ jobId }, '[GatewayClient] Job completed');
          return data.result;
        }

        if (data.status === 'failed') {
          throw new Error(`Job ${jobId} failed`);
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      } catch (error) {
        // Re-throw job failure errors - they should not be retried
        // Format: "Job {jobId} failed" - NOT "Job status check failed"
        if (error instanceof Error && /^Job .+ failed$/.exec(error.message)) {
          throw error;
        }
        // On network error, wait and retry
        logger.warn({ err: error, jobId }, '[GatewayClient] Poll request failed, retrying');
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      }
    }

    throw new Error(`Job ${jobId} timed out after ${maxWaitMs}ms`);
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
      logger.debug({ channelId }, '[GatewayClient] Channel settings cache hit');
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
        logger.warn(
          { channelId, status: response.status },
          '[GatewayClient] Channel settings check failed'
        );
        return null;
      }

      const data = (await response.json()) as GetChannelSettingsResponse;

      // Cache the result (including "no settings" responses)
      channelSettingsCache.set(channelId, data);
      logger.debug(
        { channelId, hasSettings: data.hasSettings },
        '[GatewayClient] Cached channel settings'
      );

      return data;
    } catch (error) {
      logger.error({ err: error, channelId }, '[GatewayClient] Channel settings check error');
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
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      return response.ok;
    } catch (error) {
      logger.error({ err: error }, '[GatewayClient] Health check failed');
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
      logger.debug('[GatewayClient] Admin settings cache hit');
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
        logger.warn({ status: response.status }, '[GatewayClient] Admin settings fetch failed');
        return null;
      }

      const result = (await response.json()) as GetAdminSettingsResponse;

      // Cache the result
      adminSettingsCache.set(GatewayClient.ADMIN_SETTINGS_CACHE_KEY, result);
      logger.debug('[GatewayClient] Admin settings fetched and cached');

      return result;
    } catch (error) {
      logger.error({ err: error }, '[GatewayClient] Failed to fetch admin settings');
      return null;
    }
  }

  /**
   * Invalidate the admin settings cache.
   * Call this when admin settings are updated.
   */
  invalidateAdminSettingsCache(): void {
    adminSettingsCache.delete(GatewayClient.ADMIN_SETTINGS_CACHE_KEY);
    logger.debug('[GatewayClient] Invalidated admin settings cache');
  }

  /**
   * Get the global extended context default setting
   *
   * @returns true if extended context is enabled by default, false otherwise
   */
  async getExtendedContextDefault(): Promise<boolean> {
    const settings = await this.getAdminSettings();

    if (settings === null) {
      // Default to false if settings unavailable
      return false;
    }

    return settings.extendedContextDefault;
  }
}
