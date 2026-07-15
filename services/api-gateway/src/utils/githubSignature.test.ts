import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyGitHubSignature } from './githubSignature.js';

const SECRET = 'test-webhook-secret';
const BODY = Buffer.from(JSON.stringify({ action: 'published' }));

function sign(body: Buffer, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

describe('verifyGitHubSignature', () => {
  it('accepts a signature computed with the shared secret', () => {
    expect(verifyGitHubSignature(BODY, sign(BODY, SECRET), SECRET)).toBe(true);
  });

  it('rejects a signature computed with a different secret', () => {
    expect(verifyGitHubSignature(BODY, sign(BODY, 'wrong-secret'), SECRET)).toBe(false);
  });

  it('rejects a signature over different bytes', () => {
    const otherBody = Buffer.from(JSON.stringify({ action: 'published', extra: 1 }));
    expect(verifyGitHubSignature(BODY, sign(otherBody, SECRET), SECRET)).toBe(false);
  });

  it('rejects a missing header', () => {
    expect(verifyGitHubSignature(BODY, undefined, SECRET)).toBe(false);
  });

  it('rejects a header without the sha256= prefix', () => {
    const bare = createHmac('sha256', SECRET).update(BODY).digest('hex');
    expect(verifyGitHubSignature(BODY, bare, SECRET)).toBe(false);
    expect(verifyGitHubSignature(BODY, `sha1=${bare}`, SECRET)).toBe(false);
  });

  it('rejects length-mismatched and non-hex digests without throwing', () => {
    expect(verifyGitHubSignature(BODY, 'sha256=abc123', SECRET)).toBe(false);
    expect(verifyGitHubSignature(BODY, 'sha256=not-hex-at-all!!', SECRET)).toBe(false);
    expect(verifyGitHubSignature(BODY, 'sha256=', SECRET)).toBe(false);
  });

  it('rejects everything when the secret is empty (fail closed)', () => {
    expect(verifyGitHubSignature(BODY, sign(BODY, ''), '')).toBe(false);
  });
});
