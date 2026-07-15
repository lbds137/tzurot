/**
 * GitHub webhook signature verification (x-hub-signature-256).
 *
 * GitHub signs the RAW request body with HMAC-SHA256 and sends the result
 * as `sha256=<hex>`. Verification must run over the exact bytes received —
 * any JSON parse/re-stringify round-trip changes the bytes and breaks the
 * signature, which is why the webhook route mounts `express.raw`.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const SIGNATURE_PREFIX = 'sha256=';

export function verifyGitHubSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string
): boolean {
  if (secret.length === 0) {
    return false;
  }
  if (signatureHeader === undefined) {
    return false;
  }
  if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) {
    return false;
  }

  const expected = createHmac('sha256', secret).update(rawBody).digest();
  // Non-hex input yields a short/empty buffer rather than throwing, so the
  // length guard below also rejects malformed hex.
  const provided = Buffer.from(signatureHeader.slice(SIGNATURE_PREFIX.length), 'hex');

  // timingSafeEqual throws on length mismatch; a valid signature's length is
  // not secret, so an explicit check leaks nothing and keeps this total.
  if (provided.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(provided, expected);
}
