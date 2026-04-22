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
  /** Summarization type (e.g. 'automatic'). Maps to summary_type column. */
  summary_type?: string;
  /** Whether this memory was deleted on shapes.inc. Skip during import. */
  deleted?: boolean;
  metadata: {
    start_ts: number;
    end_ts: number;
    created_at: number;
    senders: string[];
    /** Discord channel ID. May be empty string in newer format — treat as null. */
    discord_channel_id?: string;
    /** Discord guild ID. May be empty string in newer format — treat as null. */
    discord_guild_id?: string;
    /** Message IDs that were summarized into this memory. */
    msg_ids?: string[];
  };
}

/** Story/knowledge entry from /api/shapes/{id}/stories */
export interface ShapesIncStory {
  id: string;
  shape_id: string;
  story_type: 'general' | 'command' | 'relationship';
  title?: string;
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
}

/** Result returned by the shapes import job */
export interface ShapesImportJobResult {
  success: boolean;
  personalityId?: string;
  personalitySlug?: string;
  memoriesImported: number;
  memoriesFailed: number;
  memoriesSkipped?: number;
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
  /** Internal Tzurot user ID (UUID) — used for credential lookup and DB writes */
  userId: z.string().uuid(),
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
  /** Internal Tzurot user ID (UUID) — used for credential lookup and DB writes */
  userId: string;
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

/**
 * Name of the shapes.inc session cookie (Better Auth, as of 2026-04).
 * The `__Secure-` prefix is a browser-enforced rule: the cookie is only set/sent
 * over HTTPS, which matches our traffic since `SHAPES_BASE_URL` is HTTPS.
 */
export const SHAPES_SESSION_COOKIE_NAME = '__Secure-better-auth.session_token';

/**
 * Predicate: is `name` a cookie the shapes fetcher should accept in its jar?
 *
 * Scoped to just the Better Auth session cookie today. This prevents analytics
 * (GA, Datadome) or bot-protection (Cloudflare `cf_clearance`) cookies served by
 * shapes.inc from being echoed back on subsequent requests. If shapes.inc ever
 * adds a required WAF-routing cookie, add the case here — do not broaden the
 * fetcher to accept arbitrary names.
 *
 * Exposed as a predicate function rather than an exported Set so callers cannot
 * accidentally mutate the allowlist at runtime.
 */
export function isShapesAllowedCookieName(name: string): boolean {
  return name === SHAPES_SESSION_COOKIE_NAME;
}

/**
 * Build a cookie string suitable for the `Cookie:` request header from a raw
 * Better Auth session token value.
 *
 * Callers outside this module should not need to know the cookie-name format —
 * they hand in the opaque token value, this returns `name=value`.
 */
export function buildSessionCookie(tokenValue: string): string {
  return `${SHAPES_SESSION_COOKIE_NAME}=${tokenValue}`;
}

/**
 * Outcome of parsing user-supplied cookie input at the auth modal boundary.
 *
 * - `ok: true, cookie` — normalized `name=value` string ready for the fetcher jar
 * - `ok: false, reason: 'empty'` — input was blank after trimming
 * - `ok: false, reason: 'wrong-cookie'` — input looked like a cookie string
 *   (contained `=` or `;`) but did not include `SHAPES_SESSION_COOKIE_NAME`.
 *   Classic "user pasted the whole Request Headers Cookie: line" mistake.
 * - `ok: false, reason: 'malformed-value'` — input looked like a bare token
 *   value but failed the basic shape check (regex/length).
 */
export type ShapesSessionInputResult =
  | { ok: true; cookie: string }
  | { ok: false; reason: 'empty' | 'wrong-cookie' | 'malformed-value' };

/**
 * Regex for a plausible Better Auth session token value. URL-safe base64 /
 * hex / signed-value characters; minimum-length sanity check only.
 *
 * Intentionally permissive: Better Auth tokens are opaque and the format can
 * change. This is a best-effort client-side sanity check, NOT authoritative
 * validation — the gateway should live-preflight against shapes.inc before
 * persisting (tracked separately).
 */
const SHAPES_TOKEN_SHAPE = /^[A-Za-z0-9._-]+$/;

/**
 * Minimum length for a plausible Better Auth session token value.
 * Exported so UI-layer gates (e.g., Discord modal `.setMinLength()`) can
 * stay aligned with the parser — otherwise a user whose input passes the
 * UI gate but fails the parser's check sees a confusing UX mismatch.
 */
export const SHAPES_TOKEN_MIN_LENGTH = 32;

/**
 * Parse the user-supplied modal input into a normalized cookie string.
 *
 * Accepts three input shapes, in order of preference:
 *  1. Bare token value: `"abc123...xyz"` → prepended with the cookie name.
 *  2. Single `name=value` pair: `"__Secure-better-auth.session_token=abc..."` → normalized to that form.
 *  3. Full `Cookie:` header: `"_ga=1; __Secure-better-auth.session_token=abc; theme=dark"` →
 *     extract just the expected cookie and discard the rest.
 *
 * Rejects (returns `{ ok: false }`):
 *  - Empty input
 *  - Any cookie-like input that doesn't include `SHAPES_SESSION_COOKIE_NAME` (user pasted wrong thing)
 *  - A value (extracted from any of the three paths) that fails the token-shape
 *    regex or minimum-length check
 *
 * The defense against shape (3) specifically catches the common failure mode
 * where users copy the `Cookie:` request header from the Network tab instead
 * of a single cookie value from the Application tab.
 */
export function parseShapesSessionCookieInput(rawInput: string): ShapesSessionInputResult {
  const input = rawInput.trim();
  if (input.length === 0) {
    return { ok: false, reason: 'empty' };
  }

  const looksLikeCookieString = input.includes('=') || input.includes(';');
  if (looksLikeCookieString) {
    // Parse as semicolon-delimited cookie pairs and extract the expected name.
    for (const part of input.split(';')) {
      const trimmed = part.trim();
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx <= 0) {
        continue;
      }
      const name = trimmed.substring(0, eqIdx);
      const value = trimmed.substring(eqIdx + 1);
      if (name === SHAPES_SESSION_COOKIE_NAME) {
        if (!isPlausibleShapesTokenValue(value)) {
          return { ok: false, reason: 'malformed-value' };
        }
        return { ok: true, cookie: buildSessionCookie(value) };
      }
    }
    return { ok: false, reason: 'wrong-cookie' };
  }

  // Bare token value path — sanity-check shape and length.
  if (!isPlausibleShapesTokenValue(input)) {
    return { ok: false, reason: 'malformed-value' };
  }
  return { ok: true, cookie: buildSessionCookie(input) };
}

/**
 * Apply the token shape + minimum-length check. Shared by every branch of
 * `parseShapesSessionCookieInput` so a 16-char bare value and a 16-char
 * `name=value` value both fail the same way — no surprise where a format
 * is permissive in one path and strict in another.
 *
 * Also usable directly at trust boundaries (e.g., api-gateway validation)
 * where callers have already extracted the raw token value from a
 * `name=value` string and want to apply the same shape gate without
 * re-routing through the full three-shape parser.
 */
export function isPlausibleShapesTokenValue(value: string): boolean {
  return value.length >= SHAPES_TOKEN_MIN_LENGTH && SHAPES_TOKEN_SHAPE.test(value);
}
