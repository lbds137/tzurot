/**
 * Simple in-memory Redis client mock
 * Implements the minimal ioredis Redis interface needed for testing
 *
 * Uses ioredis (unified Redis client for all services - BullMQ requires it anyway)
 */

import type { Redis } from 'ioredis';

class RedisClientMock {
  private store = new Map<string, { value: string; expiresAt?: number }>();
  private timers = new Map<string, NodeJS.Timeout>();

  async connect(): Promise<void> {
    // No-op for mock
  }

  disconnect(): void {
    // Clear all timers
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.store.clear();
  }

  quit(): Promise<string> {
    this.disconnect();
    return Promise.resolve('OK');
  }

  ping(): Promise<string> {
    return Promise.resolve('PONG');
  }

  set(key: string, value: string): Promise<string | null> {
    this.store.set(key, { value });
    return Promise.resolve('OK');
  }

  get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) {
      return Promise.resolve(null);
    }

    // Check if expired
    if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return Promise.resolve(null);
    }

    return Promise.resolve(entry.value);
  }

  // ioredis uses lowercase method names
  setex(key: string, seconds: number, value: string): Promise<string | null> {
    const expiresAt = Date.now() + seconds * 1000;
    this.store.set(key, { value, expiresAt });

    // Set up automatic expiration
    const timer = setTimeout(() => {
      this.store.delete(key);
      this.timers.delete(key);
    }, seconds * 1000);

    this.timers.set(key, timer);

    return Promise.resolve('OK');
  }

  del(key: string | string[]): Promise<number> {
    const keys = Array.isArray(key) ? key : [key];
    let deleted = 0;

    for (const k of keys) {
      if (this.store.has(k)) {
        this.store.delete(k);
        deleted++;

        // Clear timer if exists
        const timer = this.timers.get(k);
        if (timer) {
          clearTimeout(timer);
          this.timers.delete(k);
        }
      }
    }

    return Promise.resolve(deleted);
  }

  /**
   * Pub/sub publish — cache-invalidation services fire-and-forget events.
   * The mock has no subscriber side; returns 0 receivers like a real Redis
   * with nobody listening.
   */
  publish(_channel: string, _message: string): Promise<number> {
    return Promise.resolve(0);
  }

  /** Hash read — observability endpoints read counters; empty hash when unset. */
  hgetall(_key: string): Promise<Record<string, string>> {
    return Promise.resolve({});
  }

  /** Atomic GET + DEL — used by single-use token consumption (GETDEL). */
  async getdel(key: string): Promise<string | null> {
    const value = await this.get(key);
    if (value !== null) {
      await this.del(key);
    }
    return value;
  }

  /**
   * Cursor-based key iteration. The mock store is small enough to return
   * everything in one pass: always responds with cursor '0' (scan complete)
   * plus the keys matching the MATCH pattern, mirroring ioredis's
   * `scan(cursor, 'MATCH', pattern, 'COUNT', n)` argument shape.
   */
  scan(_cursor: string, ...args: (string | number)[]): Promise<[string, string[]]> {
    const matchIndex = args.findIndex(a => String(a).toUpperCase() === 'MATCH');
    const pattern = matchIndex >= 0 ? String(args[matchIndex + 1]) : '*';
    // Glob → RegExp: escape regex metachars, then widen glob tokens.
    const regex = new RegExp(
      `^${pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.')}$`
    );

    const now = Date.now();
    const keys: string[] = [];
    for (const [key, entry] of this.store) {
      if (entry.expiresAt !== undefined && now > entry.expiresAt) {
        continue;
      }
      if (regex.test(key)) {
        keys.push(key);
      }
    }
    return Promise.resolve(['0', keys]);
  }

  // Add any other methods needed by the services
  // This is a minimal implementation
}

/**
 * Create an ioredis Redis-compatible mock
 */
export function createRedisClientMock(): Redis {
  return new RedisClientMock() as unknown as Redis;
}
