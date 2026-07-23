/**
 * Classify errors from sending a user DM (release-notes / broadcast delivery)
 * into the delivery-ledger outcomes the gateway records.
 *
 * The split that matters operationally:
 *   - `failed_permanent`: the user can never receive this DM (DMs closed,
 *     bot blocked, unknown user) — retrying is spam, and two consecutive
 *     permanents auto-disable the user's notifications server-side.
 *   - `failed_transient`: infrastructure hiccup (rate limit, network, 5xx) —
 *     a future retry sweep may re-attempt.
 *   - `bot_level`: the BOT is quarantined/limited (Discord 20026) and cannot
 *     create DMs. The recipient is perfectly reachable — the bot is not — so
 *     this is neither the user's fault nor an infra hiccup: it must never feed
 *     the recipient's auto-disable streak or the retention undeliverable stamp,
 *     and it is tallied in its own bucket rather than either failure bucket.
 *
 * Mirrors typingErrorClassifier's discriminated-union shape.
 */

import { DiscordAPIError } from 'discord.js';

export type DmErrorClass =
  | { kind: 'permanent'; code: number }
  | { kind: 'bot_level'; code: number }
  | { kind: 'transient'; cause: string };

// Discord API error codes meaning "this user is unreachable, forever."
const DM_PERMANENT_CODES = new Set<number>([
  10013, // Unknown User (deleted account)
  50007, // Cannot send messages to this user (DMs closed / bot blocked)
  50278, // No mutual guilds (user left every shared server) — durable until
  //       they rejoin, and a rejoin implies renewed interest anyway; retrying
  //       without it fails identically every release.
]);

// Discord API error codes meaning "the BOT can't DM (quarantined / limited)."
// The recipient is reachable; retrying won't help while the bot is flagged, and
// it must never be charged to the recipient (auto-disable / undeliverable stamp).
const DM_BOT_LEVEL_CODES = new Set<number>([
  20026, // Bot quarantined / limited by Discord — createDM is refused bot-wide.
]);

export function classifyDmError(error: unknown): DmErrorClass {
  if (error instanceof DiscordAPIError) {
    if (typeof error.code === 'number' && DM_PERMANENT_CODES.has(error.code)) {
      return { kind: 'permanent', code: error.code };
    }
    if (typeof error.code === 'number' && DM_BOT_LEVEL_CODES.has(error.code)) {
      return { kind: 'bot_level', code: error.code };
    }
    // 429s and 5xx-class API errors are retryable infrastructure states.
    return { kind: 'transient', cause: `discord-${String(error.code)}` };
  }

  if (error instanceof Error) {
    const errno = (error as NodeJS.ErrnoException).code;
    if (typeof errno === 'string' && errno.startsWith('E')) {
      return { kind: 'transient', cause: errno };
    }
    return { kind: 'transient', cause: error.name };
  }

  return { kind: 'transient', cause: 'unknown' };
}

/** Ledger error-code string for a classified failure (fits VarChar(50)). */
export function dmErrorCode(classified: DmErrorClass): string {
  // permanent + bot_level both carry a numeric code; only transient carries a cause.
  return classified.kind === 'transient' ? classified.cause.slice(0, 50) : String(classified.code);
}
