/**
 * Request Deduplication Manager
 *
 * Prevents duplicate AI requests by caching recent requests and returning
 * the same job ID for identical requests within a short time window.
 *
 * Based on patterns from tzurot v2 messageDeduplication.js and aiService.js
 */

import { createLogger } from '@tzurot/common-types';
import type { GenerateRequest, CachedRequest } from '../types.js';

const logger = createLogger('RequestDeduplication');

// Cache to track recent requests
const requestCache = new Map<string, CachedRequest>();

// Time window for duplicate detection (5 seconds)
const DUPLICATE_DETECTION_WINDOW = 5000;

// Cleanup interval (10 seconds)
const CLEANUP_INTERVAL = 10000;

// Start cleanup timer
let cleanupTimer: NodeJS.Timeout | undefined;

/**
 * Start the cleanup interval
 */
export function startCleanup(): void {
  if (cleanupTimer !== undefined) {
    return; // Already started
  }

  cleanupTimer = setInterval(() => {
    cleanupExpiredRequests();
  }, CLEANUP_INTERVAL);

  // Allow Node.js to exit even with active interval
  cleanupTimer.unref();
}

/**
 * Stop the cleanup interval
 */
export function stopCleanup(): void {
  if (cleanupTimer !== undefined) {
    clearInterval(cleanupTimer);
    cleanupTimer = undefined;
  }
}

/**
 * Create a hash for a request to detect duplicates
 */
function hashRequest(request: GenerateRequest): string {
  const {
    personality,
    message,
    context
  } = request;

  // Create hash from key components
  const personalityName = personality.name;
  const messageStr = typeof message === 'string'
    ? message
    : JSON.stringify(message);
  const contextStr = `${context.userId}-${context.channelId ?? 'dm'}`;

  // For longer messages, sample start/middle/end like v2
  const messageLength = messageStr.length;
  let messageHash: string;

  if (messageLength > 100) {
    const start = messageStr.substring(0, 30).replace(/\s+/g, '');
    const middle = messageStr
      .substring(Math.floor(messageLength / 2), Math.floor(messageLength / 2) + 20)
      .replace(/\s+/g, '');
    const end = messageStr.substring(messageLength - 20).replace(/\s+/g, '');
    messageHash = `${start}_${middle}_${end}_${messageLength}`;
  } else {
    messageHash = messageStr.replace(/\s+/g, '');
  }

  return `${personalityName}:${contextStr}:${messageHash}`;
}

/**
 * Check if a request is a duplicate and return cached job if so
 */
export function checkDuplicate(request: GenerateRequest): CachedRequest | null {
  const hash = hashRequest(request);
  const cached = requestCache.get(hash);

  if (cached === undefined) {
    return null;
  }

  const now = Date.now();

  // Check if cache entry is still valid
  if (now > cached.expiresAt) {
    requestCache.delete(hash);
    return null;
  }

  const timeSinceRequest = now - cached.timestamp;
  logger.info(
    `[Deduplication] Found duplicate request, returning cached job ${cached.jobId} (${timeSinceRequest}ms ago)`
  );

  return cached;
}

/**
 * Cache a request to prevent duplicates
 */
export function cacheRequest(
  request: GenerateRequest,
  requestId: string,
  jobId: string
): void {
  const hash = hashRequest(request);
  const now = Date.now();

  requestCache.set(hash, {
    requestId,
    jobId,
    timestamp: now,
    expiresAt: now + DUPLICATE_DETECTION_WINDOW
  });

  logger.debug(
    `[Deduplication] Cached request ${requestId} with job ${jobId}`
  );
}

/**
 * Clean up expired cache entries
 */
function cleanupExpiredRequests(): void {
  const now = Date.now();
  let cleanedCount = 0;

  for (const [hash, cached] of requestCache.entries()) {
    if (now > cached.expiresAt) {
      requestCache.delete(hash);
      cleanedCount++;
    }
  }

  if (cleanedCount > 0) {
    logger.debug(`[Deduplication] Cleaned up ${cleanedCount} expired cache entries`);
  }
}

/**
 * Get current cache size (for monitoring)
 */
export function getCacheSize(): number {
  return requestCache.size;
}
