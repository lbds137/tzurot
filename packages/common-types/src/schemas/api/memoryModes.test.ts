/**
 * Memory Mode API Contract Tests (shared by incognito + fresh endpoints)
 */

import { describe, it, expect } from 'vitest';
import {
  GetMemoryModeStatusResponseSchema,
  EnableMemoryModeResponseSchema,
  DisableMemoryModeResponseSchema,
  IncognitoForgetResponseSchema,
  MemoryModeSessionWithRemainingSchema,
} from './memoryModes.js';

const sampleSession = {
  userId: 'u1',
  personalityId: 'all' as const,
  enabledAt: '2026-05-25T00:00:00.000Z',
  expiresAt: '2026-05-25T01:00:00.000Z',
  duration: '1h' as const,
};

describe('MemoryModeSessionWithRemainingSchema', () => {
  // `timeRemaining` is a human-formatted string the handler computes via
  // `MemoryModeSessionManager.getTimeRemaining` — emits "1 hour", "30 minutes",
  // "Until manually disabled", or "Expired".
  it('accepts session enriched with a human-formatted timeRemaining string', () => {
    const data = { ...sampleSession, timeRemaining: '1 hour' };
    expect(MemoryModeSessionWithRemainingSchema.safeParse(data).success).toBe(true);
  });

  it('accepts the "Until manually disabled" sentinel for forever sessions', () => {
    const data = {
      ...sampleSession,
      duration: 'forever' as const,
      expiresAt: null,
      timeRemaining: 'Until manually disabled',
    };
    expect(MemoryModeSessionWithRemainingSchema.safeParse(data).success).toBe(true);
  });

  it('rejects missing timeRemaining', () => {
    expect(MemoryModeSessionWithRemainingSchema.safeParse(sampleSession).success).toBe(false);
  });
});

describe('Memory Mode API Contract Tests', () => {
  describe('GetMemoryModeStatusResponseSchema', () => {
    it('accepts inactive state with empty sessions', () => {
      expect(
        GetMemoryModeStatusResponseSchema.safeParse({ active: false, sessions: [] }).success
      ).toBe(true);
    });

    it('accepts active state with sessions + formatted timeRemaining', () => {
      const data = {
        active: true,
        sessions: [{ ...sampleSession, timeRemaining: '30 minutes' }],
      };
      expect(GetMemoryModeStatusResponseSchema.safeParse(data).success).toBe(true);
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
      expect(GetMemoryModeStatusResponseSchema.safeParse(data).success).toBe(true);
    });
  });

  describe('EnableMemoryModeResponseSchema', () => {
    it('accepts newly-enabled response', () => {
      const data = {
        session: sampleSession,
        timeRemaining: '1 hour',
        wasAlreadyActive: false,
        message: 'Incognito mode enabled.',
      };
      expect(EnableMemoryModeResponseSchema.safeParse(data).success).toBe(true);
    });

    it('accepts already-active response', () => {
      const data = {
        session: sampleSession,
        timeRemaining: '30 minutes',
        wasAlreadyActive: true,
        message: 'Already active.',
      };
      expect(EnableMemoryModeResponseSchema.safeParse(data).success).toBe(true);
    });
  });

  describe('DisableMemoryModeResponseSchema', () => {
    it('accepts disabled=true', () => {
      const data = { disabled: true, message: 'Disabled.' };
      expect(DisableMemoryModeResponseSchema.safeParse(data).success).toBe(true);
    });

    it('accepts disabled=false (was not active)', () => {
      const data = { disabled: false, message: 'Was not active.' };
      expect(DisableMemoryModeResponseSchema.safeParse(data).success).toBe(true);
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
