import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decryptApiKey,
  encryptApiKey,
  type EncryptedData,
} from '@tzurot/common-types/utils/encryption';
import { makeUndecryptableCiphertext } from './undecryptableCiphertext.js';

describe('makeUndecryptableCiphertext', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('flips only the first character of the auth tag, preserves iv and content, and fails decryptApiKey authentication', () => {
    vi.stubEnv('API_KEY_ENCRYPTION_KEY', 'a'.repeat(64));
    vi.stubEnv('API_KEY_ENCRYPTION_KEY_PREVIOUS', undefined);

    const encryptSpy = vi.fn(encryptApiKey);
    const corrupted = makeUndecryptableCiphertext(
      encryptSpy,
      'TEST-FIXTURE-not-a-real-provider-api-key-abcdef'
    );

    const original = encryptSpy.mock.results[0]?.value as EncryptedData;
    expect(corrupted.iv).toBe(original.iv);
    expect(corrupted.content).toBe(original.content);
    expect(corrupted.tag).toHaveLength(original.tag.length);
    expect(corrupted.tag[0]).not.toBe(original.tag[0]);
    expect(corrupted.tag[0]).toBe(original.tag[0] === '0' ? '1' : '0');
    expect(corrupted.tag.slice(1)).toBe(original.tag.slice(1));

    expect(() => decryptApiKey(corrupted)).toThrow(
      'Unsupported state or unable to authenticate data'
    );
  });

  it.each([
    ['0', '1'],
    ['f', '0'],
  ])('flips leading tag hex char %s to %s', (initialFirstChar, expectedFirstChar) => {
    const fakeEncrypt = (): EncryptedData => ({
      iv: 'b'.repeat(32),
      content: 'c'.repeat(32),
      tag: `${initialFirstChar}${'d'.repeat(31)}`,
    });

    const corrupted = makeUndecryptableCiphertext(fakeEncrypt, 'TEST-FIXTURE-plaintext');
    expect(corrupted.tag).toBe(`${expectedFirstChar}${'d'.repeat(31)}`);
    expect(corrupted.iv).toBe('b'.repeat(32));
    expect(corrupted.content).toBe('c'.repeat(32));
  });
});
