/**
 * Shapes.inc Import Types
 *
 * Type definitions for shapes.inc data structures and import job payloads.
 * Used by bot-client (command handlers), api-gateway (job creation), and ai-worker (import processing).
 */

import { z } from 'zod';

// ============================================================================
// Shapes.inc API Response Types
// ============================================================================

/** Full shape configuration from /api/shapes/{id} */
export interface ShapesIncPersonalityConfig {
  // Identity
  id: string;
  name: string;
  username: string;
  avatar: string;

  // Core prompting
  jailbreak: string;
  user_prompt: string;

  // Personality traits
  personality_traits: string;
  personality_tone?: string;
  personality_age?: string;
  personality_appearance?: string;
  personality_likes?: string;
  personality_dislikes?: string;
  personality_conversational_goals?: string;
  personality_conversational_examples?: string;
  personality_history?: string;

  // LLM parameters
  engine_model: string;
  fallback_engine_model?: string;
  engine_temperature: number;
  engine_top_p?: number;
  engine_top_k?: number;
  engine_frequency_penalty?: number;
  engine_presence_penalty?: number;
  engine_repetition_penalty?: number;
  engine_min_p?: number;
  engine_top_a?: number;

  // Memory settings
  stm_window: number;
  ltm_enabled: boolean;
  ltm_threshold: number;
  ltm_max_retrieved_summaries: number;

  // Custom fields
  error_message?: string;
  birthday?: string;
  favorite_reacts?: string[];
  keywords?: string[];
  search_description?: string;
  wack_message?: string;
  sleep_message?: string;

  // Owner info (for detecting owner vs non-owner)
  created_by?: string;

  // Catch-all for unmapped fields
  [key: string]: unknown;
}

/** Memory entry from /api/shapes/{id}/memories */
export interface ShapesIncMemory {
  id: string;
  shape_id: string;
  senders: string[];
  result: string;
  metadata: {
    start_ts: number;
    end_ts: number;
    created_at: number;
    senders: string[];
    discord_channel_id?: string;
    discord_guild_id?: string;
  };
}

/** Story/knowledge entry from /api/shapes/{id}/stories */
export interface ShapesIncStory {
  id: string;
  shape_id: string;
  story_type: 'general' | 'command' | 'relationship';
  content: string;
  metadata?: Record<string, unknown>;
}

/** User personalization from /api/shapes/{id}/user */
export interface ShapesIncUserPersonalization {
  backstory: string;
  preferred_name: string;
  pronouns: string;
  engine_temperature?: number;
  engine_top_p?: number;
  engine_top_k?: number;
  engine_frequency_penalty?: number;
  engine_presence_penalty?: number;
  engine_repetition_penalty?: number;
  engine_min_p?: number;
  engine_top_a?: number;
  [key: string]: unknown;
}

/** User profile from /api/users/info */
export interface ShapesIncUserProfile {
  id: string;
  email?: string;
  shapes?: { id: string; username: string }[];
}

// ============================================================================
// Import Job Types (BullMQ payloads)
// ============================================================================

const importTypeEnum = z.enum(['full', 'memory_only']);

/**
 * Shapes Import Job Data Schema
 * SINGLE SOURCE OF TRUTH for shapes import job payloads
 *
 * Produced by: api-gateway (shapes/import.ts route)
 * Consumed by: ai-worker (ShapesImportJob.ts)
 *
 * Note: ShapesImport jobs don't extend baseJobDataSchema because they use
 * a separate queue and don't need requestId/responseDestination/version.
 */
export const shapesImportJobDataSchema = z.object({
  /** Internal Tzurot user ID (UUID) */
  userId: z.string().uuid(),
  /** Discord user ID (for persona resolution) */
  discordUserId: z.string().min(1),
  /** Shapes.inc slug/username to import */
  sourceSlug: z.string().min(1),
  /** ImportJob record ID for status tracking */
  importJobId: z.string().uuid(),
  /** Whether this is a full import or memory-only */
  importType: importTypeEnum,
  /** Existing personality ID (for memory-only imports into existing personality) */
  existingPersonalityId: z.string().uuid().optional(),
});

/**
 * Shapes Import Result Schema
 * SINGLE SOURCE OF TRUTH for shapes import job results
 *
 * Produced by: ai-worker (ShapesImportJob.ts)
 * Consumed by: api-gateway (shapes/import.ts status queries)
 */
