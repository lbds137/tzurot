/**
 * Request Deduplication Cache
 *
 * Prevents duplicate AI requests by caching recent requests and returning
 * the same job ID for identical requests within a short time window.
 *
 * Class-based implementation with proper lifecycle management to prevent
 * memory leaks and improve testability.
 */

import { createHash } from 'node:crypto';
import { createLogger, INTERVALS } from '@tzurot/common-types';
import type { GenerateRequest, CachedRequest } from '../types.js';

const logger = createLogger('RequestDeduplication');

export interface RequestDeduplicationOptions {
  /**
   * Time window (ms) for duplicate detection
   * @default INTERVALS.REQUEST_DEDUP_WINDOW (5000ms)
   */
  duplicateWindowMs?: number;

  /**
   * Cleanup interval (ms) for removing expired entries
   * @default INTERVALS.REQUEST_DEDUP_CLEANUP (60000ms)
   */
  cleanupIntervalMs?: number;
}

/**
 * Request Deduplication Cache with automatic cleanup
 *
 * Example usage:
 * ```typescript
 * const cache = new RequestDeduplicationCache();
 *
 * // Check for duplicates
 * const cached = cache.checkDuplicate(request);
 * if (cached) {
 *   return cached.jobId;
 * }
 *
 * // Cache new request
 * cache.cacheRequest(request, requestId, jobId);
 *
 * // Cleanup when shutting down
 * cache.dispose();
 * ```
 */
export class RequestDeduplicationCache {
  private cache = new Map<string, CachedRequest>();
  private cleanupTimer: NodeJS.Timeout | undefined;
  private readonly duplicateWindowMs: number;
  private readonly cleanupIntervalMs: number;

  constructor(options: RequestDeduplicationOptions = {}) {
    this.duplicateWindowMs = options.duplicateWindowMs ?? INTERVALS.REQUEST_DEDUP_WINDOW;
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? INTERVALS.REQUEST_DEDUP_CLEANUP;

    // Start automatic cleanup
    this.startCleanup();
  }

  /**
   * Check if a request is a duplicate and return cached job if so
   * @returns Cached request if duplicate found, null otherwise
   */
  checkDuplicate(request: GenerateRequest): CachedRequest | null {
    const hash = this.hashRequest(request);
    const cached = this.cache.get(hash);

    if (cached === undefined) {
      return null;
    }

    const now = Date.now();

    // Check if cache entry is still valid
    if (now > cached.expiresAt) {
      this.cache.delete(hash);
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
  cacheRequest(request: GenerateRequest, requestId: string, jobId: string): void {
    const hash = this.hashRequest(request);
    const now = Date.now();

    this.cache.set(hash, {
      requestId,
      jobId,
      timestamp: now,
      expiresAt: now + this.duplicateWindowMs,
    });

    logger.debug(`[Deduplication] Cached request ${requestId} with job ${jobId}`);
  }

  /**
   * Get current cache size (for monitoring)
   */
  getCacheSize(): number {
    return this.cache.size;
  }

  /**
   * Clean up resources and stop background cleanup
   * Call this when shutting down the service
   */
  dispose(): void {
    this.stopCleanup();
    this.cache.clear();
  }

  /**
   * Create a hash for a request to detect duplicates
   * Uses SHA-256 for stable, collision-resistant hashing
   */
  private hashRequest(request: GenerateRequest): string {
    const { personality, message, context } = request;

    // Create hash from key components
    const personalityName = personality.name;
    const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
    const contextStr = `${context.userId}-${context.channelId ?? 'dm'}`;

    // Create stable hash using SHA-256 for the entire message
    // This prevents false positives from substring sampling
    const messageHash = createHash('sha256')
      .update(messageStr)
      .digest('hex')
      .substring(0, 16); // Take first 16 chars for brevity

    return `${personalityName}:${contextStr}:${messageHash}`;
  }

  /**
   * Start the cleanup interval
   */
  private startCleanup(): void {
    if (this.cleanupTimer !== undefined) {
      return; // Already started
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredRequests();
    }, this.cleanupIntervalMs);

    // Allow Node.js to exit even with active interval
    this.cleanupTimer.unref();
  }

  /**
   * Stop the cleanup interval
   */
  private stopCleanup(): void {
    if (this.cleanupTimer !== undefined) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  /**
   * Clean up expired cache entries
   */
  private cleanupExpiredRequests(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [hash, cached] of this.cache.entries()) {
      if (now > cached.expiresAt) {
        this.cache.delete(hash);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.debug(`[Deduplication] Cleaned up ${cleanedCount} expired cache entries`);
    }
  }
}
