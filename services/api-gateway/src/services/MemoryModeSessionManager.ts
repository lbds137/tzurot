/**
 * MemoryModeSessionManager
 *
 * Manages memory-mode sessions (incognito, fresh) in Redis with TTL-based
 * expiration. The two modes share identical session mechanics and differ only
 * in which memory gate they close — incognito blocks WRITES, fresh blocks
 * READS — so one manager serves both, parameterized by key prefix.
 *
 * Key pattern: {prefix}{userId}:{personalityId|all}
 *
 * Features:
 * - Enable/disable a mode for a specific personality or all
 * - Auto-expiration via Redis TTL (30m, 1h, 4h, or forever)
 * - Check if a mode is active for a user/personality combo
 * - List all active sessions for a user
 */

import type { Redis } from 'ioredis';
import { REDIS_KEY_PREFIXES } from '@tzurot/common-types/constants/queue';
import {
  type MemoryModeSession,
  type MemoryModeDuration,
  type MemoryModeStatusResponse,
  MEMORY_MODE_DURATIONS,
  MemoryModeSessionSchema,
} from '@tzurot/common-types/types/memory-modes';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('MemoryModeSessionManager');

/** The two session-backed memory modes and their Redis key prefixes. */
export const MEMORY_MODE_PREFIXES = {
  incognito: REDIS_KEY_PREFIXES.INCOGNITO,
  fresh: REDIS_KEY_PREFIXES.FRESH,
} as const;

export type MemoryMode = keyof typeof MEMORY_MODE_PREFIXES;

/**
 * Calculate TTL in seconds from duration
 * Returns null for 'forever' (no expiration)
 */
function getTtlSeconds(duration: MemoryModeDuration): number | null {
  const ms = MEMORY_MODE_DURATIONS[duration];
  if (ms === null) {
    return null; // 'forever' - no TTL
  }
  return Math.floor(ms / 1000);
}

export class MemoryModeSessionManager {
  private readonly prefix: string;

  constructor(
    private redis: Redis,
    private readonly mode: MemoryMode
  ) {
    this.prefix = MEMORY_MODE_PREFIXES[mode];
  }

  /** Build the Redis key for a session */
  private buildKey(userId: string, personalityId: string): string {
    return `${this.prefix}${userId}:${personalityId}`;
  }

  /**
   * Scan for keys matching a pattern without blocking Redis
   *
   * Unlike KEYS which blocks the server, SCAN uses a cursor to iterate
   * incrementally. Each iteration only blocks for a few milliseconds.
   *
   * @param pattern - Redis key pattern (e.g., "incognito:123:*")
   * @returns Array of matching keys
   */
  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';

    do {
      // SCAN returns [nextCursor, keys[]]
      const [nextCursor, batch] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== '0');

