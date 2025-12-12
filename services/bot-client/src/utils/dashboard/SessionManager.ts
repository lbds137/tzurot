/**
 * Dashboard Session Manager
 *
 * Tracks active dashboard editing sessions per user.
 * Sessions auto-expire after inactivity.
 */

import { type DashboardSession } from './types.js';

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
 * Default session timeout (15 minutes)
 */
const DEFAULT_SESSION_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Cleanup interval (5 minutes)
 */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Session Manager for dashboard interactions
 *
 * Uses a Map for in-memory storage. For horizontal scaling,
 * this could be replaced with Redis-backed storage.
 */
export class DashboardSessionManager {
  private sessions = new Map<string, DashboardSession<unknown>>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private readonly timeoutMs: number;

  constructor(timeoutMs: number = DEFAULT_SESSION_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
  }

  /**
   * Start the cleanup interval
   */
  startCleanup(): void {
    if (this.cleanupInterval !== null) {
      return;
    }

    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, CLEANUP_INTERVAL_MS);
  }

  /**
   * Stop the cleanup interval
   */
  stopCleanup(): void {
    if (this.cleanupInterval !== null) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Generate session key from user ID and entity type
   */
  private getSessionKey(userId: string, entityType: string, entityId: string): string {
    return `${userId}:${entityType}:${entityId}`;
  }

  /**
   * Create or update a session
   */
  set<T>(options: SetSessionOptions<T>): DashboardSession<T> {
    const { userId, entityType, entityId, data, messageId, channelId } = options;
    const key = this.getSessionKey(userId, entityType, entityId);
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

    this.sessions.set(key, session as DashboardSession<unknown>);
    return session;
  }

  /**
   * Get a session
   */
  get<T>(userId: string, entityType: string, entityId: string): DashboardSession<T> | null {
    const key = this.getSessionKey(userId, entityType, entityId);
    const session = this.sessions.get(key);

    if (!session) {
      return null;
    }

    // Check if expired
    const now = Date.now();
    const lastActivity = session.lastActivityAt.getTime();
    if (now - lastActivity > this.timeoutMs) {
      this.sessions.delete(key);
      return null;
    }

    return session as DashboardSession<T>;
  }

  /**
   * Update session data and activity timestamp
   */
  update<T>(
    userId: string,
    entityType: string,
    entityId: string,
    data: Partial<T>
  ): DashboardSession<T> | null {
    const session = this.get<T>(userId, entityType, entityId);
    if (!session) {
      return null;
    }

    // Update data and timestamp
    session.data = { ...session.data, ...data };
    session.lastActivityAt = new Date();

    const key = this.getSessionKey(userId, entityType, entityId);
    this.sessions.set(key, session as DashboardSession<unknown>);

    return session;
  }

  /**
   * Touch session (update activity timestamp only)
   */
  touch(userId: string, entityType: string, entityId: string): boolean {
    const session = this.get(userId, entityType, entityId);
    if (!session) {
      return false;
    }

    session.lastActivityAt = new Date();
    const key = this.getSessionKey(userId, entityType, entityId);
    this.sessions.set(key, session);
    return true;
  }

  /**
   * Delete a session
   */
  delete(userId: string, entityType: string, entityId: string): boolean {
    const key = this.getSessionKey(userId, entityType, entityId);
    return this.sessions.delete(key);
  }

  /**
   * Find session by message ID (for interaction handling)
   */
  findByMessageId<T>(messageId: string): DashboardSession<T> | null {
    for (const session of this.sessions.values()) {
      if (session.messageId === messageId) {
        // Check expiry
        const now = Date.now();
        const lastActivity = session.lastActivityAt.getTime();
        if (now - lastActivity > this.timeoutMs) {
          this.sessions.delete(
            this.getSessionKey(session.userId, session.entityType, session.entityId)
          );
          return null;
        }
        return session as DashboardSession<T>;
      }
    }
    return null;
  }

  /**
   * Get all active sessions for a user
   */
  getUserSessions(userId: string): DashboardSession<unknown>[] {
    const userSessions: DashboardSession<unknown>[] = [];
    const now = Date.now();

    for (const [key, session] of this.sessions.entries()) {
      if (session.userId !== userId) {
        continue;
      }

      // Check expiry
      const lastActivity = session.lastActivityAt.getTime();
      if (now - lastActivity > this.timeoutMs) {
        this.sessions.delete(key);
        continue;
      }

      userSessions.push(session);
    }

    return userSessions;
  }

  /**
   * Clean up expired sessions
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, session] of this.sessions.entries()) {
      const lastActivity = session.lastActivityAt.getTime();
      if (now - lastActivity > this.timeoutMs) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      this.sessions.delete(key);
    }
  }

  /**
   * Get session count (for monitoring)
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Clear all sessions (for testing)
   */
  clear(): void {
    this.sessions.clear();
  }
}

/**
 * Singleton instance for the application
 */
let sessionManagerInstance: DashboardSessionManager | null = null;

/**
 * Get the singleton session manager instance
 */
export function getSessionManager(): DashboardSessionManager {
  if (sessionManagerInstance === null) {
    sessionManagerInstance = new DashboardSessionManager();
    sessionManagerInstance.startCleanup();
  }
  return sessionManagerInstance;
}

/**
 * Shutdown the session manager (for graceful shutdown)
 */
export function shutdownSessionManager(): void {
  if (sessionManagerInstance !== null) {
    sessionManagerInstance.stopCleanup();
    sessionManagerInstance.clear();
    sessionManagerInstance = null;
  }
}
