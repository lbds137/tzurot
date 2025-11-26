/**
 * Wallet Routes
 * API endpoints for BYOK (Bring Your Own Key) management
 *
 * Endpoints:
 * - POST /wallet/set - Store encrypted API key
 * - GET /wallet/list - List configured providers
 * - DELETE /wallet/:provider - Remove API key
 * - POST /wallet/test - Test API key validity
 */

import { Router } from 'express';
import type { PrismaClient } from '@tzurot/common-types';
import { createSetKeyRoute } from './setKey.js';
import { createListKeysRoute } from './listKeys.js';
import { createRemoveKeyRoute } from './removeKey.js';
import { createTestKeyRoute } from './testKey.js';

/**
 * Create wallet router with injected dependencies
 */
export function createWalletRouter(prisma: PrismaClient): Router {
  const router = Router();

  // Set API key
  router.use('/set', createSetKeyRoute(prisma));

  // List API keys
  router.use('/list', createListKeysRoute(prisma));

  // Test API key
  router.use('/test', createTestKeyRoute(prisma));

  // Remove API key (parameterized route)
  router.delete('/:provider', ...createRemoveKeyRoute(prisma));

  return router;
}