    return keys;
  }

  /**
   * Enable the mode for a user/personality combination
   *
   * @param userId - Discord user ID (or internal user ID)
   * @param personalityId - Personality ID or 'all' for a global session
   * @param duration - How long the session should last
   * @returns The created session
   */
  async enable(
    userId: string,
    personalityId: string,
    duration: MemoryModeDuration
  ): Promise<MemoryModeSession> {
    const key = this.buildKey(userId, personalityId);
    const now = new Date();

    const ttlMs = MEMORY_MODE_DURATIONS[duration];
    const expiresAt = ttlMs !== null ? new Date(now.getTime() + ttlMs).toISOString() : null;

    const session: MemoryModeSession = {
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
        mode: this.mode,
        userId,
        personalityId,
        duration,
        expiresAt,
        key,
      },
      'Session enabled'
    );

    return session;
  }

  /**
   * Disable the mode for a user/personality combination
   *
   * @param userId - Discord user ID
   * @param personalityId - Personality ID or 'all'
   * @returns true if session was disabled, false if it didn't exist
   */
  async disable(userId: string, personalityId: string): Promise<boolean> {
    const key = this.buildKey(userId, personalityId);
    const deleted = await this.redis.del(key);

    const wasActive = deleted > 0;
    logger.info(
      { mode: this.mode, userId, personalityId, wasActive },
      `Session ${wasActive ? 'disabled' : 'not found'}`
    );

    return wasActive;
  }

  /**
   * Get the session for a specific user/personality
   *
   * @param userId - Discord user ID
   * @param personalityId - Personality ID or 'all'
   * @returns The session if active, null otherwise
   */
  async getSession(userId: string, personalityId: string): Promise<MemoryModeSession | null> {
    const key = this.buildKey(userId, personalityId);
    const data = await this.redis.get(key);

    if (data === null) {
      return null;
    }

    try {
      const parsed = JSON.parse(data) as unknown;
      // Trust Redis TTL for expiration - if the key exists, the session is active
      return MemoryModeSessionSchema.parse(parsed);
    } catch (error) {
      logger.warn({ err: error, key }, 'Failed to parse session data');
      // Invalid data - clean it up
      await this.redis.del(key);
      return null;
    }
  }

  /**
   * Check if the mode is active for a user interacting with a personality.
   * Checks both the specific personality and 'all' (global session).
   *
   * @param userId - Discord user ID
   * @param personalityId - Personality ID being interacted with
   * @returns true if the mode is active (either specific or global)
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
   * Get the active session that applies to a user/personality interaction.
   * Returns the specific session if it exists, otherwise the global session.
   *
   * @param userId - Discord user ID
   * @param personalityId - Personality ID being interacted with
   * @returns The applicable session if any
   */
  async getActiveSession(userId: string, personalityId: string): Promise<MemoryModeSession | null> {
    // Specific takes precedence over global
    const specificSession = await this.getSession(userId, personalityId);
    if (specificSession !== null) {
      return specificSession;
    }

    return this.getSession(userId, 'all');
  }

  /**
   * Maximum number of sessions to fetch per user (bounded query)
   * A user realistically has at most a few sessions (specific personalities + 'all')
   */
  private static readonly MAX_SESSIONS_PER_USER = 100;

  /**
   * Get all active sessions of this mode for a user
   *
   * @param userId - Discord user ID
   * @returns Status with all active sessions
   */
  async getStatus(userId: string): Promise<MemoryModeStatusResponse> {
    const pattern = `${this.prefix}${userId}:*`;
    const allKeys = await this.scanKeys(pattern);

    if (allKeys.length === 0) {
      return { active: false, sessions: [] };
    }

    // Bound the query to prevent memory issues from malicious key creation
    const keys = allKeys.slice(0, MemoryModeSessionManager.MAX_SESSIONS_PER_USER);
    if (allKeys.length > MemoryModeSessionManager.MAX_SESSIONS_PER_USER) {
      logger.warn(
        { mode: this.mode, userId, total: allKeys.length, fetched: keys.length },
        'User has excessive sessions - truncating'
      );
    }

    const sessions: MemoryModeSession[] = [];

    // Fetch sessions in parallel (bounded)
    const values = await this.redis.mget(keys);

    for (const value of values) {
      if (value !== null) {
        try {
          const parsed = JSON.parse(value) as unknown;
          const validated = MemoryModeSessionSchema.parse(parsed);
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
   * Disable all sessions of this mode for a user
   *
   * @param userId - Discord user ID
   * @returns Number of sessions that were disabled
   */
  async disableAll(userId: string): Promise<number> {
    const pattern = `${this.prefix}${userId}:*`;
    const allKeys = await this.scanKeys(pattern);

    if (allKeys.length === 0) {
      return 0;
    }

    // Bound the deletion to prevent issues from malicious key creation
    const keys = allKeys.slice(0, MemoryModeSessionManager.MAX_SESSIONS_PER_USER);
    if (allKeys.length > MemoryModeSessionManager.MAX_SESSIONS_PER_USER) {
      logger.warn(
        { mode: this.mode, userId, total: allKeys.length, deleting: keys.length },
        'User has excessive sessions - only deleting first batch'
      );
    }

    const deleted = await this.redis.del(...keys);
    logger.info({ mode: this.mode, userId, count: deleted }, 'All sessions disabled');

    return deleted;
  }

  /**
   * Get time remaining for a session in human-readable format
   *
   * @param session - The memory-mode session
   * @returns Human-readable time remaining, or the manual-disable sentinel
   */
  getTimeRemaining(session: MemoryModeSession): string {
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
