/**
 * Test helper for constructing an undecryptable AES-256-GCM ciphertext fixture.
 *
 * Callers pass `encrypt` (obtained via `vi.importActual`) because the test
 * files that use this helper mock `@tzurot/common-types/utils/encryption`.
 */

import type { EncryptedData } from '@tzurot/common-types/utils/encryption';

/**
 * Encrypt `plaintext` and flip the first hex character of the GCM auth tag
 * ('0' -> '1', anything else -> '0') so `decryptApiKey` fails authentication.
 */
export function makeUndecryptableCiphertext(
  encrypt: (plaintext: string) => EncryptedData,
  plaintext: string
): EncryptedData {
  const encrypted = encrypt(plaintext);
  const corruptedTag = `${encrypted.tag.startsWith('0') ? '1' : '0'}${encrypted.tag.slice(1)}`;
  return {
    iv: encrypted.iv,
    content: encrypted.content,
    tag: corruptedTag,
  };
}
