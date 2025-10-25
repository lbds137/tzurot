/**
 * Redis connection utilities
 * Shared across all services that use Redis
 */

import { createLogger } from './logger.js';

const logger = createLogger('RedisUtils');

export interface RedisConnectionConfig {
  host: string;
  port: number;
  password?: string;
  username?: string;
}

/**
 * Parse Railway's REDIS_URL format into connection config
 *
 * Railway provides REDIS_URL like: redis://default:password@host:port
 *
 * @param url Redis connection URL
 * @returns Connection config object
 */
export function parseRedisUrl(url: string): RedisConnectionConfig {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port || '6379', 10),
      password: parsed.password || undefined,
      // Railway uses 'default' as placeholder username - filter it out
      username: parsed.username && parsed.username !== 'default' ? parsed.username : undefined
    };
  } catch (error) {
    logger.error({ err: error }, '[RedisUtils] Failed to parse REDIS_URL');
    // Fallback to localhost for local development
    return {
      host: 'localhost',
      port: 6379
    };
  }
}
