/**
 * Request Deduplication Manager
 *
 * Prevents duplicate AI requests by caching recent requests and returning
 * the same job ID for identical requests within a short time window.
 *
 * Based on patterns from tzurot v2 messageDeduplication.js and aiService.js
 */

import { createHash } from 'node:crypto';
import { createLogger, INTERVALS } from '@tzurot/common-types';
import type { GenerateRequest, CachedRequest } from '../types.js';

const logger = createLogger('RequestDeduplication');

// Cache to track recent requests
const requestCache = new Map<string, CachedRequest>();

// Time window for duplicate detection
const DUPLICATE_DETECTION_WINDOW = INTERVALS.REQUEST_DEDUP_WINDOW;

// Cleanup interval
const CLEANUP_INTERVAL = INTERVALS.REQUEST_DEDUP_CLEANUP;

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
 * Uses SHA-256 for stable, collision-resistant hashing
 */
function hashRequest(request: GenerateRequest): string {
  const { personality, message, context } = request;

  // Create hash from key components
  const personalityName = personality.name;
  const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
  const contextStr = `${context.userId}-${context.channelId ?? 'dm'}`;

  // Create stable hash using SHA-256 for the entire message
  // This prevents false positives from substring sampling
  const messageHash = createHash('sha256').update(messageStr).digest('hex').substring(0, 16); // Take first 16 chars for brevity

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
export function cacheRequest(request: GenerateRequest, requestId: string, jobId: string): void {
  const hash = hashRequest(request);
  const now = Date.now();

  requestCache.set(hash, {
    requestId,
    jobId,
    timestamp: now,
    expiresAt: now + DUPLICATE_DETECTION_WINDOW,
  });

  logger.debug(`[Deduplication] Cached request ${requestId} with job ${jobId}`);
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
