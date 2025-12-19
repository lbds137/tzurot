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
  type GetChannelActivationResponse,
} from '@tzurot/common-types';
import type { LoadedPersonality, MessageContext, GenerateResponse } from '../types.js';

const logger = createLogger('GatewayClient');
const config = getConfig();

/**
 * Cache for channel activation lookups.
 * TTL of 30 seconds balances performance with responsiveness to changes.
 * Max 1000 channels to prevent unbounded memory growth.
 */
const channelActivationCache = new TTLCache<GetChannelActivationResponse>({
  ttl: 30 * 1000, // 30 seconds
  maxSize: 1000,
});

/**
 * Invalidate channel activation cache for a specific channel.
 * Call this when a channel is activated or deactivated.
 */
export function invalidateChannelActivationCache(channelId: string): void {
  channelActivationCache.delete(channelId);
  logger.debug({ channelId }, '[GatewayClient] Invalidated channel activation cache');
}

/**
 * Clear all entries in the channel activation cache.
 * @internal For testing only
 */
export function _clearChannelActivationCacheForTesting(): void {
  channelActivationCache.clear();
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
   * Get channel activation status
   *
   * Checks if a channel has an activated personality for auto-responses.
   * Used by ActivatedChannelProcessor to determine if messages should
   * receive automatic responses.
   *
   * Results are cached for 30 seconds to avoid HTTP requests on every message.
   * Use invalidateChannelActivationCache() when activation status changes.
   *
   * @param channelId - Discord channel ID to check
   * @returns Activation status and details if activated
   */
  async getChannelActivation(channelId: string): Promise<GetChannelActivationResponse | null> {
    // Check cache first
    const cached = channelActivationCache.get(channelId);
    if (cached !== null) {
      logger.debug({ channelId }, '[GatewayClient] Channel activation cache hit');
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
          '[GatewayClient] Channel activation check failed'
        );
        return null;
      }

      const data = (await response.json()) as GetChannelActivationResponse;

      // Cache the result (including "not activated" responses)
      channelActivationCache.set(channelId, data);
      logger.debug({ channelId, isActivated: data.isActivated }, '[GatewayClient] Cached channel activation');

      return data;
    } catch (error) {
      logger.error({ err: error, channelId }, '[GatewayClient] Channel activation check error');
      return null;
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
      logger.error({ err: error }, '[GatewayClient] Health check failed');
      return false;
    }
  }
}
