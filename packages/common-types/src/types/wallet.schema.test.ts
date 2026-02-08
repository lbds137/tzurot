/**
 * Wallet API Contract Tests
 *
 * Validates schemas for /wallet endpoints.
 */

import { describe, it, expect } from 'vitest';
import {
  WalletKeySchema,
  ListWalletKeysResponseSchema,
  RemoveWalletKeyResponseSchema,
  TestWalletKeyResponseSchema,
} from '../schemas/api/index.js';

/** Helper to create valid wallet key data */
function createValidWalletKey(overrides = {}) {
  return {
    provider: 'openrouter',
    isActive: true,
    createdAt: '2025-01-15T12:00:00.000Z',
    lastUsedAt: '2025-01-20T15:30:00.000Z',
    ...overrides,
  };
}

describe('Wallet API Contract Tests', () => {
  describe('WalletKeySchema', () => {
    it('should accept valid wallet key', () => {
      const data = createValidWalletKey();
      const result = WalletKeySchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept wallet key with null lastUsedAt', () => {
      const data = createValidWalletKey({ lastUsedAt: null });
      const result = WalletKeySchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept inactive wallet key', () => {
      const data = createValidWalletKey({ isActive: false });
      const result = WalletKeySchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject invalid provider', () => {
      const data = createValidWalletKey({ provider: 'invalid-provider' });
      const result = WalletKeySchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject missing required fields', () => {
      const result = WalletKeySchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('ListWalletKeysResponseSchema', () => {
    it('should accept response with keys', () => {
      const data = {
        keys: [createValidWalletKey()],
        timestamp: '2025-01-20T15:30:00.000Z',
      };
      const result = ListWalletKeysResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept empty keys array', () => {
      const data = {
        keys: [],
        timestamp: '2025-01-20T15:30:00.000Z',
      };
      const result = ListWalletKeysResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject missing timestamp', () => {
      const data = { keys: [] };
      const result = ListWalletKeysResponseSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject missing keys field', () => {
      const data = { timestamp: '2025-01-20T15:30:00.000Z' };
      const result = ListWalletKeysResponseSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('RemoveWalletKeyResponseSchema', () => {
    it('should accept valid remove response', () => {
      const data = {
        success: true as const,
        provider: 'openrouter',
        message: 'API key removed successfully',
        timestamp: '2025-01-20T15:30:00.000Z',
      };
      const result = RemoveWalletKeyResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject success=false', () => {
      const data = {
        success: false,
        provider: 'openrouter',
        message: 'failed',
        timestamp: '2025-01-20T15:30:00.000Z',
      };
      const result = RemoveWalletKeyResponseSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject invalid provider', () => {
      const data = {
        success: true as const,
        provider: 'invalid',
        message: 'removed',
        timestamp: '2025-01-20T15:30:00.000Z',
      };
      const result = RemoveWalletKeyResponseSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject missing message', () => {
      const data = {
        success: true as const,
        provider: 'openrouter',
        timestamp: '2025-01-20T15:30:00.000Z',
      };
      const result = RemoveWalletKeyResponseSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('TestWalletKeyResponseSchema', () => {
    it('should accept valid test response for valid key', () => {
      const data = {
        valid: true,
        provider: 'openrouter',
        credits: 10.5,
        timestamp: '2025-01-20T15:30:00.000Z',
      };
      const result = TestWalletKeyResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept valid test response for invalid key', () => {
      const data = {
        valid: false,
        provider: 'openrouter',
        error: 'Invalid API key',
        timestamp: '2025-01-20T15:30:00.000Z',
      };
      const result = TestWalletKeyResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept response without optional credits and error', () => {
      const data = {
        valid: true,
        provider: 'openrouter',
        timestamp: '2025-01-20T15:30:00.000Z',
      };
      const result = TestWalletKeyResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject invalid provider', () => {
      const data = {
        valid: true,
        provider: 'invalid',
        timestamp: '2025-01-20T15:30:00.000Z',
      };
      const result = TestWalletKeyResponseSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject missing valid field', () => {
      const data = {
        provider: 'openrouter',
        timestamp: '2025-01-20T15:30:00.000Z',
      };
      const result = TestWalletKeyResponseSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });
});
