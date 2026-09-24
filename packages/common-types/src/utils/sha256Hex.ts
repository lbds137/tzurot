/**
 * Shared SHA-256 hex digest primitive.
 *
 * A caller asks for `{ length: N }` rather than truncating the result
 * itself, because the width is load-bearing for persisted and cache-keyed
 * values — a 16-char id and a 64-char digest are not interchangeable, and a
 * truncation error there means a wider collision surface than the caller
 * intended. Every call site states its width explicitly.
 */

import { createHash, type BinaryToTextEncoding } from 'node:crypto';

/** Full length of a SHA-256 hex digest. */
const FULL_DIGEST_LENGTH = 64;

const HEX: BinaryToTextEncoding = 'hex';

/**
 * SHA-256 hex digest of `input`.
 *
 * @param opts.length Number of leading hex chars to return, an integer in
 *   1..64. Omit to get the full 64-char lowercase digest.
 * @param opts.encoding Passed through to the hash's `.update()` call —
 *   supply it when `input` isn't plain text (e.g. a hex- or base64-encoded
 *   string). Omit for the default UTF-8 interpretation. Byte input is hashed
 *   as-is, so passing `encoding` with byte input throws.
 * @throws {RangeError} if `opts.length` is given and is not an integer in 1..64.
 * @throws {TypeError} if `opts.encoding` is given with byte input.
 */
export function sha256Hex(
  input: string | Uint8Array,
  opts?: { length?: number; encoding?: BufferEncoding }
): string {
  const { length, encoding } = opts ?? {};

  if (
    length !== undefined &&
    (!Number.isInteger(length) || length < 1 || length > FULL_DIGEST_LENGTH)
  ) {
    throw new RangeError(
      `sha256Hex: length must be an integer in 1..${String(FULL_DIGEST_LENGTH)}, got ${String(length)}`
    );
  }

  if (encoding !== undefined && typeof input !== 'string') {
    throw new TypeError(
      'sha256Hex: encoding applies to string input only; byte input is hashed as-is'
    );
  }
  const hash = createHash('sha256');
  if (typeof input === 'string' && encoding !== undefined) {
    hash.update(input, encoding);
  } else {
    hash.update(input);
  }
  const digest = hash.digest(HEX);

  return length === undefined ? digest : digest.slice(0, length);
}
