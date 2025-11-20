/**
 * Redis connection utilities
 * Shared across all services that use Redis
 */

import { createLogger } from './logger.js';
import { REDIS_CONNECTION, RETRY_CONFIG } from '../constants/index.js';

const logger = createLogger('RedisUtils');

export interface RedisConnectionConfig {
  host: string;
  port: number;
  password?: string;
  username?: string;
  family?: 4 | 6;
}

export interface RedisSocketConfig {
  socket: {
    host: string;
    port: number;
    family: 4 | 6;
    connectTimeout: number;
    commandTimeout: number;
    keepAlive: boolean;
    keepAliveInitialDelay: number;
    reconnectStrategy: (retries: number) => number | Error;
  };
  password?: string;
  username?: string;
  maxRetriesPerRequest: number;
  lazyConnect: boolean;
  enableReadyCheck: boolean;
}

export interface BullMQRedisConfig {
  host: string;
  port: number;
  password?: string;
  username?: string;
  family: 4 | 6;
  connectTimeout: number;
  commandTimeout: number;
  keepAlive: number;
  reconnectStrategy: (retries: number) => number | Error;
  maxRetriesPerRequest: number | null; // BullMQ requires null
  lazyConnect: boolean;
  enableReadyCheck: boolean;
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
      username: parsed.username && parsed.username !== 'default' ? parsed.username : undefined,
    };
  } catch (error) {
    logger.error({ err: error }, '[RedisUtils] Failed to parse REDIS_URL');

    // Only fallback to localhost in development
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Failed to parse REDIS_URL in production environment');
    }

    logger.warn({ err: error }, '[RedisUtils] Falling back to localhost (development only)');
    return {
      host: 'localhost',
      port: 6379,
    };
  }
}

/**
 * Create standardized Redis socket configuration with timeouts and reconnection strategy
 *
 * Used by direct redis clients (not BullMQ)
 *
 * @param config Basic Redis connection config
 * @returns Full socket configuration with timeouts
 */
export function createRedisSocketConfig(config: RedisConnectionConfig): RedisSocketConfig {
  return {
    socket: {
      host: config.host,
      port: config.port,
      // REQUIRED: Railway private network requires IPv6 (family: 6) for internal service communication
      // IPv4 (family: 4) is NOT supported for Railway private networking
      // See: https://docs.railway.app/reference/private-networking
      family: config.family ?? 6,
      connectTimeout: REDIS_CONNECTION.CONNECT_TIMEOUT,
      commandTimeout: REDIS_CONNECTION.COMMAND_TIMEOUT,
      keepAlive: true, // Enable TCP keepalive
      keepAliveInitialDelay: REDIS_CONNECTION.KEEPALIVE,
      reconnectStrategy: (retries: number) => {
        if (retries > RETRY_CONFIG.REDIS_MAX_RETRIES) {
          // After max retries (30+ seconds), give up
          logger.error({}, '[RedisUtils] Max reconnection attempts reached');
          return new Error('Max reconnection attempts reached');
        }
        // Exponential backoff: 100ms, 200ms, 400ms, ..., max 3s
        const delay = Math.min(
          retries * RETRY_CONFIG.REDIS_RETRY_MULTIPLIER,
          RETRY_CONFIG.REDIS_MAX_DELAY
        );
        logger.warn({ retries, delay }, '[RedisUtils] Reconnecting to Redis');
        return delay;
      },
    },
    password: config.password,
    username: config.username,
    maxRetriesPerRequest: RETRY_CONFIG.REDIS_RETRIES_PER_REQUEST,
    lazyConnect: false, // Connect immediately to fail fast
    enableReadyCheck: true, // Verify Redis is ready
  };
}

/**
 * Create standardized Redis configuration for BullMQ
 *
 * BullMQ uses IORedis format (flattened, not nested socket)
 *
 * IMPORTANT: BullMQ requires maxRetriesPerRequest to be null so it can manage
 * its own retry logic. Setting it to a number causes IORedis to give up and log
 * errors, even though BullMQ continues retrying in the background.
 *
 * @param config Basic Redis connection config
 * @returns BullMQ-compatible Redis configuration
 */
export function createBullMQRedisConfig(config: RedisConnectionConfig): BullMQRedisConfig {
  return {
    host: config.host,
    port: config.port,
    password: config.password,
    username: config.username,
    // REQUIRED: Railway private network requires IPv6 (family: 6) for internal service communication
    // IPv4 (family: 4) is NOT supported for Railway private networking
    // See: https://docs.railway.app/reference/private-networking
    family: config.family ?? 6,
    connectTimeout: REDIS_CONNECTION.CONNECT_TIMEOUT,
    commandTimeout: REDIS_CONNECTION.COMMAND_TIMEOUT,
    keepAlive: REDIS_CONNECTION.KEEPALIVE,
    reconnectStrategy: (retries: number) => {
      if (retries > RETRY_CONFIG.REDIS_MAX_RETRIES) {
        // After max retries (30+ seconds), give up
        logger.error({}, '[RedisUtils] Max reconnection attempts reached');
        return new Error('Max reconnection attempts reached');
      }
      // Exponential backoff: 100ms, 200ms, 400ms, ..., max 3s
      const delay = Math.min(
        retries * RETRY_CONFIG.REDIS_RETRY_MULTIPLIER,
        RETRY_CONFIG.REDIS_MAX_DELAY
      );
      logger.warn({ retries, delay }, '[RedisUtils] Reconnecting to Redis');
      return delay;
    },
    maxRetriesPerRequest: null, // BullMQ requires null - it manages its own retries
    lazyConnect: false, // Connect immediately to fail fast
    enableReadyCheck: true, // Verify Redis is ready
  };
}
