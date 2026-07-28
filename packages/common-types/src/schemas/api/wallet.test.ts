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
  SetWalletKeyResponseSchema,
  SetWalletKeySchema,
  TestWalletKeySchema,
  WalletKeyValidationErrorCodeSchema,
} from './wallet.js';

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

  describe('WalletKeyValidationErrorCodeSchema', () => {
    it.each(['INVALID_KEY', 'MISSING_PERMISSIONS', 'QUOTA_EXCEEDED', 'TIMEOUT', 'UNKNOWN'])(
      'should accept the validator vocabulary member %s',
      code => {
        expect(WalletKeyValidationErrorCodeSchema.safeParse(code).success).toBe(true);
      }
    );

    it('should reject values outside the vocabulary', () => {
      expect(WalletKeyValidationErrorCodeSchema.safeParse('RATE_LIMITED').success).toBe(false);
      expect(WalletKeyValidationErrorCodeSchema.safeParse('').success).toBe(false);
      expect(WalletKeyValidationErrorCodeSchema.safeParse(undefined).success).toBe(false);
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

    it('should carry errorCode through parsing (strip-mode survival)', () => {
      // The generated client parses responses through this schema in strip
      // mode — an undeclared field would be silently deleted, and bot-client's
      // transient-vs-invalid branch reads errorCode. Pin its survival here.
      const data = {
        valid: false,
        provider: 'openrouter',
        error: 'HTTP 503',
        errorCode: 'UNKNOWN',
        timestamp: '2025-01-20T15:30:00.000Z',
      };
      const result = TestWalletKeyResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.errorCode).toBe('UNKNOWN');
      }
    });

    it('should reject an errorCode outside the validator vocabulary', () => {
      const data = {
        valid: false,
        provider: 'openrouter',
        errorCode: 'SOMETHING_ELSE',
        timestamp: '2025-01-20T15:30:00.000Z',
      };
      const result = TestWalletKeyResponseSchema.safeParse(data);
      expect(result.success).toBe(false);
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

  // ================================================================
  // Input Schema Tests
  // ================================================================

  describe('SetWalletKeySchema', () => {
    it('should accept valid input', () => {
      const result = SetWalletKeySchema.safeParse({
        provider: 'openrouter',
        apiKey: 'sk-test-12345',
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid provider', () => {
      const result = SetWalletKeySchema.safeParse({
        provider: 'invalid-provider',
        apiKey: 'sk-test-12345',
      });
      expect(result.success).toBe(false);
    });

    it('should trim whitespace from apiKey', () => {
      const result = SetWalletKeySchema.safeParse({
        provider: 'openrouter',
        apiKey: '  sk-test-12345  \n',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.apiKey).toBe('sk-test-12345');
      }
    });

    it('should reject empty apiKey', () => {
      const result = SetWalletKeySchema.safeParse({
        provider: 'openrouter',
        apiKey: '',
      });
      expect(result.success).toBe(false);
    });

    it('should reject whitespace-only apiKey', () => {
      const result = SetWalletKeySchema.safeParse({
        provider: 'openrouter',
        apiKey: '   \n',
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing provider', () => {
      const result = SetWalletKeySchema.safeParse({ apiKey: 'sk-test' });
      expect(result.success).toBe(false);
    });

    it('should reject missing apiKey', () => {
      const result = SetWalletKeySchema.safeParse({ provider: 'openrouter' });
      expect(result.success).toBe(false);
    });
  });

  describe('TestWalletKeySchema', () => {
    it('should accept valid provider', () => {
      const result = TestWalletKeySchema.safeParse({ provider: 'openrouter' });
      expect(result.success).toBe(true);
    });

    it('should reject invalid provider', () => {
      const result = TestWalletKeySchema.safeParse({ provider: 'invalid' });
      expect(result.success).toBe(false);
    });

    it('should reject missing provider', () => {
      const result = TestWalletKeySchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('SetWalletKeyResponseSchema', () => {
    it('should accept a successful set response', () => {
      const result = SetWalletKeyResponseSchema.safeParse({
        success: true,
        provider: 'openrouter',
        credits: 12.5,
        timestamp: '2026-05-25T00:00:00.000Z',
      });
      expect(result.success).toBe(true);
    });

    it('should accept a response without credits (provider does not expose them)', () => {
      const result = SetWalletKeyResponseSchema.safeParse({
        success: true,
        provider: 'elevenlabs',
        timestamp: '2026-05-25T00:00:00.000Z',
      });
      expect(result.success).toBe(true);
    });

    it('should reject success=false', () => {
      const result = SetWalletKeyResponseSchema.safeParse({
        success: false,
        provider: 'openrouter',
        timestamp: '2026-05-25T00:00:00.000Z',
      });
      expect(result.success).toBe(false);
    });
  });
});
