/**
 * Memory Incognito API Contract Tests
 */

import { describe, it, expect } from 'vitest';
import {
  GetIncognitoStatusResponseSchema,
  EnableIncognitoResponseSchema,
  DisableIncognitoResponseSchema,
  IncognitoForgetResponseSchema,
} from './memoryIncognito.js';

const sampleSession = {
  userId: 'u1',
  personalityId: 'all' as const,
  enabledAt: '2026-05-25T00:00:00.000Z',
  expiresAt: '2026-05-25T01:00:00.000Z',
  duration: '1h' as const,
};

describe('Memory Incognito API Contract Tests', () => {
  describe('GetIncognitoStatusResponseSchema', () => {
    it('accepts inactive state with empty sessions', () => {
      expect(
        GetIncognitoStatusResponseSchema.safeParse({ active: false, sessions: [] }).success
      ).toBe(true);
    });

    it('accepts active state with sessions + timeRemaining', () => {
      const data = {
        active: true,
        sessions: [{ ...sampleSession, timeRemaining: 1_800_000 }],
      };
      expect(GetIncognitoStatusResponseSchema.safeParse(data).success).toBe(true);
    });

    it('accepts null timeRemaining (forever sessions)', () => {
      const data = {
        active: true,
        sessions: [
          { ...sampleSession, duration: 'forever' as const, expiresAt: null, timeRemaining: null },
        ],
      };
      expect(GetIncognitoStatusResponseSchema.safeParse(data).success).toBe(true);
    });
  });

  describe('EnableIncognitoResponseSchema', () => {
    it('accepts newly-enabled response', () => {
      const data = {
        session: sampleSession,
        timeRemaining: 3_600_000,
        wasAlreadyActive: false,
        message: 'Incognito mode enabled.',
      };
      expect(EnableIncognitoResponseSchema.safeParse(data).success).toBe(true);
    });

    it('accepts already-active response', () => {
      const data = {
        session: sampleSession,
        timeRemaining: 1_800_000,
        wasAlreadyActive: true,
        message: 'Already active.',
      };
      expect(EnableIncognitoResponseSchema.safeParse(data).success).toBe(true);
    });
  });

  describe('DisableIncognitoResponseSchema', () => {
    it('accepts disabled=true', () => {
      const data = { disabled: true, message: 'Disabled.' };
      expect(DisableIncognitoResponseSchema.safeParse(data).success).toBe(true);
    });

    it('accepts disabled=false (was not active)', () => {
      const data = { disabled: false, message: 'Was not active.' };
      expect(DisableIncognitoResponseSchema.safeParse(data).success).toBe(true);
    });
  });

  describe('IncognitoForgetResponseSchema', () => {
    it('accepts response with deleted memories', () => {
      const data = {
        deletedCount: 5,
        personalities: ['Lilith', 'Ada'],
        message: 'Deleted 5 memories.',
      };
      expect(IncognitoForgetResponseSchema.safeParse(data).success).toBe(true);
    });

    it('accepts no-op response (no memories found)', () => {
      const data = { deletedCount: 0, personalities: [], message: 'No memories.' };
      expect(IncognitoForgetResponseSchema.safeParse(data).success).toBe(true);
    });

    it('rejects negative deletedCount', () => {
      const data = { deletedCount: -1, personalities: [], message: '' };
      expect(IncognitoForgetResponseSchema.safeParse(data).success).toBe(false);
    });
  });
});
