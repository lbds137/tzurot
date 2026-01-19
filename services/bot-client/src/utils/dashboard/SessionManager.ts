/**
 * Dashboard Session Manager (Redis-backed)
 *
 * Tracks active dashboard editing sessions per user using Redis.
 * Sessions auto-expire via Redis TTL (no manual cleanup needed).
 *
 * Key patterns:
 * - session:{userId}:{entityType}:{entityId} - Session data
 * - session-msg:{messageId} - Secondary index for O(1) messageId lookups
 */

import type { Redis } from 'ioredis';
import { createLogger, REDIS_KEY_PREFIXES } from '@tzurot/common-types';
import { type DashboardSession, StoredSessionSchema, type StoredSession } from './types.js';

const logger = createLogger('DashboardSessionManager');

/**
 * Options for creating or updating a session
 */
export interface SetSessionOptions<T> {
  /** User ID */
  userId: string;
  /** Entity type (e.g., 'character', 'profile') */
  entityType: string;
  /** Entity ID */
  entityId: string;
  /** Session data */
  data: T;
  /** Discord message ID */
  messageId: string;
  /** Discord channel ID */
  channelId: string;
}

/**
 * Default session timeout (15 minutes in seconds for Redis)
 */
const DEFAULT_SESSION_TTL_SECONDS = 15 * 60;

/**
 * Maximum sessions per user (bounded query protection)
 */
const MAX_SESSIONS_PER_USER = 100;

/**
 * Build Redis key for session data
 */
function buildSessionKey(userId: string, entityType: string, entityId: string): string {
  return `${REDIS_KEY_PREFIXES.SESSION}${userId}:${entityType}:${entityId}`;
}

/**
 * Build Redis key for messageId secondary index
 */
function buildMessageIndexKey(messageId: string): string {
  return `${REDIS_KEY_PREFIXES.SESSION_MSG_INDEX}${messageId}`;
}

/**
 * Convert stored session (ISO strings) to DashboardSession (Date objects)
 */
function toSession<T>(stored: StoredSession): DashboardSession<T> {
  return {
    entityType: stored.entityType,
    entityId: stored.entityId,
    userId: stored.userId,
    data: stored.data as T,
    messageId: stored.messageId,
    channelId: stored.channelId,
    createdAt: new Date(stored.createdAt),
    lastActivityAt: new Date(stored.lastActivityAt),
  };
}

/**
 * Convert DashboardSession to storable format (ISO strings)
 */
function toStorable<T>(session: DashboardSession<T>): StoredSession {
  return {
    entityType: session.entityType,
    entityId: session.entityId,
    userId: session.userId,
    data: session.data,
    messageId: session.messageId,
    channelId: session.channelId,
    createdAt: session.createdAt.toISOString(),
    lastActivityAt: session.lastActivityAt.toISOString(),
  };
}

/**
 * Session Manager for dashboard interactions (Redis-backed)
 *
 * Uses Redis with SETEX for automatic TTL-based expiration.
 * Maintains a secondary index for O(1) messageId lookups.
 */
export class DashboardSessionManager {
  private readonly ttlSeconds: number;

  constructor(
    private redis: Redis,
    ttlSeconds: number = DEFAULT_SESSION_TTL_SECONDS
  ) {
    this.ttlSeconds = ttlSeconds;
  }

  /**
   * Scan for keys matching a pattern using cursor-based iteration
   *
   * Unlike KEYS which blocks the server, SCAN uses a cursor to iterate
   * incrementally. Each iteration only blocks for a few milliseconds.
   */
  private async scanKeys(pattern: string, maxKeys: number): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';

    do {
      const [nextCursor, batch] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      keys.push(...batch);

      // Stop if we've hit the limit
      if (keys.length >= maxKeys) {
        return keys.slice(0, maxKeys);
      }
    } while (cursor !== '0');

