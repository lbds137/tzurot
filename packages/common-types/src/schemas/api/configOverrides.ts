/**
 * Config Cascade Overrides Schema
 *
 * Defines the shape of JSONB config override columns used in the 5-tier config cascade:
 *   hardcoded defaults < admin < personality < channel < user-default < user+personality
 *
 * All fields are optional in the schema (partial overrides). The resolver merges
 * tiers bottom-up to produce a fully-resolved object with no undefined fields.
 */

import { z } from 'zod';

// ============================================================================
// Config Overrides Schema (JSONB column shape)
// ============================================================================

/**
 * Schema for JSONB config override columns.
 * All fields optional — each tier only specifies the fields it wants to override.
 * `.strip()` discards unknown keys to prevent JSONB column drift.
 */
export const ConfigOverridesSchema = z
  .object({
    /** Max messages to include in conversation context (1-100) */
    maxMessages: z.number().int().min(1).max(100).optional(),
    /** Max age in seconds for context messages (null = no limit, 0 = disabled) */
    maxAge: z.number().int().min(0).nullable().optional(),
    /** Max images to process from extended context (0-20) */
    maxImages: z.number().int().min(0).max(20).optional(),
    /** Minimum similarity score for memory retrieval (0-1) */
    memoryScoreThreshold: z.number().min(0).max(1).optional(),
    /** Maximum number of memories to retrieve (0 = disabled) */
    memoryLimit: z.number().int().min(0).optional(),
    /** Focus mode: disable LTM retrieval (memories still saved) */
    focusModeEnabled: z.boolean().optional(),
    /** Fill unused context budget with history from other channels */
    crossChannelHistoryEnabled: z.boolean().optional(),
    /** Share long-term memories across all personalities (migrated from Persona column) */
    shareLtmAcrossPersonalities: z.boolean().optional(),
    /** Whether to show the model indicator footer on AI responses */
    showModelFooter: z.boolean().optional(),
    /** Voice response mode: 'always' = every response, 'voice-only' = when user sends voice, 'never' = disabled */
    voiceResponseMode: z.enum(['always', 'voice-only', 'never']).optional(),
    /** Whether to auto-transcribe voice messages (runtime control; VOICE_ENGINE_URL remains infrastructure config) */
    voiceTranscriptionEnabled: z.boolean().optional(),
  })
  .strip();

export type ConfigOverrides = z.infer<typeof ConfigOverridesSchema>;

// ============================================================================
// Hardcoded Defaults
// ============================================================================

/**
 * Hardcoded defaults for all config override fields.
 * These are the values used when no tier provides an override.
 * Must include every field in ConfigOverrides (fully resolved, no undefined).
 */
export const HARDCODED_CONFIG_DEFAULTS: {
  readonly maxMessages: 50;
  readonly maxAge: null;
  readonly maxImages: 10;
  readonly memoryScoreThreshold: 0.5;
  readonly memoryLimit: 20;
  readonly focusModeEnabled: false;
  readonly crossChannelHistoryEnabled: false;
  readonly shareLtmAcrossPersonalities: false;
  readonly showModelFooter: true;
  readonly voiceResponseMode: 'never';
  readonly voiceTranscriptionEnabled: true;
} = {
  maxMessages: 50,
  maxAge: null,
  maxImages: 10,
  memoryScoreThreshold: 0.5,
  memoryLimit: 20,
  focusModeEnabled: false,
  crossChannelHistoryEnabled: false,
  shareLtmAcrossPersonalities: false,
  showModelFooter: true,
  voiceResponseMode: 'never',
  // TODO: voiceTranscriptionEnabled is defined in the cascade but not yet consumed
  // by bot-client's VoiceMessageProcessor. Wiring it requires bot-client to fetch
  // resolved config before transcription (currently happens in ai-worker pipeline).
  voiceTranscriptionEnabled: true,
};

// ============================================================================
// Source Tracking
// ============================================================================

/**
 * Source of a resolved config override value.
 * Tracks which tier provided each field in the final resolved config.
 *
 * Cascade order (lowest → highest priority):
 *   hardcoded → admin → personality → channel → user-default → user-personality
 */
export type ConfigOverrideSource =
  | 'hardcoded'
  | 'admin'
  | 'personality'
  | 'channel'
  | 'user-default'
  | 'user-personality';

/**
 * Fully resolved config overrides with source tracking.
 * Every field is guaranteed to have a value (no undefined).
 */
export interface ResolvedConfigOverrides {
  /** Effective values (fully resolved, never undefined) */
  maxMessages: number;
  maxAge: number | null;
  maxImages: number;
  memoryScoreThreshold: number;
  memoryLimit: number;
  focusModeEnabled: boolean;
  crossChannelHistoryEnabled: boolean;
  shareLtmAcrossPersonalities: boolean;
  showModelFooter: boolean;
  voiceResponseMode: 'always' | 'voice-only' | 'never';
  voiceTranscriptionEnabled: boolean;

  /** Per-field source tracking: which tier provided each value */
  sources: Record<keyof ConfigOverrides, ConfigOverrideSource>;
}
