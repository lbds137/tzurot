/**
 * Redis connection utilities
 * Shared across all services that use Redis
 */

import { Redis as IORedis } from 'ioredis';
import type { Logger } from 'pino';
import { createLogger } from './logger.js';
import { getConfig } from '../config/index.js';
import { VoiceTranscriptCache } from '../services/VoiceTranscriptCache.js';
import { REDIS_CONNECTION } from '../constants/index.js';

const logger = createLogger('RedisUtils');

interface RedisConnectionConfig {
  host: string;
  port: number;
  password?: string;
  username?: string;
  family?: 0 | 4 | 6;
}

export interface BullMQRedisConfig {
  host: string;
  port: number;
  password?: string;
  username?: string;
  family: 0 | 4 | 6;
  connectTimeout: number;
  commandTimeout: number;
  keepAlive: number;
  maxRetriesPerRequest: number | null; // BullMQ requires null
  lazyConnect: boolean;
  enableReadyCheck: boolean;
}

/**
 * Resolve the IP family ioredis should dial with.
 *
 * Defaults to 6 (IPv6-only) because Railway's private network requires IPv6
 * for internal service-to-service communication — see
 * https://docs.railway.app/reference/private-networking. `REDIS_IP_FAMILY`
 * exists for IPv4-only dev hosts (e.g. a kernel with no IPv6 support), where
 * the default 6 makes a hostname-addressed Redis (`localhost`) unreachable; an
 * IP-literal host is dialed as-is, since Node ignores `family` for an IP address.
 *
 * Reads `process.env.REDIS_IP_FAMILY` directly at call time (not cached at
 * module load) so a test or a runtime env change is observed immediately.
 *
 * @returns 4 (IPv4-only), 6 (IPv6-only, the default), or 0 (OS picks via a
 *   dual-stack lookup)
 */
export function resolveRedisIpFamily(): 0 | 4 | 6 {
  const raw = process.env.REDIS_IP_FAMILY;
  if (raw === '4') {
    return 4;
  }
  if (raw === '6') {
    return 6;
  }
  if (raw === '0') {
    return 0;
  }
  return 6;
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
      throw new Error('Failed to parse REDIS_URL in production environment', { cause: error });
    }

    logger.warn({ err: error }, '[RedisUtils] Falling back to localhost (development only)');
    return {
      host: 'localhost',
      port: 6379,
    };
  }
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
    // Defaults to 6: Railway private networking requires IPv6. REDIS_IP_FAMILY
    // overrides this for IPv4-only dev hosts — see resolveRedisIpFamily.
    family: config.family ?? resolveRedisIpFamily(),
    connectTimeout: REDIS_CONNECTION.CONNECT_TIMEOUT,
    commandTimeout: REDIS_CONNECTION.COMMAND_TIMEOUT,
    keepAlive: REDIS_CONNECTION.KEEPALIVE,
    maxRetriesPerRequest: null, // BullMQ requires null - it manages its own retries
    lazyConnect: false, // Connect immediately to fail fast
    enableReadyCheck: true, // Verify Redis is ready
  };
}

/**
 * Create a standard IORedis client with logging and connection config.
 *
 * Uses BullMQ connection settings (timeouts, keepAlive) but retains default
 * maxRetriesPerRequest (20) for general Redis operations.
 * For BullMQ queues, use createBullMQRedisConfig directly (requires null).
 *
 * @param redisUrl - Redis connection URL (e.g., redis://default:password@host:port)
 * @param serviceName - Service name for log messages
 * @param serviceLogger - Pino logger instance
 * @returns Configured IORedis client
 */
export function createIORedisClient(
  redisUrl: string,
  serviceName: string,
  serviceLogger: Logger
): IORedis {
  const parsedUrl = parseRedisUrl(redisUrl);
  const ioredisConfig = createBullMQRedisConfig({
    host: parsedUrl.host,
    port: parsedUrl.port,
    password: parsedUrl.password,
    username: parsedUrl.username,
  });

  serviceLogger.info(
    {
      host: ioredisConfig.host,
      port: ioredisConfig.port,
      hasPassword: ioredisConfig.password !== undefined,
      connectTimeout: ioredisConfig.connectTimeout,
      commandTimeout: ioredisConfig.commandTimeout,
    },
    `[${serviceName}] Redis config (ioredis):`
  );

  const client = new IORedis({
    host: ioredisConfig.host,
    port: ioredisConfig.port,
    password: ioredisConfig.password,
    username: ioredisConfig.username,
    family: ioredisConfig.family,
    connectTimeout: ioredisConfig.connectTimeout,
    commandTimeout: ioredisConfig.commandTimeout,
    keepAlive: ioredisConfig.keepAlive,
    lazyConnect: ioredisConfig.lazyConnect,
    enableReadyCheck: ioredisConfig.enableReadyCheck,
    // Note: maxRetriesPerRequest is set to null for BullMQ queues, but we want
    // standard retries for general Redis operations. Leave as default (20).
    // No custom retryStrategy: ioredis's default unbounded retry with capped
    // exponential backoff is the deliberate choice for a long-running service —
    // a permanent give-up after N attempts is worse than self-healing
    // reconnection once the underlying Redis blip clears.
  });

  client.on('error', (error: Error) => {
    serviceLogger.error({ err: error, serviceName }, 'Redis client error');
  });
  client.on('connect', () => {
    serviceLogger.info({ serviceName }, 'Connected to Redis');
  });
  client.on('ready', () => {
    serviceLogger.info({ serviceName }, 'Redis client ready');
  });
  client.on('reconnecting', () => {
    serviceLogger.info({ serviceName }, 'Reconnecting to Redis');
  });

  return client;
}

/**
 * Core Redis services shared by all services (bot-client, ai-worker).
 * Each service wraps these with its own service-specific RedisService.
 */
export interface CoreRedisServices {
  redis: IORedis;
  voiceTranscriptCache: VoiceTranscriptCache;
}

/**
 * Initialize the core Redis services common to all services:
 * an IORedis client and a VoiceTranscriptCache instance.
 *
 * Each service adds its own extras (e.g., SessionManager, VisionDescriptionCache).
 *
 * @param serviceName - Label for log messages (defaults to 'Redis')
 * @returns Core Redis services
 * @throws Error if REDIS_URL is missing
 */
export function initCoreRedisServices(serviceName = 'Redis'): CoreRedisServices {
  const serviceLogger = createLogger(serviceName);
  const config = getConfig();

  if (config.REDIS_URL === undefined || config.REDIS_URL.length === 0) {
    throw new Error('REDIS_URL environment variable is required');
  }

  const redis = createIORedisClient(config.REDIS_URL, serviceName, serviceLogger);
  const voiceTranscriptCache = new VoiceTranscriptCache(redis);

  return { redis, voiceTranscriptCache };
}
