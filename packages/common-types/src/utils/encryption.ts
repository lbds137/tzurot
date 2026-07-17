/**
 * Encryption Utilities for API Key Storage
 *
 * Uses AES-256-GCM for authenticated encryption of user API keys.
 * Keys are stored as 3 separate columns (iv, content, tag) for clarity.
 *
 * Security considerations:
 * - Master key must be 32 bytes (256 bits) stored as 64 hex chars
 * - Each encryption generates a unique IV (prevents pattern analysis)
 * - Auth tag ensures tamper detection (ciphertext integrity)
 * - Never log decrypted keys or master key
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits
const TAG_LENGTH = 16; // 128 bits

/**
 * Encrypted data structure for database storage.
 * Each field is stored in a separate column.
 */
export interface EncryptedData {
  /** Initialization vector - 16 bytes as hex (32 chars) */
  iv: string;
  /** Ciphertext as hex */
  content: string;
  /** Authentication tag - 16 bytes as hex (32 chars) */
  tag: string;
}

/**
 * Parse and validate 32-byte hex key material.
 * @throws Error naming `label` if the value is missing or malformed
 */
function parseKeyMaterial(value: string | undefined, label: string): Buffer {
  if (value === undefined || value === '') {
    throw new Error(`${label} environment variable is required for encryption`);
  }
  if (value.length !== 64) {
    throw new Error(
      `${label} must be 64 hex characters (32 bytes), got ${value.length} characters`
    );
  }
  // Validate hex format
  if (!/^[0-9a-fA-F]+$/.test(value)) {
    throw new Error(`${label} must contain only hexadecimal characters`);
  }
  return Buffer.from(value, 'hex');
}

/**
 * Get encryption key from environment.
 * Key must be 32 bytes (256 bits) in hex format (64 hex characters).
 *
 * @throws Error if API_KEY_ENCRYPTION_KEY is missing or invalid length
 */
function getEncryptionKey(): Buffer {
  return parseKeyMaterial(process.env.API_KEY_ENCRYPTION_KEY, 'API_KEY_ENCRYPTION_KEY');
}

/**
 * Previous encryption key during a rotation window, or null outside one.
 * Empty string counts as unset — the Railway CLI cannot delete variables, so
 * "rotation finished" is expressed by setting the variable to "".
 */
function getPreviousEncryptionKey(): Buffer | null {
  const key = process.env.API_KEY_ENCRYPTION_KEY_PREVIOUS;
  if (key === undefined || key === '') {
    return null;
  }
  return parseKeyMaterial(key, 'API_KEY_ENCRYPTION_KEY_PREVIOUS');
}

/**
 * Encrypt an API key using AES-256-GCM.
 * Returns IV, ciphertext, and auth tag separately for database storage.
 *
 * @param plaintext - The API key to encrypt
 * @returns EncryptedData with iv, content, and tag as hex strings
 * @throws Error if API_KEY_ENCRYPTION_KEY is missing or invalid
 *
 * @example
 * const encrypted = encryptApiKey('sk-abc123...');
 * // Store encrypted.iv, encrypted.content, encrypted.tag in database
 */
export function encryptApiKey(plaintext: string): EncryptedData {
  return encryptWithKey(plaintext, getEncryptionKey());
}

/**
 * Explicit-key encrypt — for rotation tooling that manages key material
 * itself instead of reading process.env. Services use encryptApiKey.
 */
export function encryptWithKey(plaintext: string, key: Buffer): EncryptedData {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString('hex'),
    content: encrypted,
    tag: tag.toString('hex'),
  };
}

/**
 * Decrypt an API key using AES-256-GCM.
 * Verifies authentication tag to detect tampering.
 *
 * @param encrypted - The encrypted data from database
 * @returns The decrypted API key
 * @throws Error if authentication fails (tampered data) or key is invalid
 *
 * @example
 * const apiKey = decryptApiKey({ iv, content, tag });
 * // Use apiKey for API calls, never log it
 */
export function decryptApiKey(encrypted: EncryptedData): string {
  // Resolve the current key OUTSIDE the try: a malformed/missing CURRENT
  // config must always fail loudly, never masquerade as a rotation-window
  // fallback. Only genuine decrypt (wrong-key) failures fall through.
  const currentKey = getEncryptionKey();
  try {
    return decryptWithKey(encrypted, currentKey);
  } catch (error) {
    // Dual-key rotation window: rows not yet re-encrypted decrypt with the
    // previous key. GCM's auth tag makes a wrong-key attempt fail loudly
    // (never silent garbage), so try-then-fallback IS the key selector — no
    // ciphertext versioning needed. Outside a rotation window the fallback
    // is absent and the original error propagates.
    const previousKey = getPreviousEncryptionKey();
    if (previousKey === null) {
      throw error;
    }
    return decryptWithKey(encrypted, previousKey);
  }
}

/**
 * Explicit-key decrypt — for rotation tooling (re-encrypt passes, verify
 * sweeps). Throws on auth failure, which doubles as "not this key".
 */
export function decryptWithKey(encrypted: EncryptedData, key: Buffer): string {
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(encrypted.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(encrypted.tag, 'hex'));

  let decrypted = decipher.update(encrypted.content, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/** Parse 64-char hex key material into a Buffer (rotation tooling entry). */
export function parseEncryptionKeyMaterial(value: string, label: string): Buffer {
  return parseKeyMaterial(value, label);
}

/**
 * Validate that a string looks like a valid encrypted data structure.
 * Useful for validating database values before attempting decryption.
 *
 * @param data - The data to validate
 * @returns true if structure is valid, false otherwise
 */
export function isValidEncryptedData(data: unknown): data is EncryptedData {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const obj = data as Record<string, unknown>;

  // Check all required fields exist and are strings
  if (
    typeof obj.iv !== 'string' ||
    typeof obj.content !== 'string' ||
    typeof obj.tag !== 'string'
  ) {
    return false;
  }

  // Validate IV length (16 bytes = 32 hex chars)
  if (obj.iv.length !== IV_LENGTH * 2) {
    return false;
  }

  // Validate tag length (16 bytes = 32 hex chars)
  if (obj.tag.length !== TAG_LENGTH * 2) {
    return false;
  }

  // Validate hex format for all fields
  const hexPattern = /^[0-9a-fA-F]+$/;
  if (!hexPattern.test(obj.iv) || !hexPattern.test(obj.content) || !hexPattern.test(obj.tag)) {
    return false;
  }

  return true;
}
