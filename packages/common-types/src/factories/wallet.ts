/**
 * Validated Mock Factories for Wallet API Responses
 *
 * These factories create mock data that is VALIDATED against the Zod schemas.
 * If a test tries to mock an invalid shape, it will CRASH immediately.
 *
 * Usage in tests:
 *   import { mockListWalletKeysResponse } from '@tzurot/common-types/factories';
 *
 *   mockCallGatewayApi.mockResolvedValue({
 *     ok: true,
 *     data: mockListWalletKeysResponse([{ provider: AIProvider.OPENROUTER }]),
 *   });
 */

import { AIProvider } from '../constants/ai.js';
import {
  ListWalletKeysResponseSchema,
  RemoveWalletKeyResponseSchema,
  TestWalletKeyResponseSchema,
  type ListWalletKeysResponse,
  type RemoveWalletKeyResponse,
  type TestWalletKeyResponse,
  type WalletKey,
} from '../schemas/api/wallet.js';

import { type DeepPartial, deepMerge } from './factoryUtils.js';

// ============================================================================
// Helper Functions
// ============================================================================

/** Create a base wallet key object */
function createBaseWalletKey(overrides?: DeepPartial<WalletKey>): WalletKey {
  const now = new Date().toISOString();
  const base: WalletKey = {
    provider: AIProvider.OpenRouter,
    isActive: true,
    createdAt: now,
    lastUsedAt: null,
  };
  return deepMerge(base, overrides);
}

// ============================================================================
// List Wallet Keys (GET /wallet/list)
// ============================================================================

/**
 * Create a validated mock for GET /wallet/list
 * @throws ZodError if the resulting mock doesn't match the schema
 */
export function mockListWalletKeysResponse(
  keys?: DeepPartial<WalletKey>[]
): ListWalletKeysResponse {
  const defaultList = [createBaseWalletKey()];

  return ListWalletKeysResponseSchema.parse({
    keys: keys?.map(k => createBaseWalletKey(k)) ?? defaultList,
    timestamp: new Date().toISOString(),
  });
}

// ============================================================================
// Remove Wallet Key (DELETE /wallet/:provider)
// ============================================================================

/**
 * Create a validated mock for DELETE /wallet/:provider
 * @throws ZodError if the resulting mock doesn't match the schema
 */
export function mockRemoveWalletKeyResponse(
  overrides?: DeepPartial<RemoveWalletKeyResponse>
): RemoveWalletKeyResponse {
  const base: RemoveWalletKeyResponse = {
    success: true,
    provider: AIProvider.OpenRouter,
    message: `API key for ${AIProvider.OpenRouter} has been removed`,
    timestamp: new Date().toISOString(),
  };
  return RemoveWalletKeyResponseSchema.parse(deepMerge(base, overrides));
}

// ============================================================================
// Test Wallet Key (POST /wallet/test)
// ============================================================================

/**
 * Create a validated mock for POST /wallet/test (successful)
 * @throws ZodError if the resulting mock doesn't match the schema
 */
export function mockTestWalletKeyResponse(
  overrides?: DeepPartial<TestWalletKeyResponse>
): TestWalletKeyResponse {
  const base: TestWalletKeyResponse = {
    valid: true,
    provider: AIProvider.OpenRouter,
    timestamp: new Date().toISOString(),
  };
  return TestWalletKeyResponseSchema.parse(deepMerge(base, overrides));
}
