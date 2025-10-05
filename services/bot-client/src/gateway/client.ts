/**
 * API Gateway HTTP Client
 *
 * Handles HTTP requests to the API Gateway service for AI generation.
 */

import { createLogger, getConfig, TIMEOUTS } from '@tzurot/common-types';
import type { BotPersonality, MessageContext, GatewayResponse, JobResult } from '../types.js';

const logger = createLogger('GatewayClient');
const config = getConfig();

/**
 * API Gateway client for making AI generation requests
 */
export class GatewayClient {
  private readonly baseUrl: string;
  private readonly pollInterval: number;
  private readonly maxPollAttempts: number;

  constructor(
    baseUrl?: string,
    pollInterval = TIMEOUTS.GATEWAY_POLL_INTERVAL,
    maxPollAttempts = TIMEOUTS.GATEWAY_MAX_POLL_ATTEMPTS
  ) {
    this.baseUrl = baseUrl ?? config.GATEWAY_URL;
    this.pollInterval = pollInterval;
    this.maxPollAttempts = maxPollAttempts;

    logger.info(`[GatewayClient] Initialized with base URL: ${this.baseUrl}`);
  }

  /**
   * Request AI generation from the gateway
   */
  async generate(
    personality: BotPersonality,
    context: MessageContext
  ): Promise<{
    content: string;
    attachmentDescriptions?: string;
    metadata?: {
      retrievedMemories?: number;
      tokensUsed?: number;
      processingTimeMs?: number;
      modelUsed?: string;
    };
  }> {
    try {
      // Create AI generation job
      const response = await fetch(`${this.baseUrl}/ai/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          personality: personality, // Pass entire LoadedPersonality object
          message: context.messageContent,
          context: {
            userId: context.userId,
            userName: context.userName,
            channelId: context.channelId,
            serverId: context.serverId,
            conversationHistory: context.conversationHistory || [],
            attachments: context.attachments
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gateway request failed: ${response.status} ${errorText}`);
      }

      const data = await response.json() as GatewayResponse;

      logger.info(`[GatewayClient] Job created: ${data.jobId}`);

      // Calculate timeout based on number of images (voice is fast, images are slow)
      const imageCount = context.attachments?.filter(
        att => att.contentType.startsWith('image/') && !att.isVoiceMessage
      ).length ?? 0;

      // Scale timeout by number of images: 120s for 1 image, multiply for more
      const timeoutMultiplier = Math.max(1, imageCount);
      const adjustedMaxAttempts = this.maxPollAttempts * timeoutMultiplier;

      if (imageCount > 0) {
        const timeoutSeconds = (adjustedMaxAttempts * this.pollInterval) / 1000;
        logger.info(`[GatewayClient] Job has ${imageCount} image(s), timeout: ${timeoutSeconds}s`);
      }

      // Poll for job completion
      const result = await this.pollJobResult(data.jobId, adjustedMaxAttempts);

      logger.debug({ jobResult: result }, '[GatewayClient] Raw job result');

      if (result.result?.content === undefined) {
        logger.error({
          jobId: result.jobId,
          status: result.status,
          hasResult: !!result.result,
          resultKeys: result.result ? Object.keys(result.result) : []
        }, '[GatewayClient] Job result missing content');
        throw new Error('No content in job result');
      }

      logger.info(`[GatewayClient] Job completed: ${result.jobId}`);

      return {
        content: result.result.content,
        attachmentDescriptions: result.result.attachmentDescriptions,
        metadata: result.result.metadata
      };

    } catch (error) {
      logger.error({ err: error }, '[GatewayClient] Generation failed');
      throw error;
    }
  }

  /**
   * Poll for job result until completion
   */
  private async pollJobResult(jobId: string, maxAttempts = this.maxPollAttempts): Promise<JobResult> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await fetch(`${this.baseUrl}/ai/job/${jobId}`);

        if (!response.ok) {
          throw new Error(`Failed to fetch job status: ${response.status}`);
        }

        const result = await response.json() as JobResult;

        // Check if job is completed
        if (result.status === 'completed') {
          return result;
        }

        // Check if job failed
        if (result.status === 'failed') {
          throw new Error(`Job ${jobId} failed`);
        }

        // Wait before next poll
        await this.delay(this.pollInterval);

      } catch (error) {
        logger.error({ err: error }, `[GatewayClient] Poll attempt ${attempt + 1} failed`);

        if (attempt === maxAttempts - 1) {
          throw error;
        }

        await this.delay(this.pollInterval);
      }
    }

    throw new Error(`Job ${jobId} timed out after ${maxAttempts} attempts`);
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
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
