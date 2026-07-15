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
 *
 * Requires Redis 6.2+ — GETDEL was added in 6.2 and is the load-bearing
 * atomicity guarantee for replay prevention. Railway ships Redis 7.x, so
 * production is fine; local dev via Docker should pin redis:7-alpine or
 * later. (Older Redis would silently degrade to a non-atomic GET+DEL race.)
 */

import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import { REDIS_KEY_PREFIXES } from '@tzurot/common-types/constants/queue';
import { type BatchDeletePreviewInput } from '@tzurot/common-types/schemas/api/memory';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('MemoryActionTokenService');

/** Token TTL in seconds. 5 minutes covers confirmation-modal UX comfortably. */
const TOKEN_TTL_SECONDS = 5 * 60;

/**
 * Length of the random suffix following the `preview_` / `purge_` prefix.
 * 16 bytes encoded as base64url produces 22 characters (no padding), which
 * satisfies the brand regex `[A-Za-z0-9_-]{16,64}` with room to spare.
 */
const TOKEN_RANDOM_BYTES = 16;

interface PreviewTokenPayload {
  readonly filter: BatchDeletePreviewInput;
  /** Informational only — Redis TTL is the authoritative expiry gate. */
  readonly issuedAt: string;
}

interface PurgeTokenPayload {
  readonly personalityId: string;
  /** Informational only — Redis TTL is the authoritative expiry gate. */
  readonly issuedAt: string;
}

function buildPreviewKey(userId: string, token: string): string {
  return `${REDIS_KEY_PREFIXES.MEMORY_PREVIEW_TOKEN}${userId}:${token}`;
}

function buildPurgeKey(userId: string, token: string): string {
  return `${REDIS_KEY_PREFIXES.MEMORY_PURGE_TOKEN}${userId}:${token}`;
}

function buildAccountDeleteKey(userId: string, token: string): string {
  return `${REDIS_KEY_PREFIXES.ACCOUNT_DELETE_TOKEN}${userId}:${token}`;
}

/**
 * Mint a random token. Uses URL-safe base64 to match the regex enforced by
 * `PreviewTokenSchema` / `PurgeTokenSchema` / `AccountDeleteTokenSchema`
 * (`[A-Za-z0-9_-]{16,64}`).
 */
function mintTokenValue(prefix: 'preview' | 'purge' | 'acctdel'): string {
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
   * Non-destructively read a preview token. Use this when you want to
   * validate preconditions (e.g., the bound personality still exists)
   * before committing to consuming the token — failed validation should
   * NOT burn the user's one-shot redemption.
   *
   * The 5-min TTL bounds the impact of a peek without consume. Once
   * preconditions are validated, follow up with `consumePreviewToken`
   * to atomically claim it.
   *
   * Tiny race window: peek → validation → consume can race against a
   * concurrent consume by the same user (e.g., double-click on confirm).
   * Both attempts succeed at the peek-and-validate step; the destructive
   * op below them is idempotent (soft-delete of already-deleted rows is
   * a no-op), so the race is benign in practice.
   */
  async peekPreviewToken(userId: string, token: string): Promise<BatchDeletePreviewInput | null> {
    const key = buildPreviewKey(userId, token);
    const raw = await this.redis.get(key);
    if (raw === null) {
      logger.debug({ userId, token: `${token.substring(0, 12)}…` }, 'Preview token peek miss');
      return null;
    }
    try {
      const payload = JSON.parse(raw) as PreviewTokenPayload;
      return payload.filter;
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to parse preview token payload on peek');
      return null;
    }
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
      logger.error({ err: error, userId }, 'Failed to parse preview token payload');
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
   * Non-destructively read a purge token. See `peekPreviewToken` for the
   * full rationale — same trade-off (avoids burning a token on a 404
   * personality lookup) and same benign race in the peek → consume window.
   */
  async peekPurgeToken(userId: string, token: string): Promise<{ personalityId: string } | null> {
    const key = buildPurgeKey(userId, token);
    const raw = await this.redis.get(key);
    if (raw === null) {
      logger.debug({ userId, token: `${token.substring(0, 12)}…` }, 'Purge token peek miss');
      return null;
    }
    try {
      const payload = JSON.parse(raw) as PurgeTokenPayload;
      return { personalityId: payload.personalityId };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to parse purge token payload on peek');
      return null;
    }
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
      logger.error({ err: error, userId }, 'Failed to parse purge token payload');
      return null;
    }
  }

  /**
   * Issue an account-deletion token for the given Discord user. The caller
   * validates the confirmation phrase BEFORE calling this. No payload
   * binding beyond issuedAt — the deletion target is the key's own user.
   */
  async issueAccountDeleteToken(userId: string): Promise<string> {
    const token = mintTokenValue('acctdel');
    const key = buildAccountDeleteKey(userId, token);
    await this.redis.setex(
      key,
      TOKEN_TTL_SECONDS,
      JSON.stringify({ issuedAt: new Date().toISOString() })
    );
    logger.info({ userId, token: `${token.substring(0, 12)}…` }, 'Account delete token issued');
    return token;
  }

  /**
   * Non-destructively check an account-deletion token. Same peek-validate-
   * consume rationale as `peekPreviewToken` — precondition failures (e.g.
   * the superuser guard) must not burn the one-shot redemption.
   */
  async peekAccountDeleteToken(userId: string, token: string): Promise<boolean> {
    const raw = await this.redis.get(buildAccountDeleteKey(userId, token));
    if (raw === null) {
      logger.debug(
        { userId, token: `${token.substring(0, 12)}…` },
        'Account delete token peek miss'
      );
    }
    return raw !== null;
  }

  /**
   * Atomically claim an account-deletion token. Returns true when this call
   * consumed it; false if invalid, expired, or already consumed.
   */
  async consumeAccountDeleteToken(userId: string, token: string): Promise<boolean> {
    const raw = await this.redis.getdel(buildAccountDeleteKey(userId, token));
    if (raw === null) {
      logger.debug({ userId, token: `${token.substring(0, 12)}…` }, 'Account delete token miss');
    }
    return raw !== null;
  }
}
