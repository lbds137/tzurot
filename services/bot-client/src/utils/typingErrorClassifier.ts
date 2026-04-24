/**
 * Classify errors thrown by `channel.sendTyping()` so callers can pick an
 * appropriate log level AND whether to keep retrying.
 *
 * Prior behavior: all three typing-indicator catch sites (two in JobTracker,
 * one in VoiceTranscriptionService) swallowed every error with a single
 * warn-level log. That made it impossible in logs to tell rate-limits from
 * transient network blips from channel-gone / permission-revoked states —
 * all three look identical at the log aggregator, and the interval keeps
 * firing against unreachable channels.
 *
 * Buckets (one per meaningful caller action):
 *   - `rate-limit`:          back off, keep the interval alive
 *   - `channel-unreachable`: stop retrying, clear the interval
 *   - `network`:             transient, keep the interval alive, log quietly
 *   - `unknown`:             log verbose so the classifier can be extended
 */

import { DiscordAPIError } from 'discord.js';
import type { Logger } from 'pino';

export type TypingErrorClass =
  | { kind: 'rate-limit'; retryAfterSeconds: number | null }
  | { kind: 'channel-unreachable'; code: number }
  | { kind: 'network'; cause: string }
  | { kind: 'unknown' };

// Discord API error codes we treat as "stop trying on this channel." 10003 is
// literally "channel is gone." 50001 and 50013 mean the bot lost access or
// permission — semantically distinct from channel-gone but produce the same
// caller remediation (stop firing sendTyping, the interval cannot succeed).
const CHANNEL_UNREACHABLE_CODES = new Set<number>([
  10003, // Unknown Channel
  50001, // Missing Access
  50013, // Missing Permissions
]);

export function classifyTypingError(error: unknown): TypingErrorClass {
  if (error instanceof DiscordAPIError) {
    if (error.status === 429) {
      // discord.js exposes a numeric retryAfter on some rate-limit paths but
      // not all. Extract defensively via a structural read instead of casting.
      const retryAfter = extractRetryAfter(error);
      return { kind: 'rate-limit', retryAfterSeconds: retryAfter };
    }
    if (typeof error.code === 'number' && CHANNEL_UNREACHABLE_CODES.has(error.code)) {
      return { kind: 'channel-unreachable', code: error.code };
    }
    return { kind: 'unknown' };
  }

  // Node-level network errors from undici / fetch carry an `E`-prefixed string
  // code (ETIMEDOUT, ECONNRESET, ENOTFOUND, EAI_AGAIN, etc.). These are
  // transient by definition — don't escalate, don't kill the interval.
  if (error instanceof Error) {
    const errno = (error as NodeJS.ErrnoException).code;
    if (typeof errno === 'string' && errno.startsWith('E')) {
      return { kind: 'network', cause: errno };
    }
  }

  return { kind: 'unknown' };
}

function extractRetryAfter(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const value = (error as Record<string, unknown>).retryAfter;
  return typeof value === 'number' ? value : null;
}

export interface HandleTypingErrorOptions {
  logger: Logger;
  /** Extra context to merge into every log line (jobId, source, etc.). */
  context: Record<string, unknown>;
  /** If provided, cleared when the classification is `channel-unreachable`. */
  typingInterval?: NodeJS.Timeout;
}

/**
 * Log a sendTyping failure with the right level for its classification, and
 * clear the typing interval when the channel has become unreachable. Returns
 * the classification so callers can take additional action (e.g., marking the
 * tracked job as typing-stopped).
 */
export function handleTypingError(
  error: unknown,
  options: HandleTypingErrorOptions
): TypingErrorClass {
  const classification = classifyTypingError(error);
  const { logger, context } = options;

  switch (classification.kind) {
    case 'rate-limit':
      logger.warn(
        { ...context, retryAfterSeconds: classification.retryAfterSeconds },
        'Typing indicator rate-limited by Discord'
      );
      break;
    case 'channel-unreachable':
      logger.error(
        { ...context, discordErrorCode: classification.code },
        'Typing channel unreachable — stopping indicator'
      );
      if (options.typingInterval !== undefined) {
        clearInterval(options.typingInterval);
      }
      break;
    case 'network':
      logger.info(
        { ...context, cause: classification.cause },
        'Typing indicator transient network error'
      );
      break;
    case 'unknown':
      // Preserve the original error object in the log so we have the full
      // stack/shape to extend the classifier when a new shape surfaces.
      logger.warn({ ...context, err: error }, 'Typing indicator failed (unclassified)');
      break;
  }

  return classification;
}
