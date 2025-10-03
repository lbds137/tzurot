/**
 * API Gateway HTTP Client
 *
 * Handles HTTP requests to the API Gateway service for AI generation.
 */

import { pino } from 'pino';
import type { BotPersonality, MessageContext, GatewayResponse, JobResult } from '../types.js';

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

/**
 * API Gateway client for making AI generation requests
 */
export class GatewayClient {
  private readonly baseUrl: string;
  private readonly pollInterval: number;
  private readonly maxPollAttempts: number;

  constructor(
    baseUrl?: string,
    pollInterval = 500,
    maxPollAttempts = 60
  ) {
    this.baseUrl = baseUrl ?? process.env.GATEWAY_URL ?? 'http://localhost:3000';
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
  ): Promise<string> {
    try {
      // Create AI generation job
      const response = await fetch(`${this.baseUrl}/ai/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          personality: {
            name: personality.name,
            displayName: personality.displayName,
            systemPrompt: personality.systemPrompt,
            model: personality.model,
            temperature: personality.temperature,
            maxTokens: personality.maxTokens,
            avatarUrl: personality.avatarUrl
          },
          message: context.messageContent,
          context: {
            userId: context.userId,
            userName: context.userName,
            channelId: context.channelId,
            serverId: context.serverId,
            conversationHistory: []
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gateway request failed: ${response.status} ${errorText}`);
      }

      const data = await response.json() as GatewayResponse;

      logger.info(`[GatewayClient] Job created: ${data.jobId}`);

      // Poll for job completion
      const result = await this.pollJobResult(data.jobId);

      if (result.result?.content === undefined) {
        throw new Error('No content in job result');
      }

      logger.info(`[GatewayClient] Job completed: ${result.jobId}`);

      return result.result.content;

    } catch (error) {
      logger.error('[GatewayClient] Generation failed:', error);
      throw error;
    }
  }

  /**
   * Poll for job result until completion
   */
  private async pollJobResult(jobId: string): Promise<JobResult> {
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt++) {
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
        logger.error(`[GatewayClient] Poll attempt ${attempt + 1} failed:`, error);

        if (attempt === this.maxPollAttempts - 1) {
          throw error;
        }

        await this.delay(this.pollInterval);
      }
    }

    throw new Error(`Job ${jobId} timed out after ${this.maxPollAttempts} attempts`);
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
      logger.error('[GatewayClient] Health check failed:', error);
      return false;
    }
  }
}
