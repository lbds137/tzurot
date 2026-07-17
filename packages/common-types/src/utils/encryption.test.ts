import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  encryptApiKey,
  decryptApiKey,
  encryptWithKey,
  decryptWithKey,
  parseEncryptionKeyMaterial,
  isValidEncryptedData,
  type EncryptedData,
} from './encryption.js';

describe('Encryption Utilities', () => {
  const VALID_MASTER_KEY = 'a'.repeat(64); // 32 bytes in hex
  const TEST_API_KEY = 'sk-test-1234567890abcdefghijklmnopqrstuvwxyz';

  beforeEach(() => {
    vi.stubEnv('API_KEY_ENCRYPTION_KEY', VALID_MASTER_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('encryptApiKey', () => {
    it('should encrypt an API key and return valid structure', () => {
      const encrypted = encryptApiKey(TEST_API_KEY);

      expect(encrypted).toHaveProperty('iv');
      expect(encrypted).toHaveProperty('content');
      expect(encrypted).toHaveProperty('tag');

      // IV should be 32 hex chars (16 bytes)
      expect(encrypted.iv).toHaveLength(32);
      expect(encrypted.iv).toMatch(/^[0-9a-f]+$/);

      // Tag should be 32 hex chars (16 bytes)
      expect(encrypted.tag).toHaveLength(32);
      expect(encrypted.tag).toMatch(/^[0-9a-f]+$/);

      // Content should be hex
      expect(encrypted.content).toMatch(/^[0-9a-f]+$/);
    });

    it('should produce different IVs for each encryption', () => {
      const encrypted1 = encryptApiKey(TEST_API_KEY);
      const encrypted2 = encryptApiKey(TEST_API_KEY);

      expect(encrypted1.iv).not.toBe(encrypted2.iv);
      expect(encrypted1.content).not.toBe(encrypted2.content);
      expect(encrypted1.tag).not.toBe(encrypted2.tag);
    });

    it('should encrypt empty string', () => {
      const encrypted = encryptApiKey('');

      expect(encrypted.iv).toHaveLength(32);
      expect(encrypted.tag).toHaveLength(32);
      expect(encrypted.content).toBeDefined();
    });

    it('should encrypt long API keys', () => {
      const longKey = 'x'.repeat(1000);
      const encrypted = encryptApiKey(longKey);

      expect(encrypted.iv).toHaveLength(32);
      expect(encrypted.tag).toHaveLength(32);
      expect(encrypted.content.length).toBeGreaterThan(0);
    });

    it('should throw if API_KEY_ENCRYPTION_KEY is missing', () => {
      vi.stubEnv('API_KEY_ENCRYPTION_KEY', '');

      expect(() => encryptApiKey(TEST_API_KEY)).toThrow(
        'API_KEY_ENCRYPTION_KEY environment variable is required'
      );
    });

    it('should throw if API_KEY_ENCRYPTION_KEY is too short', () => {
      vi.stubEnv('API_KEY_ENCRYPTION_KEY', 'a'.repeat(32)); // 16 bytes, need 32

      expect(() => encryptApiKey(TEST_API_KEY)).toThrow(
        'API_KEY_ENCRYPTION_KEY must be 64 hex characters'
      );
    });

    it('should throw if API_KEY_ENCRYPTION_KEY is too long', () => {
      vi.stubEnv('API_KEY_ENCRYPTION_KEY', 'a'.repeat(128));

      expect(() => encryptApiKey(TEST_API_KEY)).toThrow(
        'API_KEY_ENCRYPTION_KEY must be 64 hex characters'
      );
    });

    it('should throw if API_KEY_ENCRYPTION_KEY contains non-hex characters', () => {
      vi.stubEnv('API_KEY_ENCRYPTION_KEY', 'g'.repeat(64)); // 'g' is not hex

      expect(() => encryptApiKey(TEST_API_KEY)).toThrow(
        'API_KEY_ENCRYPTION_KEY must contain only hexadecimal characters'
      );
    });
  });

  describe('dual-key rotation window', () => {
    const OLD_KEY = 'b'.repeat(64);

    it('decrypts rows on the PREVIOUS key during a rotation window (GCM tag is the key selector)', () => {
      // Row encrypted under the old key...
      vi.stubEnv('API_KEY_ENCRYPTION_KEY', OLD_KEY);
      const encrypted = encryptApiKey(TEST_API_KEY);
      // ...rotation staged: new current key, old demoted to PREVIOUS.
      vi.stubEnv('API_KEY_ENCRYPTION_KEY', VALID_MASTER_KEY);
      vi.stubEnv('API_KEY_ENCRYPTION_KEY_PREVIOUS', OLD_KEY);

      expect(decryptApiKey(encrypted)).toBe(TEST_API_KEY);
    });

    it('still prefers the current key for rows already re-encrypted', () => {
      vi.stubEnv('API_KEY_ENCRYPTION_KEY_PREVIOUS', OLD_KEY);
      const encrypted = encryptApiKey(TEST_API_KEY); // current key

      expect(decryptApiKey(encrypted)).toBe(TEST_API_KEY);
    });

    it('throws when NO fallback key is set and the row is on another key (no rotation window)', () => {
      vi.stubEnv('API_KEY_ENCRYPTION_KEY', OLD_KEY);
      const encrypted = encryptApiKey(TEST_API_KEY);
      vi.stubEnv('API_KEY_ENCRYPTION_KEY', VALID_MASTER_KEY);

      expect(() => decryptApiKey(encrypted)).toThrow();
    });

    it('treats an EMPTY previous-key variable as unset (Railway cannot delete vars)', () => {
      vi.stubEnv('API_KEY_ENCRYPTION_KEY', OLD_KEY);
      const encrypted = encryptApiKey(TEST_API_KEY);
      vi.stubEnv('API_KEY_ENCRYPTION_KEY', VALID_MASTER_KEY);
      vi.stubEnv('API_KEY_ENCRYPTION_KEY_PREVIOUS', '');

      expect(() => decryptApiKey(encrypted)).toThrow();
    });

    it('throws when the row matches NEITHER key', () => {
      vi.stubEnv('API_KEY_ENCRYPTION_KEY', 'c'.repeat(64));
      const encrypted = encryptApiKey(TEST_API_KEY);
      vi.stubEnv('API_KEY_ENCRYPTION_KEY', VALID_MASTER_KEY);
      vi.stubEnv('API_KEY_ENCRYPTION_KEY_PREVIOUS', OLD_KEY);

      expect(() => decryptApiKey(encrypted)).toThrow();
    });
  });

  describe('explicit-key variants (rotation tooling)', () => {
    it('round-trips with caller-supplied key material, independent of env', () => {
      vi.stubEnv('API_KEY_ENCRYPTION_KEY', '');
      const key = parseEncryptionKeyMaterial('d'.repeat(64), 'TEST_KEY');
      const encrypted = encryptWithKey(TEST_API_KEY, key);

      expect(decryptWithKey(encrypted, key)).toBe(TEST_API_KEY);
    });

    it('decryptWithKey throws on the wrong key — the auth failure IS "not this key"', () => {
      const keyA = parseEncryptionKeyMaterial('d'.repeat(64), 'TEST_KEY');
      const keyB = parseEncryptionKeyMaterial('e'.repeat(64), 'TEST_KEY');

      expect(() => decryptWithKey(encryptWithKey(TEST_API_KEY, keyA), keyB)).toThrow();
    });

    it('parseEncryptionKeyMaterial rejects malformed material with the given label', () => {
      expect(() => parseEncryptionKeyMaterial('short', 'MY_LABEL')).toThrow('MY_LABEL');
      expect(() => parseEncryptionKeyMaterial('z'.repeat(64), 'MY_LABEL')).toThrow('MY_LABEL');
    });
  });

  describe('decryptApiKey', () => {
    it('should decrypt back to original plaintext', () => {
      const encrypted = encryptApiKey(TEST_API_KEY);
      const decrypted = decryptApiKey(encrypted);

      expect(decrypted).toBe(TEST_API_KEY);
    });

    it('should decrypt empty string', () => {
      const encrypted = encryptApiKey('');
      const decrypted = decryptApiKey(encrypted);

      expect(decrypted).toBe('');
    });

    it('should decrypt long API keys', () => {
      const longKey = 'x'.repeat(1000);
      const encrypted = encryptApiKey(longKey);
      const decrypted = decryptApiKey(encrypted);

      expect(decrypted).toBe(longKey);
    });

    it('should decrypt API keys with special characters', () => {
      const specialKey = 'sk-test_ABC123!@#$%^&*()_+-=[]{}|;:,.<>?/~`';
      const encrypted = encryptApiKey(specialKey);
      const decrypted = decryptApiKey(encrypted);

      expect(decrypted).toBe(specialKey);
    });

    it('should decrypt unicode characters', () => {
      const unicodeKey = 'sk-test-🔐-日本語-émojis';
      const encrypted = encryptApiKey(unicodeKey);
      const decrypted = decryptApiKey(encrypted);

      expect(decrypted).toBe(unicodeKey);
    });

    it('should throw on tampered ciphertext', () => {
      const encrypted = encryptApiKey(TEST_API_KEY);

      // Tamper with the content by flipping a bit (XOR with 0x01)
      // This guarantees a change unlike replacing with a fixed value
      const firstByte = parseInt(encrypted.content.slice(0, 2), 16);
      const flippedByte = (firstByte ^ 0x01).toString(16).padStart(2, '0');
      const tampered: EncryptedData = {
        ...encrypted,
        content: flippedByte + encrypted.content.slice(2),
      };

      expect(() => decryptApiKey(tampered)).toThrow();
    });

    it('should throw on tampered IV', () => {
      const encrypted = encryptApiKey(TEST_API_KEY);

      // Tamper with the IV by flipping a bit
      const firstByte = parseInt(encrypted.iv.slice(0, 2), 16);
      const flippedByte = (firstByte ^ 0x01).toString(16).padStart(2, '0');
      const tampered: EncryptedData = {
        ...encrypted,
        iv: flippedByte + encrypted.iv.slice(2),
      };

      expect(() => decryptApiKey(tampered)).toThrow();
    });

    it('should throw on tampered auth tag', () => {
      const encrypted = encryptApiKey(TEST_API_KEY);

      // Tamper with the tag by flipping a bit
      const firstByte = parseInt(encrypted.tag.slice(0, 2), 16);
      const flippedByte = (firstByte ^ 0x01).toString(16).padStart(2, '0');
      const tampered: EncryptedData = {
        ...encrypted,
        tag: flippedByte + encrypted.tag.slice(2),
      };

      expect(() => decryptApiKey(tampered)).toThrow();
    });

    it('should throw with wrong master key', () => {
      const encrypted = encryptApiKey(TEST_API_KEY);

      // Change to different key
      vi.stubEnv('API_KEY_ENCRYPTION_KEY', 'b'.repeat(64));

      expect(() => decryptApiKey(encrypted)).toThrow();
    });
  });

  describe('isValidEncryptedData', () => {
    it('should return true for valid encrypted data', () => {
      const encrypted = encryptApiKey(TEST_API_KEY);

      expect(isValidEncryptedData(encrypted)).toBe(true);
    });

    it('should return false for null', () => {
      expect(isValidEncryptedData(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isValidEncryptedData(undefined)).toBe(false);
    });

    it('should return false for non-object', () => {
      expect(isValidEncryptedData('string')).toBe(false);
      expect(isValidEncryptedData(123)).toBe(false);
      expect(isValidEncryptedData(true)).toBe(false);
    });

    it('should return false for missing iv', () => {
      expect(isValidEncryptedData({ content: 'abc', tag: 'a'.repeat(32) })).toBe(false);
    });

    it('should return false for missing content', () => {
      expect(isValidEncryptedData({ iv: 'a'.repeat(32), tag: 'a'.repeat(32) })).toBe(false);
    });

    it('should return false for missing tag', () => {
      expect(isValidEncryptedData({ iv: 'a'.repeat(32), content: 'abc' })).toBe(false);
    });

    it('should return false for wrong IV length', () => {
      expect(
        isValidEncryptedData({
          iv: 'a'.repeat(16), // Should be 32
          content: 'abc',
          tag: 'a'.repeat(32),
        })
      ).toBe(false);
    });

    it('should return false for wrong tag length', () => {
      expect(
        isValidEncryptedData({
          iv: 'a'.repeat(32),
          content: 'abc',
          tag: 'a'.repeat(16), // Should be 32
        })
      ).toBe(false);
    });

    it('should return false for non-hex IV', () => {
      expect(
        isValidEncryptedData({
          iv: 'g'.repeat(32), // 'g' is not hex
          content: 'abc',
          tag: 'a'.repeat(32),
        })
      ).toBe(false);
    });

    it('should return false for non-hex tag', () => {
      expect(
        isValidEncryptedData({
          iv: 'a'.repeat(32),
          content: 'abc',
          tag: 'g'.repeat(32), // 'g' is not hex
        })
      ).toBe(false);
    });

    it('should return false for non-hex content', () => {
      expect(
        isValidEncryptedData({
          iv: 'a'.repeat(32),
          content: 'xyz', // not hex
          tag: 'a'.repeat(32),
        })
      ).toBe(false);
    });

    it('should accept uppercase hex', () => {
      expect(
        isValidEncryptedData({
          iv: 'ABCDEF0123456789ABCDEF0123456789',
          content: 'ABCDEF',
          tag: 'ABCDEF0123456789ABCDEF0123456789',
        })
      ).toBe(true);
    });
  });

  describe('round-trip encryption', () => {
    it('should handle multiple sequential encrypt/decrypt cycles', () => {
      for (let i = 0; i < 10; i++) {
        const key = `sk-test-${i}-${Math.random().toString(36)}`;
        const encrypted = encryptApiKey(key);
        const decrypted = decryptApiKey(encrypted);
        expect(decrypted).toBe(key);
      }
    });

    it('should work with all provider API key formats', () => {
      const apiKeys = [
        'sk-1234567890abcdefghijklmnopqrstuvwxyz', // OpenAI format
        'sk-proj-1234567890abcdefghijklmnopqrstuvwxyz', // OpenAI project key
        'sk-or-v1-abcdefghijklmnopqrstuvwxyz1234567890', // OpenRouter format
        'AIzaSyA1234567890abcdefghijklmnopqrstuvwxyz', // Google format
        'sk-ant-api03-1234567890abcdefghijklmnopqrstuvwxyz', // Anthropic format
      ];

      for (const apiKey of apiKeys) {
        const encrypted = encryptApiKey(apiKey);
        const decrypted = decryptApiKey(encrypted);
        expect(decrypted).toBe(apiKey);
      }
    });
  });
});
