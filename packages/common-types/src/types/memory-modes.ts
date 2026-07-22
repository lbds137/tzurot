/**
 * Memory Mode Types
 *
 * Shared session machinery for the two user-facing memory modes. Both are
 * Redis-TTL sessions keyed per (user, personality-or-'all'); they differ
 * only in which memory gate they close:
 *
 * - Incognito Mode: memory WRITING disabled — nothing new is saved.
 * - Fresh Mode: memory READING disabled — the character replies without
 *   using its long-term memories; nothing is deleted.
 */

import { z } from 'zod';

/**
 * Duration options for a memory-mode session
 */
export const MEMORY_MODE_DURATIONS = {
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  forever: null, // No expiration, must manually disable
} as const;

export type MemoryModeDuration = keyof typeof MEMORY_MODE_DURATIONS;

/**
 * Memory-mode session stored in Redis
 * Key pattern: {prefix}{userId}:{personalityId} or {prefix}{userId}:all
 */
export interface MemoryModeSession {
  /** User who enabled the mode */
  userId: string;
  /** Personality ID (UUID) or 'all' for a global session */
  personalityId: string;
  /** When the mode was enabled */
  enabledAt: string; // ISO date string
  /** When the session expires (null = forever/until manually disabled) */
  expiresAt: string | null; // ISO date string
  /** Duration string used (for display) */
  duration: MemoryModeDuration;
}

/**
 * Zod schema for a memory-mode session
 */
export const MemoryModeSessionSchema = z.object({
  userId: z.string(),
  personalityId: z.union([z.string(), z.literal('all')]),
  enabledAt: z.string(),
  expiresAt: z.string().nullable(),
  duration: z.enum(['30m', '1h', '4h', 'forever']),
});

export const EnableMemoryModeRequestSchema = z.object({
  personalityId: z.union([z.string().uuid(), z.literal('all')]),
  duration: z.enum(['30m', '1h', '4h', 'forever']),
});

export const DisableMemoryModeRequestSchema = z.object({
  personalityId: z.union([z.string().uuid(), z.literal('all')]),
});

/**
 * Response for a memory-mode status check
 */
export interface MemoryModeStatusResponse {
  /** Whether the mode is active */
  active: boolean;
  /** Active sessions (may be multiple if per-personality) */
  sessions: MemoryModeSession[];
}

export const IncognitoForgetRequestSchema = z.object({
  personalityId: z.union([z.string().uuid(), z.literal('all')]),
  timeframe: z.enum(['5m', '15m', '1h']),
});

/**
 * Duration label for human-readable display
 * Centralized utility to ensure consistent messaging across services
 */
export function getDurationLabel(duration: MemoryModeDuration): string {
  switch (duration) {
    case '30m':
      return '30 minutes';
    case '1h':
      return '1 hour';
    case '4h':
      return '4 hours';
    case 'forever':
      return 'until manually disabled';
  }
}
