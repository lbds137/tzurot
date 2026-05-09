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
 * Latency threshold above which a successful sendTyping call is logged as
 * a warning. Discord's typical sendTyping latency is <500ms; sustained
 * latency above this threshold is the early-warning signal for the
 * REST-queue stall class of bug (see callers — sendTyping has been
 * observed to hang indefinitely under sustained rate-limit pressure).
 *
 * The 3000ms value coincides with Discord's interaction-acknowledgement
 * deadline (3s) — chosen deliberately. A sendTyping call slower than the
 * smallest deadline the bot must meet for any Discord operation is already
 * in problem territory, regardless of REST-queue stall specifics.
 */
const SLOW_TYPING_THRESHOLD_MS = 3000;

/**
 * Channel-shape we need from the caller. discord.js channel types
 * conditionally have `sendTyping`; callers are responsible for the
 * `'sendTyping' in channel` guard before calling this helper.
 */
interface SendTypingChannel {
  id: string;
  sendTyping: () => Promise<void>;
}

export interface SendTypingIndicatorOptions {
  logger: Logger;
  /**
   * Free-form label describing where this typing indicator is being fired
   * from (e.g., 'voice-transcription-initial', 'job-tracker-initial').
   * Surfaces in both the slow-warn log and the handleTypingError log.
   */
  source: string;
  /** If provided, cleared when handleTypingError sees `channel-unreachable`. */
  typingInterval?: NodeJS.Timeout;
  /**
   * Optional structured fields to merge into log entries (slow-warn and
   * error). Use for caller-specific correlation IDs that aren't covered by
   * the default `source` + `channelId` fields — e.g., `{ jobId }` for
   * JobTracker calls, `{ messageId }` for one-shot calls. Spread last so
   * caller fields can override defaults if they have richer info for the
   * same key.
   */
  extraContext?: Record<string, unknown>;
}

/**
 * Single source of truth for firing a Discord typing indicator. Three
 * properties of this helper that callers should NOT replicate inline:
 *
 *  1. **Fire-and-forget**: never returns a Promise, never awaitable. Awaiting
 *     `channel.sendTyping()` directly has been observed to hang indefinitely
 *     when Discord's REST queue stalls under rate-limit pressure (the
 *     promise neither resolves nor rejects). The typing indicator is purely
 *     visual; a missed flash is strictly better than a hung pipeline.
 *  2. **Latency telemetry**: warns when sendTyping resolves slower than
 *     SLOW_TYPING_THRESHOLD_MS. Provides early warning for the queue-stall
 *     class of bug before it degrades into a full hang.
 *  3. **Error classification**: routes failures through `handleTypingError`
 *     so rate-limit / channel-unreachable / network / unknown all get the
 *     right log level + interval cleanup.
 *
 * An ESLint rule (no-restricted-syntax) blocks `await channel.sendTyping()`
 * project-wide to prevent accidental reintroduction of the hang.
 */
export function sendTypingIndicator(
  channel: SendTypingChannel,
  options: SendTypingIndicatorOptions
): void {
  const { logger, source, typingInterval, extraContext } = options;
  const start = Date.now();
  channel
    .sendTyping()
    .then(() => {
      const elapsed = Date.now() - start;
      if (elapsed > SLOW_TYPING_THRESHOLD_MS) {
        logger.warn(
          { source, channelId: channel.id, elapsedMs: elapsed, ...extraContext },
          'sendTyping resolved slowly — possible REST queue pressure'
        );
      }
    })
    .catch((err: unknown) => {
      handleTypingError(err, {
        logger,
        context: { source, channelId: channel.id, ...extraContext },
        typingInterval,
      });
    });
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
    default: {
      // Exhaustiveness guard: if a new variant is added to `TypingErrorClass`
      // and a case isn't added above, `_exhaustive: never` fails compilation.
      // Without this, the switch would silently drop the new kind — no log,
      // no error, a dark metric. The runtime warn mirrors the `unknown` arm
      // so production keeps some visibility while the code path is unreachable
      // unless the type check has been bypassed.
      const _exhaustive: never = classification;
      logger.warn(
        { ...context, err: error, unhandledKind: _exhaustive },
        'Typing indicator failed (unhandled classification kind)'
      );
    }
  }

  return classification;
}
