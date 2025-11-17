/**
 * API Gateway HTTP Client
 *
 * Handles HTTP requests to the API Gateway service for AI generation.
 */

import { createLogger, getConfig, CONTENT_TYPES } from '@tzurot/common-types';
import type { LoadedPersonality, MessageContext, GenerateResponse } from '../types.js';

const logger = createLogger('GatewayClient');
const config = getConfig();

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

      if ((data.status as string) !== 'completed') {
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