    return keys;
  }

  /**
   * Create or update a session
   *
   * Sets both the session data and the messageId index with the same TTL.
   */
  async set<T>(options: SetSessionOptions<T>): Promise<DashboardSession<T>> {
    const { userId, entityType, entityId, data, messageId, channelId } = options;
    const sessionKey = buildSessionKey(userId, entityType, entityId);
    const msgIndexKey = buildMessageIndexKey(messageId);
    const now = new Date();

    const session: DashboardSession<T> = {
      entityType,
      entityId,
      userId,
      data,
      messageId,
      channelId,
      createdAt: now,
      lastActivityAt: now,
    };

    const storable = toStorable(session);

    try {
      // Use pipeline for atomic operation
      const pipeline = this.redis.pipeline();
      pipeline.setex(sessionKey, this.ttlSeconds, JSON.stringify(storable));
      pipeline.setex(msgIndexKey, this.ttlSeconds, sessionKey);
      await pipeline.exec();

      logger.debug(
        { userId, entityType, entityId, messageId, ttl: this.ttlSeconds },
        '[Session] Created session'
      );
    } catch (error) {
      logger.error({ error, userId, entityType, entityId }, '[Session] Failed to create session');
      // Fail-open: return the session anyway (it just won't persist)
    }

    return session;
  }

  /**
   * Get a session
   *
   * Returns null if session doesn't exist (Redis handles expiration via TTL).
   */
  async get<T>(
    userId: string,
    entityType: string,
    entityId: string
  ): Promise<DashboardSession<T> | null> {
    const sessionKey = buildSessionKey(userId, entityType, entityId);

    try {
      const data = await this.redis.get(sessionKey);
      if (data === null) {
        return null;
      }

      const parsed = JSON.parse(data) as unknown;
      const validated = StoredSessionSchema.parse(parsed);
      return toSession<T>(validated);
    } catch (error) {
      if (error instanceof SyntaxError || (error as Error).name === 'ZodError') {
        // Corrupt data - clean it up
        logger.warn({ error, sessionKey }, '[Session] Corrupt session data, cleaning up');
        await this.redis.del(sessionKey).catch(() => {
          // Ignore cleanup failure
        });
      } else {
        logger.error({ error, sessionKey }, '[Session] Failed to get session');
      }
      return null;
    }
  }

  /**
   * Update session data and activity timestamp
   *
   * Re-sets the session with fresh TTL (extends lifetime).
   */
  async update<T>(
    userId: string,
    entityType: string,
    entityId: string,
    data: Partial<T>
  ): Promise<DashboardSession<T> | null> {
    const session = await this.get<T>(userId, entityType, entityId);
    if (session === null) {
      return null;
    }

    // Merge data and update timestamp
    session.data = { ...session.data, ...data };
    session.lastActivityAt = new Date();

    const sessionKey = buildSessionKey(userId, entityType, entityId);
    const storable = toStorable(session);

    try {
      // Re-set with fresh TTL
      await this.redis.setex(sessionKey, this.ttlSeconds, JSON.stringify(storable));
      // Also refresh the message index TTL
      const msgIndexKey = buildMessageIndexKey(session.messageId);
      await this.redis.expire(msgIndexKey, this.ttlSeconds);

      logger.debug({ userId, entityType, entityId }, '[Session] Updated session');
    } catch (error) {
      logger.error({ error, userId, entityType, entityId }, '[Session] Failed to update session');
      // Return the updated session anyway (fail-open)
    }

    return session;
  }

  /**
   * Touch session (update activity timestamp and refresh TTL)
   *
   * Uses EXPIRE to reset TTL without re-writing the data.
   */
  async touch(userId: string, entityType: string, entityId: string): Promise<boolean> {
    const sessionKey = buildSessionKey(userId, entityType, entityId);

    try {
      // First check if the session exists and get its messageId for the index
      const data = await this.redis.get(sessionKey);
      if (data === null) {
        return false;
      }

      const parsed = JSON.parse(data) as unknown;
      const validated = StoredSessionSchema.parse(parsed);

      // Update lastActivityAt
      const updated: StoredSession = {
        ...validated,
        lastActivityAt: new Date().toISOString(),
      };

      // Re-set with fresh TTL
      const pipeline = this.redis.pipeline();
      pipeline.setex(sessionKey, this.ttlSeconds, JSON.stringify(updated));
      pipeline.expire(buildMessageIndexKey(validated.messageId), this.ttlSeconds);
      await pipeline.exec();

      logger.debug({ userId, entityType, entityId }, '[Session] Touched session');
      return true;
    } catch (error) {
      logger.error({ error, userId, entityType, entityId }, '[Session] Failed to touch session');
      return false;
    }
  }

  /**
   * Delete a session
   *
   * Deletes both the session data and the messageId index.
   */
  async delete(userId: string, entityType: string, entityId: string): Promise<boolean> {
    const sessionKey = buildSessionKey(userId, entityType, entityId);

    try {
      // First get the messageId to clean up the index
      const data = await this.redis.get(sessionKey);
      if (data === null) {
        return false;
      }

      const parsed = JSON.parse(data) as unknown;
      const validated = StoredSessionSchema.parse(parsed);
      const msgIndexKey = buildMessageIndexKey(validated.messageId);

      // Delete both keys
      const pipeline = this.redis.pipeline();
      pipeline.del(sessionKey);
      pipeline.del(msgIndexKey);
      const results = await pipeline.exec();

      // Check if session key was deleted (first result)
      const deleted = results !== null && results[0] !== null && (results[0][1] as number) > 0;

      logger.debug({ userId, entityType, entityId, deleted }, '[Session] Deleted session');
      return deleted;
    } catch (error) {
      logger.error({ error, userId, entityType, entityId }, '[Session] Failed to delete session');
      return false;
    }
  }

  /**
   * Find session by message ID (for interaction handling)
   *
   * Uses secondary index for O(1) lookup instead of scanning all sessions.
   */
  async findByMessageId<T>(messageId: string): Promise<DashboardSession<T> | null> {
    const msgIndexKey = buildMessageIndexKey(messageId);

    try {
      // Get session key from index
      const sessionKey = await this.redis.get(msgIndexKey);
      if (sessionKey === null) {
        return null;
      }

      // Get session data
      const data = await this.redis.get(sessionKey);
      if (data === null) {
        // Index orphan - clean it up
        await this.redis.del(msgIndexKey).catch(() => {
          // Ignore cleanup failure
        });
        return null;
      }

      const parsed = JSON.parse(data) as unknown;
      const validated = StoredSessionSchema.parse(parsed);
      return toSession<T>(validated);
    } catch (error) {
      if (error instanceof SyntaxError || (error as Error).name === 'ZodError') {
        logger.warn({ error, messageId }, '[Session] Corrupt session data from messageId lookup');
      } else {
        logger.error({ error, messageId }, '[Session] Failed to find session by messageId');
      }
      return null;
    }
  }

  /**
   * Get all active sessions for a user
   *
   * Uses SCAN with pattern matching (bounded to MAX_SESSIONS_PER_USER).
   */
  async getUserSessions(userId: string): Promise<DashboardSession<unknown>[]> {
    const pattern = `${REDIS_KEY_PREFIXES.SESSION}${userId}:*`;

    try {
      const keys = await this.scanKeys(pattern, MAX_SESSIONS_PER_USER);

      if (keys.length === 0) {
        return [];
      }

      // Fetch all sessions in parallel
      const values = await this.redis.mget(keys);
      const sessions: DashboardSession<unknown>[] = [];

      for (const value of values) {
        if (value !== null) {
          try {
            const parsed = JSON.parse(value) as unknown;
            const validated = StoredSessionSchema.parse(parsed);
            sessions.push(toSession(validated));
          } catch {
            // Skip invalid entries
          }
        }
      }

      return sessions;
    } catch (error) {
      logger.error({ error, userId }, '[Session] Failed to get user sessions');
      return [];
    }
  }

  /**
   * Get approximate session count
   *
   * Note: This requires scanning, which may not be perfectly accurate
   * in a distributed environment, but is suitable for monitoring.
   */
  async getSessionCount(): Promise<number> {
    try {
      const pattern = `${REDIS_KEY_PREFIXES.SESSION}*`;
      const keys = await this.scanKeys(pattern, 10000); // Reasonable upper bound
      return keys.length;
    } catch (error) {
      logger.error({ error }, '[Session] Failed to get session count');
      return 0;
    }
  }

  /**
   * Clear all sessions (for testing)
   *
   * Deletes all session and session-msg keys.
   */
  async clear(): Promise<void> {
    try {
      // Scan for session keys
      const sessionPattern = `${REDIS_KEY_PREFIXES.SESSION}*`;
      const sessionKeys = await this.scanKeys(sessionPattern, 10000);

      // Scan for message index keys
      const msgPattern = `${REDIS_KEY_PREFIXES.SESSION_MSG_INDEX}*`;
      const msgKeys = await this.scanKeys(msgPattern, 10000);

      const allKeys = [...sessionKeys, ...msgKeys];
      if (allKeys.length > 0) {
        await this.redis.del(...allKeys);
      }

      logger.debug({ count: allKeys.length }, '[Session] Cleared all sessions');
    } catch (error) {
      logger.error({ error }, '[Session] Failed to clear sessions');
    }
  }
}

/**
 * Singleton instance for the application
 */
let sessionManagerInstance: DashboardSessionManager | null = null;

/**
 * Initialize the session manager with a Redis client
 *
 * Must be called before getSessionManager().
 */
export function initSessionManager(redis: Redis): void {
  sessionManagerInstance = new DashboardSessionManager(redis);
  logger.info('[Session] Session manager initialized');
}

/**
 * Get the singleton session manager instance
 *
 * @throws Error if initSessionManager() hasn't been called
 */
export function getSessionManager(): DashboardSessionManager {
  if (sessionManagerInstance === null) {
    throw new Error('Session manager not initialized. Call initSessionManager(redis) first.');
  }
  return sessionManagerInstance;
}

/**
 * Check if session manager is initialized
 */
export function isSessionManagerInitialized(): boolean {
  return sessionManagerInstance !== null;
}

/**
 * Shutdown the session manager (for graceful shutdown)
 *
 * Note: Does NOT close the Redis connection (that's managed separately).
 */
export function shutdownSessionManager(): void {
  sessionManagerInstance = null;
  logger.info('[Session] Session manager shutdown');
}
