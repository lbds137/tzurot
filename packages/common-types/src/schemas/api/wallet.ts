/**
 * Zod schemas for /wallet API endpoints
 *
 * These schemas define the contract between api-gateway and bot-client.
 * BOTH services should import these to ensure type safety.
 *
 * Usage:
 * - Gateway: Use schema.parse(response) before sending
 * - Bot-client tests: Use factories from @tzurot/common-types/factories
 */

import { z } from 'zod';
import { AIProvider } from '../../constants/ai.js';

// ============================================================================
// Shared Sub-schemas
// ============================================================================

/** API provider enum as Zod schema */
const AIProviderSchema = z.nativeEnum(AIProvider);

/** Wallet key metadata (never includes actual key) */
export const WalletKeySchema = z.object({
  provider: AIProviderSchema,
  isActive: z.boolean(),
  createdAt: z.string(), // ISO date string
  lastUsedAt: z.string().nullable(), // ISO date string or null
});
export type WalletKey = z.infer<typeof WalletKeySchema>;

// ============================================================================
// GET /wallet/list
// Returns list of user's configured API keys (metadata only)
// ============================================================================

export const ListWalletKeysResponseSchema = z.object({
  keys: z.array(WalletKeySchema),
  timestamp: z.string(), // ISO date string
});
export type ListWalletKeysResponse = z.infer<typeof ListWalletKeysResponseSchema>;

// ============================================================================
// DELETE /wallet/:provider
// Removes an API key for a provider
// ============================================================================

export const RemoveWalletKeyResponseSchema = z.object({
  success: z.literal(true),
  provider: AIProviderSchema,
  message: z.string(),
  timestamp: z.string(), // ISO date string
});
export type RemoveWalletKeyResponse = z.infer<typeof RemoveWalletKeyResponseSchema>;

// ============================================================================
// POST /wallet/test
// Tests a stored API key's validity
// ============================================================================

export const TestWalletKeyResponseSchema = z.object({
  valid: z.boolean(),
  provider: AIProviderSchema,
  credits: z.number().optional(), // Available credits if valid and provider supports it
  error: z.string().optional(), // Error message if invalid
  timestamp: z.string(), // ISO date string
});
export type TestWalletKeyResponse = z.infer<typeof TestWalletKeyResponseSchema>;
