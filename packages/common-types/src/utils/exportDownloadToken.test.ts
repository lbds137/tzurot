import { describe, it, expect } from 'vitest';
import { generateExportDownloadToken, isExportDownloadToken } from './exportDownloadToken.js';

describe('exportDownloadToken', () => {
  it('mints a 64-char lowercase-hex token', () => {
    const token = generateExportDownloadToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is unguessable — successive tokens never collide', () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateExportDownloadToken()));
    expect(tokens.size).toBe(1000);
  });

  it('accepts a well-formed token and rejects malformed ones', () => {
    expect(isExportDownloadToken(generateExportDownloadToken())).toBe(true);
    // A deterministic export-job UUID (the thing that must NOT be a download
    // token) is the exact shape the guard rejects — hyphens, uppercase, wrong length.
    expect(isExportDownloadToken('a1b2c3d4-e5f6-42a3-8b1c-000000000000')).toBe(false);
    expect(isExportDownloadToken('ABCDEF'.repeat(11))).toBe(false); // uppercase
    expect(isExportDownloadToken('a'.repeat(63))).toBe(false); // too short
    expect(isExportDownloadToken('')).toBe(false);
  });
});
