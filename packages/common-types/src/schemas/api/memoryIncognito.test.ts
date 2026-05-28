/**
 * Memory Incognito API Contract Tests
 */

import { describe, it, expect } from 'vitest';
import {
  GetIncognitoStatusResponseSchema,
  EnableIncognitoResponseSchema,
  DisableIncognitoResponseSchema,
  IncognitoForgetResponseSchema,
  IncognitoSessionWithRemainingSchema,
} from './memoryIncognito.js';

const sampleSession = {
  userId: 'u1',
  personalityId: 'all' as const,
  enabledAt: '2026-05-25T00:00:00.000Z',
  expiresAt: '2026-05-25T01:00:00.000Z',
  duration: '1h' as const,
};

describe('IncognitoSessionWithRemainingSchema', () => {
  // `timeRemaining` is a human-formatted string the handler computes via
  // `IncognitoSessionManager.getTimeRemaining` — emits "1 hour", "30 minutes",
  // "Until manually disabled", or "Expired".
  it('accepts session enriched with a human-formatted timeRemaining string', () => {
    const data = { ...sampleSession, timeRemaining: '1 hour' };
    expect(IncognitoSessionWithRemainingSchema.safeParse(data).success).toBe(true);
  });

  it('accepts the "Until manually disabled" sentinel for forever sessions', () => {
    const data = {
      ...sampleSession,
      duration: 'forever' as const,
      expiresAt: null,
      timeRemaining: 'Until manually disabled',
    };
    expect(IncognitoSessionWithRemainingSchema.safeParse(data).success).toBe(true);
  });

  it('rejects missing timeRemaining', () => {
    expect(IncognitoSessionWithRemainingSchema.safeParse(sampleSession).success).toBe(false);
  });
});

describe('Memory Incognito API Contract Tests', () => {
  describe('GetIncognitoStatusResponseSchema', () => {
    it('accepts inactive state with empty sessions', () => {
      expect(
        GetIncognitoStatusResponseSchema.safeParse({ active: false, sessions: [] }).success
      ).toBe(true);
    });

    it('accepts active state with sessions + formatted timeRemaining', () => {
      const data = {
        active: true,
        sessions: [{ ...sampleSession, timeRemaining: '30 minutes' }],
      };
      expect(GetIncognitoStatusResponseSchema.safeParse(data).success).toBe(true);
    });

    it('accepts forever-session sentinel string', () => {
      const data = {
        active: true,
        sessions: [
          {
            ...sampleSession,
            duration: 'forever' as const,
            expiresAt: null,
            timeRemaining: 'Until manually disabled',
          },
        ],
      };
      expect(GetIncognitoStatusResponseSchema.safeParse(data).success).toBe(true);
    });
  });

  describe('EnableIncognitoResponseSchema', () => {
    it('accepts newly-enabled response', () => {
      const data = {
        session: sampleSession,
        timeRemaining: '1 hour',
        wasAlreadyActive: false,
        message: 'Incognito mode enabled.',
      };
      expect(EnableIncognitoResponseSchema.safeParse(data).success).toBe(true);
    });

    it('accepts already-active response', () => {
      const data = {
        session: sampleSession,
        timeRemaining: '30 minutes',
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
