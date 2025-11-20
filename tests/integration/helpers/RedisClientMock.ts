/**
 * Simple in-memory Redis client mock
 * Implements the minimal RedisClientType interface needed for testing
 */

import type { RedisClientType } from 'redis';

export class RedisClientMock {
  private store = new Map<string, { value: string; expiresAt?: number }>();
  private timers = new Map<string, NodeJS.Timeout>();

  async connect(): Promise<void> {
    // No-op for mock
  }

  async disconnect(): Promise<void> {
    // Clear all timers
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.store.clear();
  }

  async quit(): Promise<void> {
    await this.disconnect();
  }

  async ping(): Promise<string> {
    return 'PONG';
  }

  async set(key: string, value: string): Promise<string | null> {
    this.store.set(key, { value });
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }

    // Check if expired
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    return entry.value;
  }

  async setEx(key: string, seconds: number, value: string): Promise<string | null> {
    const expiresAt = Date.now() + seconds * 1000;
    this.store.set(key, { value, expiresAt });

    // Set up automatic expiration
    const timer = setTimeout(() => {
      this.store.delete(key);
      this.timers.delete(key);
    }, seconds * 1000);

    this.timers.set(key, timer);

    return 'OK';
  }

  async del(key: string | string[]): Promise<number> {
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

    return deleted;
  }

  // Add any other methods needed by the services
  // This is a minimal implementation
}

/**
 * Create a RedisClientType-compatible mock
 */
export function createRedisClientMock(): RedisClientType {
  return new RedisClientMock() as unknown as RedisClientType;
}
