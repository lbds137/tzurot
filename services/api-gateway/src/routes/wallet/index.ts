/**
 * Wallet Routes
 * API endpoints for BYOK (Bring Your Own Key) management
 *
 * Endpoints:
 * - POST /wallet/set - Store encrypted API key
 * - GET /wallet/list - List configured providers
 * - DELETE /wallet/:provider - Remove API key
 * - POST /wallet/test - Test API key validity
 *
 * Security:
 * - Rate limited to prevent brute force attacks and DoS
 * - 10 requests per 15 minute window per user
 * - Uses Redis-backed rate limiting for horizontal scaling
 */

import { Router } from 'express';
import type { Redis } from 'ioredis';
import type { PrismaClient, ApiKeyCacheInvalidationService } from '@tzurot/common-types';
import { createSetKeyRoute } from './setKey.js';
import { createListKeysRoute } from './listKeys.js';
import { createRemoveKeyRoute } from './removeKey.js';
import { createTestKeyRoute } from './testKey.js';
import { createRedisWalletRateLimiter } from '../../utils/RedisRateLimiter.js';

/**
 * Create wallet router with injected dependencies
 * @param prisma - Database client
 * @param redis - Redis client for rate limiting
 * @param apiKeyCacheInvalidation - Optional service for publishing cache invalidation events
 */
export function createWalletRouter(
  prisma: PrismaClient,
  redis: Redis,
  apiKeyCacheInvalidation?: ApiKeyCacheInvalidationService
): Router {
  const router = Router();

  // Apply rate limiting to all wallet operations
  // Uses Redis for distributed rate limiting (enables horizontal scaling)
  // Prevents brute force attacks and DoS via external API calls
  router.use(createRedisWalletRateLimiter(redis));

  // Set API key
  router.use('/set', createSetKeyRoute(prisma, apiKeyCacheInvalidation));

  // List API keys
  router.use('/list', createListKeysRoute(prisma));

  // Test API key
  router.use('/test', createTestKeyRoute(prisma));

  // Remove API key (parameterized route)
  router.delete('/:provider', ...createRemoveKeyRoute(prisma, apiKeyCacheInvalidation));

  return router;
}