export const shapesImportResultSchema = z.object({
  success: z.boolean(),
  personalityId: z.string().uuid().optional(),
  personalitySlug: z.string().optional(),
  memoriesImported: z.number().int().nonnegative(),
  memoriesFailed: z.number().int().nonnegative(),
  importType: importTypeEnum,
  error: z.string().optional(),
});

/** Data passed to the shapes import BullMQ job */
export interface ShapesImportJobData {
  /** Internal Tzurot user ID (UUID) */
  userId: string;
  /** Discord user ID (for persona resolution) */
  discordUserId: string;
  /** Shapes.inc slug/username to import */
  sourceSlug: string;
  /** ImportJob record ID for status tracking */
  importJobId: string;
  /** Whether this is a full import or memory-only */
  importType: 'full' | 'memory_only';
  /** Existing personality ID (for memory-only imports into existing personality) */
  existingPersonalityId?: string;
}

/** Result returned by the shapes import job */
export interface ShapesImportJobResult {
  success: boolean;
  personalityId?: string;
  personalitySlug?: string;
  memoriesImported: number;
  memoriesFailed: number;
  importType: 'full' | 'memory_only';
  error?: string;
}

// ============================================================================
// Export Job Types (BullMQ payloads)
// ============================================================================

const exportFormatEnum = z.enum(['json', 'markdown']);

/**
 * Shapes Export Job Data Schema
 * SINGLE SOURCE OF TRUTH for shapes export job payloads
 *
 * Produced by: api-gateway (shapes/export.ts route)
 * Consumed by: ai-worker (ShapesExportJob.ts)
 */
export const shapesExportJobDataSchema = z.object({
  /** Internal Tzurot user ID (UUID) */
  userId: z.string().uuid(),
  /** Discord user ID (for credential resolution) */
  discordUserId: z.string().min(1),
  /** Shapes.inc slug/username to export */
  sourceSlug: z.string().min(1),
  /** ExportJob record ID for status tracking */
  exportJobId: z.string().uuid(),
  /** Export format */
  format: exportFormatEnum,
});

/**
 * Shapes Export Result Schema
 * SINGLE SOURCE OF TRUTH for shapes export job results
 *
 * Produced by: ai-worker (ShapesExportJob.ts)
 * Consumed by: api-gateway (shapes/export.ts status queries)
 */
export const shapesExportResultSchema = z.object({
  success: z.boolean(),
  fileSizeBytes: z.number().int().nonnegative(),
  memoriesCount: z.number().int().nonnegative(),
  storiesCount: z.number().int().nonnegative(),
  error: z.string().optional(),
});

/** Data passed to the shapes export BullMQ job */
export interface ShapesExportJobData {
  /** Internal Tzurot user ID (UUID) */
  userId: string;
  /** Discord user ID (for credential resolution) */
  discordUserId: string;
  /** Shapes.inc slug/username to export */
  sourceSlug: string;
  /** ExportJob record ID for status tracking */
  exportJobId: string;
  /** Export format */
  format: 'json' | 'markdown';
}

/** Result returned by the shapes export job */
export interface ShapesExportJobResult {
  success: boolean;
  fileSizeBytes: number;
  memoriesCount: number;
  storiesCount: number;
  error?: string;
}

// ============================================================================
// Data Fetcher Types
// ============================================================================

/** Complete data fetched from shapes.inc for a single shape */
export interface ShapesDataFetchResult {
  config: ShapesIncPersonalityConfig;
  memories: ShapesIncMemory[];
  stories: ShapesIncStory[];
  userPersonalization: ShapesIncUserPersonalization | null;
  stats: {
    memoriesCount: number;
    storiesCount: number;
    pagesTraversed: number;
  };
}

// ============================================================================
// Credential Service Constants
// ============================================================================

/** Service identifiers for UserCredential table */
export const CREDENTIAL_SERVICES = {
  SHAPES_INC: 'shapes_inc',
} as const;

/** Credential type identifiers */
export const CREDENTIAL_TYPES = {
  SESSION_COOKIE: 'session_cookie',
} as const;

/** Import source service identifiers for ImportJob table */
export const IMPORT_SOURCES = {
  SHAPES_INC: 'shapes_inc',
} as const;

/** Shapes.inc API base URL */
export const SHAPES_BASE_URL = 'https://shapes.inc';

/**
 * User-Agent for shapes.inc API calls.
 * Uses a standard Chrome UA — the user authenticated with their own session cookie,
 * so we're acting as their browser to automate data retrieval on their behalf.
 */
export const SHAPES_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';
