/**
 * Request Deduplication Cache Singleton
 *
 * Provides a singleton instance of the RequestDeduplicationCache
 * for use across the application.
 */

import { RequestDeduplicationCache } from './RequestDeduplicationCache.js';

// Singleton instance
export const deduplicationCache = new RequestDeduplicationCache();
