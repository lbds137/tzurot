/**
 * NSFW API Contract Tests
 *
 * Validates schemas for /user/nsfw endpoints.
 */

import { describe, it, expect } from 'vitest';
import { GetNsfwStatusResponseSchema, VerifyNsfwResponseSchema } from './nsfw.js';

describe('NSFW API Contract Tests', () => {
  describe('GetNsfwStatusResponseSchema', () => {
    it('accepts verified state with timestamp', () => {
      const data = { nsfwVerified: true, nsfwVerifiedAt: '2026-05-25T12:00:00.000Z' };
      expect(GetNsfwStatusResponseSchema.safeParse(data).success).toBe(true);
    });

    it('accepts unverified state with null timestamp', () => {
      const data = { nsfwVerified: false, nsfwVerifiedAt: null };
      expect(GetNsfwStatusResponseSchema.safeParse(data).success).toBe(true);
    });

    it('rejects missing nsfwVerified', () => {
      const data = { nsfwVerifiedAt: null };
      expect(GetNsfwStatusResponseSchema.safeParse(data).success).toBe(false);
    });

    it('rejects missing nsfwVerifiedAt', () => {
      const data = { nsfwVerified: true };
      expect(GetNsfwStatusResponseSchema.safeParse(data).success).toBe(false);
    });
  });

  describe('VerifyNsfwResponseSchema', () => {
    it('accepts freshly-verified response', () => {
      const data = {
        nsfwVerified: true as const,
        nsfwVerifiedAt: '2026-05-25T12:00:00.000Z',
        alreadyVerified: false,
      };
      expect(VerifyNsfwResponseSchema.safeParse(data).success).toBe(true);
    });

    it('accepts already-verified response', () => {
      const data = {
        nsfwVerified: true as const,
        nsfwVerifiedAt: '2026-01-01T00:00:00.000Z',
        alreadyVerified: true,
      };
      expect(VerifyNsfwResponseSchema.safeParse(data).success).toBe(true);
    });

    it('rejects nsfwVerified=false (verify endpoint only returns true)', () => {
      const data = {
        nsfwVerified: false,
        nsfwVerifiedAt: '2026-05-25T12:00:00.000Z',
        alreadyVerified: false,
      };
      expect(VerifyNsfwResponseSchema.safeParse(data).success).toBe(false);
    });

    it('rejects null nsfwVerifiedAt (handler self-heals inconsistent state)', () => {
      const data = {
        nsfwVerified: true as const,
        nsfwVerifiedAt: null,
        alreadyVerified: true,
      };
      expect(VerifyNsfwResponseSchema.safeParse(data).success).toBe(false);
    });

    it('rejects missing alreadyVerified', () => {
      const data = {
        nsfwVerified: true as const,
        nsfwVerifiedAt: '2026-05-25T12:00:00.000Z',
      };
      expect(VerifyNsfwResponseSchema.safeParse(data).success).toBe(false);
    });
  });
});
