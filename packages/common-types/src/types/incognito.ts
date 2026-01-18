/**
 * Incognito Mode Types
 *
 * Types for temporary memory-writing suspension.
 * Unlike Focus Mode (disables reading), Incognito Mode disables writing.
 *
 * Key difference:
 * - Focus Mode: LTM retrieval disabled, but memories still saved
 * - Incognito Mode: LTM retrieval enabled, but memories NOT saved
 */

import { z } from 'zod';

/**
 * Duration options for incognito mode
 */
export const INCOGNITO_DURATIONS = {
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  forever: null, // No expiration, must manually disable
} as const;

export type IncognitoDuration = keyof typeof INCOGNITO_DURATIONS;

/**
 * Incognito session stored in Redis
 * Key pattern: incognito:{userId}:{personalityId} or incognito:{userId}:all
 */
export interface IncognitoSession {
  /** User who enabled incognito */
  userId: string;
  /** Personality ID (UUID) or 'all' for global incognito */
  personalityId: string;
  /** When incognito was enabled */
  enabledAt: string; // ISO date string
  /** When incognito expires (null = forever/until manually disabled) */
  expiresAt: string | null; // ISO date string
  /** Duration string used (for display) */
  duration: IncognitoDuration;
}

/**
 * Zod schema for incognito session
 */
export const IncognitoSessionSchema = z.object({
  userId: z.string(),
  personalityId: z.union([z.string(), z.literal('all')]),
  enabledAt: z.string(),
  expiresAt: z.string().nullable(),
  duration: z.enum(['30m', '1h', '4h', 'forever']),
});

/**
 * Request to enable incognito mode
 */
export interface EnableIncognitoRequest {
  /** Personality ID (UUID) or 'all' for global incognito */
  personalityId: string;
  /** Duration of incognito mode */
  duration: IncognitoDuration;
}

export const EnableIncognitoRequestSchema = z.object({
  personalityId: z.union([z.string().uuid(), z.literal('all')]),
  duration: z.enum(['30m', '1h', '4h', 'forever']),
});

/**
 * Request to disable incognito mode
 */
export interface DisableIncognitoRequest {
  /** Personality ID (UUID) or 'all' to disable global incognito */
  personalityId: string;
}

export const DisableIncognitoRequestSchema = z.object({
  personalityId: z.union([z.string().uuid(), z.literal('all')]),
});

/**
 * Response for incognito status check
 */
export interface IncognitoStatusResponse {
  /** Whether incognito is active */
  active: boolean;
  /** Active sessions (may be multiple if per-personality) */
  sessions: IncognitoSession[];
}

/**
 * Request for retroactive forget
 */
export interface IncognitoForgetRequest {
  /** Personality ID (UUID) or 'all' */
  personalityId: string;
  /** How far back to delete (e.g., '5m', '15m', '1h') */
  timeframe: string;
}

export const IncognitoForgetRequestSchema = z.object({
  personalityId: z.union([z.string().uuid(), z.literal('all')]),
  timeframe: z.enum(['5m', '15m', '1h']),
});

/**
 * Duration label for human-readable display
 * Centralized utility to ensure consistent messaging across services
 */
export function getDurationLabel(duration: IncognitoDuration): string {
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

/**
 * Response for retroactive forget
 */
export interface IncognitoForgetResponse {
  /** Number of memories deleted */
  deletedCount: number;
  /** Personality name(s) affected */
  personalities: string[];
}
