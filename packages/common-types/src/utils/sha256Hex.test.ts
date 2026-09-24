import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { sha256Hex } from './sha256Hex.js';

describe('sha256Hex', () => {
  it('returns the full 64-char lowercase hex digest by default', () => {
    const digest = sha256Hex('hello world');
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same input', () => {
    expect(sha256Hex('same input')).toBe(sha256Hex('same input'));
  });

  it('differs for different input', () => {
    expect(sha256Hex('input A')).not.toBe(sha256Hex('input B'));
  });

  describe('length truncation', () => {
    it('returns a prefix of the full digest', () => {
      const full = sha256Hex('truncation target');
      expect(sha256Hex('truncation target', { length: 32 })).toBe(full.slice(0, 32));
      expect(sha256Hex('truncation target', { length: 16 })).toBe(full.slice(0, 16));
      expect(sha256Hex('truncation target', { length: 12 })).toBe(full.slice(0, 12));
      expect(sha256Hex('truncation target', { length: 6 })).toBe(full.slice(0, 6));
      expect(sha256Hex('truncation target', { length: 1 })).toBe(full.slice(0, 1));
    });

    it('length: 64 is identical to the default (no truncation)', () => {
      const input = 'boundary case';
      expect(sha256Hex(input, { length: 64 })).toBe(sha256Hex(input));
    });
  });

  describe('encoding passthrough', () => {
    it('utf8 and the default produce the same digest for ASCII input', () => {
      expect(sha256Hex('ascii text', { encoding: 'utf8' })).toBe(sha256Hex('ascii text'));
    });

    it('a different encoding reinterprets the string bytes and changes the digest', () => {
      // A valid hex string interpreted as UTF-8 text vs. as hex-decoded bytes
      // are different inputs to the hash — the encoding must actually reach
      // `.update()`, not be silently ignored.
      const hexLikeString = 'deadbeef';
      const asText = sha256Hex(hexLikeString);
      const asHexBytes = sha256Hex(hexLikeString, { encoding: 'hex' });
      expect(asHexBytes).not.toBe(asText);
    });

    it('combines with length truncation', () => {
      const hexLikeString = 'deadbeef';
      const full = sha256Hex(hexLikeString, { encoding: 'hex' });
      expect(sha256Hex(hexLikeString, { encoding: 'hex', length: 16 })).toBe(full.slice(0, 16));
    });
  });

  it('hashes byte input as-is, without a lossy UTF-8 decode', () => {
    const bytes = Buffer.from([0xff, 0xfe, 0x00, 0x80]); // not valid UTF-8
    expect(sha256Hex(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
  });
  it('throws TypeError when encoding is passed with byte input', () => {
    expect(() => sha256Hex(new Uint8Array([1, 2, 3]), { encoding: 'utf8' })).toThrow(TypeError);
  });
  describe('invalid length', () => {
    it('throws RangeError for 0', () => {
      expect(() => sha256Hex('x', { length: 0 })).toThrow(RangeError);
      expect(() => sha256Hex('x', { length: 0 })).toThrow(/0/);
    });

    it('throws RangeError for 65 (above the 64-char digest)', () => {
      expect(() => sha256Hex('x', { length: 65 })).toThrow(RangeError);
      expect(() => sha256Hex('x', { length: 65 })).toThrow(/65/);
    });

    it('throws RangeError for a non-integer (1.5)', () => {
      expect(() => sha256Hex('x', { length: 1.5 })).toThrow(RangeError);
      expect(() => sha256Hex('x', { length: 1.5 })).toThrow(/1\.5/);
    });

    it('throws RangeError for a negative length (-1)', () => {
      expect(() => sha256Hex('x', { length: -1 })).toThrow(RangeError);
      expect(() => sha256Hex('x', { length: -1 })).toThrow(/-1/);
    });

    it('throws RangeError for NaN', () => {
      expect(() => sha256Hex('x', { length: NaN })).toThrow(RangeError);
      expect(() => sha256Hex('x', { length: NaN })).toThrow(/NaN/);
    });
  });
});
