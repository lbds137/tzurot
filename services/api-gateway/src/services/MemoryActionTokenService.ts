/**
 * MemoryActionTokenService
 *
 * Issues and consumes short-lived Redis tokens that bind a destructive memory
 * operation's preview to its execute call:
 *
 *   - `PreviewToken` — issued by `POST /user/memory/delete/preview`. The token
 *     value stores the filter (personality, persona, timeframe) that produced
 *     the preview summary. `POST /user/memory/delete` consumes the token and
 *     re-applies the SAME filter — eliminating drift between what the user
 *     saw and what gets deleted.
 *
 *   - `PurgeToken` — issued by `POST /user/memory/purge/token` after the user
 *     types the confirmation phrase. The token value stores the personalityId
 *     binding. `POST /user/memory/purge` consumes the token and purges that
 *     personality's memories.
 *
 * Tokens are namespaced by Discord user ID — token-stealing across users is
 * cut off at the lookup-key boundary (a stolen token won't match another
 * user's prefix). Consumption uses an atomic GETDEL so a token can only be
 * redeemed once.
 *
 * TTL is 5 minutes — long enough for confirmation-modal UX, short enough that
 * stale tokens don't accumulate.
 */

import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import {
  createLogger,
  REDIS_KEY_PREFIXES,
  type BatchDeletePreviewInput,
} from '@tzurot/common-types';

const logger = createLogger('MemoryActionTokenService');

/** Token TTL in seconds. 5 minutes covers confirmation-modal UX comfortably. */
const TOKEN_TTL_SECONDS = 5 * 60;

/** Length of the random suffix following the `preview_` / `purge_` prefix. */
const TOKEN_RANDOM_BYTES = 16;

interface PreviewTokenPayload {
  readonly filter: BatchDeletePreviewInput;
  readonly issuedAt: string;
}

interface PurgeTokenPayload {
  readonly personalityId: string;
  readonly issuedAt: string;
}

function buildPreviewKey(userId: string, token: string): string {
  return `${REDIS_KEY_PREFIXES.MEMORY_PREVIEW_TOKEN}${userId}:${token}`;
}

function buildPurgeKey(userId: string, token: string): string {
  return `${REDIS_KEY_PREFIXES.MEMORY_PURGE_TOKEN}${userId}:${token}`;
}

/**
 * Mint a random token. Uses URL-safe base64 to match the regex enforced by
 * `PreviewTokenSchema` / `PurgeTokenSchema` (`[A-Za-z0-9_-]{16,64}`).
 */
function mintTokenValue(prefix: 'preview' | 'purge'): string {
  const suffix = randomBytes(TOKEN_RANDOM_BYTES).toString('base64url');
  return `${prefix}_${suffix}`;
}

export class MemoryActionTokenService {
  constructor(private readonly redis: Redis) {}

  /**
   * Issue a preview token bound to the given filter for the given user.
   * Returns the token string (caller serializes it into the preview response).
   */
  async issuePreviewToken(userId: string, filter: BatchDeletePreviewInput): Promise<string> {
    const token = mintTokenValue('preview');
    const key = buildPreviewKey(userId, token);
    const payload: PreviewTokenPayload = {
      filter,
      issuedAt: new Date().toISOString(),
    };
    await this.redis.setex(key, TOKEN_TTL_SECONDS, JSON.stringify(payload));
    logger.debug({ userId, token: `${token.substring(0, 12)}…` }, 'Preview token issued');
    return token;
  }

  /**
   * Atomically read and delete a preview token. Returns the bound filter, or
   * null if the token is invalid, expired, or has already been consumed.
   *
   * `getdel` is a single Redis op — no race between an attacker brute-forcing
   * tokens and a legitimate consume.
   */
  async consumePreviewToken(
    userId: string,
    token: string
  ): Promise<BatchDeletePreviewInput | null> {
    const key = buildPreviewKey(userId, token);
    const raw = await this.redis.getdel(key);
    if (raw === null) {
      logger.debug({ userId, token: `${token.substring(0, 12)}…` }, 'Preview token miss');
      return null;
    }
    try {
      const payload = JSON.parse(raw) as PreviewTokenPayload;
      return payload.filter;
    } catch (error) {
      logger.warn({ err: error, userId }, 'Failed to parse preview token payload');
      return null;
    }
  }

  /**
   * Issue a purge token bound to a specific (user, personality) pair. The
   * caller is responsible for verifying the confirmation phrase BEFORE
   * calling this — possession of a purge token is the destructive operation's
   * final gate.
   */
  async issuePurgeToken(userId: string, personalityId: string): Promise<string> {
    const token = mintTokenValue('purge');
    const key = buildPurgeKey(userId, token);
    const payload: PurgeTokenPayload = {
      personalityId,
      issuedAt: new Date().toISOString(),
    };
    await this.redis.setex(key, TOKEN_TTL_SECONDS, JSON.stringify(payload));
    logger.info(
      { userId, personalityId, token: `${token.substring(0, 12)}…` },
      'Purge token issued'
    );
    return token;
  }

  /**
   * Atomically read and delete a purge token. Returns the bound personality
   * ID, or null if the token is invalid, expired, or has already been
   * consumed.
   */
  async consumePurgeToken(
    userId: string,
    token: string
  ): Promise<{ personalityId: string } | null> {
    const key = buildPurgeKey(userId, token);
    const raw = await this.redis.getdel(key);
    if (raw === null) {
      logger.debug({ userId, token: `${token.substring(0, 12)}…` }, 'Purge token miss');
      return null;
    }
    try {
      const payload = JSON.parse(raw) as PurgeTokenPayload;
      return { personalityId: payload.personalityId };
    } catch (error) {
      logger.warn({ err: error, userId }, 'Failed to parse purge token payload');
      return null;
    }
  }
}
