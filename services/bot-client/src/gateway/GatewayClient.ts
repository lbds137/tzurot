/**
 * API Gateway HTTP Client
 *
 * Handles HTTP requests to the API Gateway service for AI generation.
 */

import { createLogger, getConfig } from '@tzurot/common-types';
import type { BotPersonality, MessageContext, JobResult } from '../types.js';

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
      // Use wait=true to eliminate polling and use Redis pub/sub instead
      // Gateway will wait for job completion internally using BullMQ's waitUntilFinished
      const response = await fetch(`${this.baseUrl}/ai/generate?wait=true`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          personality: personality, // Pass entire LoadedPersonality object
          message: context.messageContent,
          // Pass entire context object - let TypeScript enforce completeness
          context: {
            ...context,
            // Ensure conversationHistory is always an array
            conversationHistory: context.conversationHistory || []
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gateway request failed: ${response.status} ${errorText}`);
      }

      // With wait=true, the response contains the result directly (no polling needed!)
      const data = await response.json() as JobResult;

      logger.debug({ jobResult: data }, '[GatewayClient] Received job result');

      // Validate result
      if (data.status !== 'completed') {
        logger.error({
          jobId: data.jobId,
          status: data.status
        }, '[GatewayClient] Job not completed');
        throw new Error(`Job ${data.jobId} status: ${data.status}`);
      }

      if (data.result?.content === undefined) {
        logger.error({
          jobId: data.jobId,
          hasResult: !!data.result,
          resultKeys: data.result ? Object.keys(data.result) : []
        }, '[GatewayClient] Job result missing content');
        throw new Error('No content in job result');
      }

      logger.info(`[GatewayClient] Job completed: ${data.jobId}`);

      return {
        content: data.result.content,
        attachmentDescriptions: data.result.attachmentDescriptions,
        metadata: data.result.metadata
      };

    } catch (error) {
      logger.error({ err: error }, '[GatewayClient] Generation failed');
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
      logger.error({ err: error }, '[GatewayClient] Health check failed');
      return false;
    }
  }
}
