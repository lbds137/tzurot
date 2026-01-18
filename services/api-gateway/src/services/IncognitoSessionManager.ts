/**
 * IncognitoSessionManager
 *
 * Manages incognito mode sessions in Redis with TTL-based expiration.
 *
 * Incognito mode temporarily disables memory WRITING (not reading).
 * This is distinct from Focus Mode which disables memory READING.
 *
 * Key pattern: incognito:{userId}:{personalityId|all}
 *
 * Features:
 * - Enable/disable incognito for specific personality or all
 * - Auto-expiration via Redis TTL (30m, 1h, 4h, or forever)
 * - Check if incognito is active for a user/personality combo
 * - List all active sessions for a user
 */

import type { Redis } from 'ioredis';
import {
  createLogger,
  REDIS_KEY_PREFIXES,
  type IncognitoSession,
  type IncognitoDuration,
  type IncognitoStatusResponse,
  INCOGNITO_DURATIONS,
  IncognitoSessionSchema,
} from '@tzurot/common-types';

const logger = createLogger('IncognitoSessionManager');

/**
 * Build Redis key for incognito session
 */
function buildKey(userId: string, personalityId: string): string {
  return `${REDIS_KEY_PREFIXES.INCOGNITO}${userId}:${personalityId}`;
}

/**
 * Calculate TTL in seconds from duration
 * Returns null for 'forever' (no expiration)
 */
function getTtlSeconds(duration: IncognitoDuration): number | null {
  const ms = INCOGNITO_DURATIONS[duration];
  if (ms === null) {
    return null; // 'forever' - no TTL
  }
  return Math.floor(ms / 1000);
}

export class IncognitoSessionManager {
  constructor(private redis: Redis) {}

  /**
   * Enable incognito mode for a user/personality combination
   *
   * @param userId - Discord user ID (or internal user ID)
   * @param personalityId - Personality ID or 'all' for global incognito
   * @param duration - How long incognito should last
   * @returns The created session
   */
  async enable(
    userId: string,
    personalityId: string,
    duration: IncognitoDuration
  ): Promise<IncognitoSession> {
    const key = buildKey(userId, personalityId);
    const now = new Date();

    const ttlMs = INCOGNITO_DURATIONS[duration];
    const expiresAt = ttlMs !== null ? new Date(now.getTime() + ttlMs).toISOString() : null;

    const session: IncognitoSession = {
      userId,
      personalityId,
      enabledAt: now.toISOString(),
      expiresAt,
      duration,
    };

    const ttlSeconds = getTtlSeconds(duration);

    if (ttlSeconds !== null) {
      // Set with expiration
      await this.redis.setex(key, ttlSeconds, JSON.stringify(session));
    } else {
      // No expiration (forever)
      await this.redis.set(key, JSON.stringify(session));
    }

    logger.info(
      {
        userId,
        personalityId,
        duration,
        expiresAt,
        key,
      },
      '[Incognito] Session enabled'
    );

    return session;
  }

  /**
   * Disable incognito mode for a user/personality combination
   *
   * @param userId - Discord user ID
   * @param personalityId - Personality ID or 'all'
   * @returns true if session was disabled, false if it didn't exist
   */
  async disable(userId: string, personalityId: string): Promise<boolean> {
    const key = buildKey(userId, personalityId);
    const deleted = await this.redis.del(key);

    const wasActive = deleted > 0;
    logger.info(
      { userId, personalityId, wasActive },
      `[Incognito] Session ${wasActive ? 'disabled' : 'not found'}`
    );

    return wasActive;
  }

  /**
   * Get incognito session for a specific user/personality
   *
   * @param userId - Discord user ID
   * @param personalityId - Personality ID or 'all'
   * @returns The session if active, null otherwise
   */
  async getSession(userId: string, personalityId: string): Promise<IncognitoSession | null> {
    const key = buildKey(userId, personalityId);
    const data = await this.redis.get(key);

    if (data === null) {
      return null;
    }

    try {
      const parsed = JSON.parse(data) as unknown;
      const validated = IncognitoSessionSchema.parse(parsed);
      return validated;
    } catch (error) {
      logger.warn({ error, key }, '[Incognito] Failed to parse session data');
      // Invalid data - clean it up
      await this.redis.del(key);
      return null;
    }
  }

  /**
   * Check if incognito is active for a user interacting with a personality.
   * Checks both the specific personality and 'all' (global incognito).
   *
   * @param userId - Discord user ID
   * @param personalityId - Personality ID being interacted with
   * @returns true if incognito is active (either specific or global)
   */
  async isActive(userId: string, personalityId: string): Promise<boolean> {
    // Check both specific personality and global 'all' in parallel
    const [specificSession, globalSession] = await Promise.all([
      this.getSession(userId, personalityId),
      this.getSession(userId, 'all'),
    ]);

    return specificSession !== null || globalSession !== null;
  }

  /**
   * Get active session that applies to a user/personality interaction.
   * Returns the specific session if it exists, otherwise the global session.
   *
   * @param userId - Discord user ID
   * @param personalityId - Personality ID being interacted with
   * @returns The applicable session if any
   */
  async getActiveSession(userId: string, personalityId: string): Promise<IncognitoSession | null> {
    // Specific takes precedence over global
    const specificSession = await this.getSession(userId, personalityId);
    if (specificSession !== null) {
      return specificSession;
    }

    return this.getSession(userId, 'all');
  }

  /**
   * Get all active incognito sessions for a user
   *
   * @param userId - Discord user ID
   * @returns Status with all active sessions
   */
  async getStatus(userId: string): Promise<IncognitoStatusResponse> {
    const pattern = `${REDIS_KEY_PREFIXES.INCOGNITO}${userId}:*`;
    const keys = await this.redis.keys(pattern);

    if (keys.length === 0) {
      return { active: false, sessions: [] };
    }

    const sessions: IncognitoSession[] = [];

    // Fetch all sessions in parallel
    const values = await this.redis.mget(keys);

    for (const value of values) {
      if (value !== null) {
        try {
          const parsed = JSON.parse(value) as unknown;
          const validated = IncognitoSessionSchema.parse(parsed);
          sessions.push(validated);
        } catch {
          // Skip invalid entries
        }
      }
    }

    return {
      active: sessions.length > 0,
      sessions,
    };
  }

  /**
   * Disable all incognito sessions for a user
   *
   * @param userId - Discord user ID
   * @returns Number of sessions that were disabled
   */
  async disableAll(userId: string): Promise<number> {
    const pattern = `${REDIS_KEY_PREFIXES.INCOGNITO}${userId}:*`;
    const keys = await this.redis.keys(pattern);

    if (keys.length === 0) {
      return 0;
    }

    const deleted = await this.redis.del(...keys);
    logger.info({ userId, count: deleted }, '[Incognito] All sessions disabled');

    return deleted;
  }

  /**
   * Get time remaining for a session in human-readable format
   *
   * @param session - The incognito session
   * @returns Human-readable time remaining, or 'forever' if no expiration
   */
  getTimeRemaining(session: IncognitoSession): string {
    if (session.expiresAt === null) {
      return 'Until manually disabled';
    }

    const expiresAt = new Date(session.expiresAt);
    const now = new Date();
    const remainingMs = expiresAt.getTime() - now.getTime();

    if (remainingMs <= 0) {
      return 'Expired';
    }

    const minutes = Math.floor(remainingMs / (60 * 1000));
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    if (hours > 0) {
      return remainingMinutes > 0
        ? `${hours}h ${remainingMinutes}m remaining`
        : `${hours}h remaining`;
    }

    return `${minutes}m remaining`;
  }
}
