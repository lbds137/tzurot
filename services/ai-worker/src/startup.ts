/**
 * Startup Utilities
 *
 * Initialization and validation functions run during AI worker startup.
 */

import { createLogger, getConfig, HealthStatus } from '@tzurot/common-types';
import { getVoiceEngineClient } from './services/voice/VoiceEngineClient.js';

const logger = createLogger('ai-worker');

/**
 * Validate required environment variables for AI worker
 * @throws Error if required environment variables are missing
 */
export function validateRequiredEnvVars(config = getConfig()): void {
  if (config.REDIS_URL === undefined || config.REDIS_URL.length === 0) {
    throw new Error('REDIS_URL environment variable is required');
  }
}

/**
 * Validate AI-specific configuration
 * @throws Error if AI-specific environment variables are missing
 */
export function validateAIConfig(config = getConfig()): void {
  if (config.OPENAI_API_KEY === undefined || config.OPENAI_API_KEY.length === 0) {
    logger.fatal('OPENAI_API_KEY environment variable is required for memory embeddings');
    throw new Error('OPENAI_API_KEY environment variable is required for memory embeddings');
  }
}

/**
 * One-shot voice engine health check at startup.
 * Logs whether the voice engine is configured and reachable.
 * Never throws — wrapped in try/catch for resilience.
 */
export async function checkVoiceEngineHealth(): Promise<void> {
  try {
    const client = getVoiceEngineClient();
    if (client === null) {
      logger.info('[AIWorker] Voice engine not configured (VOICE_ENGINE_URL not set)');
      return;
    }

    const health = await client.getHealth();
    if (health.asr && health.tts) {
      logger.info('[AIWorker] Voice engine healthy (ASR + TTS loaded)');
    } else {
      logger.warn(
        { asrLoaded: health.asr, ttsLoaded: health.tts },
        '[AIWorker] Voice engine configured but not fully healthy'
      );
    }
  } catch (error) {
    logger.warn({ err: error }, '[AIWorker] Voice engine health check failed');
  }
}

/**
 * Build health check response
 * @param memoryHealthy Whether memory manager health check passed
 * @param workerHealthy Whether worker is running (not paused)
 * @param memoryDisabled Whether memory manager is disabled
 * @returns Health check response with status and component health
 */
export function buildHealthResponse(
  memoryHealthy: boolean,
  workerHealthy: boolean,
  memoryDisabled: boolean
): {
  status: HealthStatus;
  memory: boolean | 'disabled';
  worker: boolean;
  timestamp: string;
} {
  const isHealthy = memoryHealthy && workerHealthy;

  return {
    status: isHealthy ? HealthStatus.Healthy : HealthStatus.Degraded,
    memory: memoryDisabled ? 'disabled' : memoryHealthy,
    worker: workerHealthy,
    timestamp: new Date().toISOString(),
  };
}
