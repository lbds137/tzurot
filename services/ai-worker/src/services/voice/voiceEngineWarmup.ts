/**
 * Voice Engine Warm-Up
 *
 * Shared utility for waking voice-engine from Railway Serverless sleep.
 * First ping triggers Railway to start the container; subsequent polls
 * wait for model loading (~56s measured cold boot).
 *
 * Used by both TTS (TTSStep) and STT (AudioProcessor) paths.
 */

import { createLogger } from '@tzurot/common-types';
import type { VoiceEngineClient } from './VoiceEngineClient.js';

const logger = createLogger('VoiceEngineWarmup');

/** Total time budget for health polling during voice engine cold start (ms).
 * Railway Serverless cold boot measured at ~56s — 75s gives comfortable margin.
 * Note: effective poll count varies — ECONNREFUSED resolves instantly (~25 polls),
 * but once Railway's LB is up the 5s health timeout may reduce it to ~10 polls. */
const DEFAULT_BUDGET_MS = 75_000;

/** Interval between health check polls (ms) */
const DEFAULT_POLL_INTERVAL_MS = 3_000;

export interface WarmupOptions {
  budgetMs?: number;
  pollIntervalMs?: number;
}

/**
 * Wait for voice-engine to become ready by polling /health.
 * First ping wakes Railway Serverless; subsequent polls wait for model loading (~56s).
 * Returns true if the requested capability is ready, false if budget exhausted.
 *
 * Callers should proceed even on `false` — registration/synthesis will fail with
 * a clear error if the engine truly isn't available.
 */
export async function waitForVoiceEngine(
  client: VoiceEngineClient,
  capability: 'asr' | 'tts',
  options?: WarmupOptions
): Promise<boolean> {
  const budgetMs = options?.budgetMs ?? DEFAULT_BUDGET_MS;
  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + budgetMs;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt++;
    // getHealth() is error-safe — wraps all errors (ECONNREFUSED, 502, etc.)
    // and returns { asr: false, tts: false }. It never throws, so the loop
    // is resilient to transient network failures during the full boot window.
    const health = await client.getHealth();
    if (health[capability]) {
      return true;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      break;
    }
    logger.info(
      { capability, attempt, remainingMs: remaining },
      `Voice engine ${capability.toUpperCase()} not ready — waiting for cold start`
    );
    await new Promise(resolve => setTimeout(resolve, Math.min(pollIntervalMs, remaining)));
  }

  logger.warn(
    { capability, attempts: attempt, budgetMs },
    `Voice engine ${capability.toUpperCase()} still not ready after health budget`
  );
  return false;
}
