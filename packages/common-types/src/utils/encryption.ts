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
 * The single "is this optional key variable set" rule shared by the PREVIOUS and
 * NEXT getters and by `getEncryptionKeySlots`: absent or empty both mean unset.
 */
function isKeyVarSet(value: string | undefined): value is string {
  return value !== undefined && value !== '';
}

/**
 * Previous encryption key during a rotation window, or null outside one.
 * Absent or empty both mean no rotation window: stage 3 deletes the variable,
 * and an empty value (left by an older finalize or a hand edit) means the same.
 */
function getPreviousEncryptionKey(): Buffer | null {
  const key = process.env.API_KEY_ENCRYPTION_KEY_PREVIOUS;
  if (!isKeyVarSet(key)) {
    return null;
  }
  return parseKeyMaterial(key, 'API_KEY_ENCRYPTION_KEY_PREVIOUS');
}

/**
 * Next encryption key staged by rotation stage 1 before the swap, or null
 * when none is staged. DECRYPT-ONLY: `encryptApiKey` never reads it, so no row
 * is written under it until the swap promotes it to CURRENT. Absent or empty
 * both mean no staged key (same convention as PREVIOUS).
 */
function getNextEncryptionKey(): Buffer | null {
  const key = process.env.API_KEY_ENCRYPTION_KEY_NEXT;
  if (!isKeyVarSet(key)) {
    return null;
  }
  return parseKeyMaterial(key, 'API_KEY_ENCRYPTION_KEY_NEXT');
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
    // Rotation fallbacks, tried in order: rows not yet re-encrypted decrypt
    // with the previous key; a row another process already wrote under the
    // staged next key decrypts with NEXT. GCM's auth tag makes a wrong-key
    // attempt fail loudly (never silent garbage), so try-then-fallback IS the
    // key selector — no ciphertext versioning needed. Each fallback key is
    // resolved lazily, in this order. With no fallback set the original error
    // propagates; with fallbacks set, a decrypt error from the attempts is thrown
    // (wrong-key errors carry the same message, so which attempt's error surfaces
    // is not pinned).
    return decryptWithFallbacks(encrypted, error, [getPreviousEncryptionKey, getNextEncryptionKey]);
  }
}

function decryptWithFallbacks(
  encrypted: EncryptedData,
  currentError: unknown,
  resolvers: readonly (() => Buffer | null)[]
): string {
  let lastError = currentError;
  for (const resolve of resolvers) {
    const key = resolve();
    if (key === null) {
      continue;
    }
    try {
      return decryptWithKey(encrypted, key);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
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
 * Whether the SERVICE's encryption configuration is usable right now —
 * distinct from whether any particular stored credential decrypts.
 *
 * Re-runs the same key resolution `decryptApiKey`/`encryptApiKey` depend on,
 * so this cannot drift from what they actually require: `false` means
 * `API_KEY_ENCRYPTION_KEY` (or a present `API_KEY_ENCRYPTION_KEY_PREVIOUS` /
 * `API_KEY_ENCRYPTION_KEY_NEXT`) is missing or malformed, never that a
 * specific row's ciphertext is bad.
 */
export function isEncryptionConfigured(): boolean {
  try {
    getEncryptionKey();
    getPreviousEncryptionKey();
    getNextEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * Presence only, for startup observability during a BYOK rotation: whether the
 * PREVIOUS and NEXT key variables are set, by the same rule the getters use.
 * Never parses, returns or logs a key value.
 */
export function getEncryptionKeySlots(): { previousKeySet: boolean; nextKeySet: boolean } {
  return {
    previousKeySet: isKeyVarSet(process.env.API_KEY_ENCRYPTION_KEY_PREVIOUS),
    nextKeySet: isKeyVarSet(process.env.API_KEY_ENCRYPTION_KEY_NEXT),
  };
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
