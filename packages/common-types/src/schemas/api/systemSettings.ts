/**
 * System Settings Schema
 *
 * Owner-only operational settings stored in the `admin_settings.system_settings`
 * JSONB column. These are NON-CASCADING — a deliberate third bag on the singleton
 * row, distinct from `configDefaults` (the cascade admin tier) and the preset
 * pointers. Design: docs/proposals/backlog/admin-runtime-settings.md.
 *
 * The dashboard/slash-setter/seed registry lives in
 * `./systemSettingsRegistry.js` — this file carries only the RESOLVED schema
 * shape and the wire contracts, so the registry can import `SystemSettings`
 * from here without a cycle.
 */

import { z } from 'zod';

// ============================================================================
// Schema (the RESOLVED shape — every key present)
// ============================================================================

/**
 * Fully-resolved system settings. Bounds mirror the env schema each setting
 * migrates from — the migration must not silently widen a range.
 */
export const SystemSettingsSchema = z.object({
  /** Runtime kill switch for async fact extraction (checked per trigger-fire). */
  extractionEnabled: z.boolean(),
  /** Inject extracted facts into the generation prompt. */
  factsInPromptEnabled: z.boolean(),
  /** Personality slugs whose memory archive renders split (user turn verbatim + linked facts, assistant prose omitted). Empty = every character renders verbatim. */
  archiveSplitRenderPersonalities: z.array(z.string().regex(/^[a-z0-9-]+$/)),
  /** Job creation switch for the memory-archive summarizer: when off, no memory is enqueued for summarization. */
  archiveSummaryEnqueueEnabled: z.boolean(),
  /** Model-call switch for the memory-archive summarizer: when off, queued jobs delay instead of billing a call. */
  archiveSummaryModelEnabled: z.boolean(),
  /** Rows the memory-archive summarizer may process per UTC day, all characters combined. */
  archiveSummaryDailyCap: z.number().int().min(1).max(100000),
  /** Runtime switch for character roster blurbs: the summarizer sweep AND rendering them in the prompt. */
  rosterBlurbEnabled: z.boolean(),
  /** Render conversation history as real user/assistant provider messages instead of `<chat_log>` XML in the system prompt (prompt-assembly Phase 2 rollout switch). */
  realMessagesEnabled: z.boolean(),
  /** Convert header-shaped lines in real-message body content to parentheses, so a user cannot forge a platform speaker header (prompt-assembly kill switch). */
  headerSpoofNeutralizeEnabled: z.boolean(),
  /** Share the z.ai piggyback model ({@link ZAI_FREE_TIER_MODEL}) with guests via the system z.ai coding-plan key. */
  zaiFreeTierEnabled: z.boolean(),
  /** Vision-describe rasterizable stickers (instance-funded, cached per snowflake). */
  stickerVisionEnabled: z.boolean(),
  /** Episodes per (channel, personality) before an extraction batch enqueues. */
  extractionBatchThreshold: z.number().int().min(1).max(50),
  /** Background-work engine (fact extraction AND roster blurbs) — switching models MUST re-run `pnpm eval:extraction` first. */
  extractionModel: z.string().min(1),
  /** Which provider bills background work (extraction AND roster blurbs); 'zai-coding' requires ZAI_CODING_API_KEY on BOTH ai-worker and api-gateway. */
  extractionProvider: z.enum(['openrouter', 'zai-coding']),
  /** The shared free key's daily free-request allowance (the pie). */
  freeTierGlobalDailyBudget: z.number().int().min(1),
  /** Rolling contention window for the free-tier fair share. */
  freeTierWindowMinutes: z.number().int().min(1).max(1440),
  /** Per-user floor: everyone gets at least this per window when budget permits. */
  freeTierMinPerWindow: z.number().int().min(1),
  /** Per-user ceiling: a lone user can't drain the whole pie. */
  freeTierMaxPerWindow: z.number().int().min(1),
  /** Guests shut off when the z.ai plan's tighter window is this % consumed. */
  zaiHeadroomPercent: z.number().int().min(1).max(99),
  /** Static daily request ceiling for guest z.ai traffic. */
  zaiGlobalDailyBudget: z.number().int().min(1),
  /** Per-IP public API rate limit (requests/minute). */
  publicRateLimitPerMin: z.number().int().min(1),
  /** How many characters may respond to one message (multi-tag fan-out cap). */
  multiTagMaxCharacters: z.number().int().min(1).max(10),
  /** The paid text floor — what runs when every chain above is exhausted. */
  fallbackTextModel: z.string().min(1),
  /** The paid vision floor. */
  fallbackVisionModel: z.string().min(1),
  /** The FREE text floor — guests only; free-route models only (billing firewall). */
  fallbackTextModelFree: z.string().min(1),
  /** The FREE vision floor — guests only; free-route models only. */
  fallbackVisionModelFree: z.string().min(1),
  /** Runtime switch for the scheduled nightly dev↔prod db-sync (prod bot-client only). */
  nightlySyncEnabled: z.boolean(),
  /** UTC hour (0–23) the nightly sync fires in. */
  nightlySyncHourUtc: z.number().int().min(0).max(23),
});

export type SystemSettings = z.infer<typeof SystemSettingsSchema>;

/**
 * The STORED bag: partial (keys seed over time) and `.passthrough()` — unknown
 * keys are PRESERVED so an older process can never strip-and-clobber keys a
 * newer process wrote (the rolling-deploy data-loss vector). This is a
 * deliberate divergence from ConfigOverridesSchema's `.strip()`.
 */
export const StoredSystemSettingsSchema = SystemSettingsSchema.partial().passthrough();

// ============================================================================
// Wire contracts (system-settings routes)
// ============================================================================

export const GetSystemSettingsResponseSchema = z.object({
  /** The stored bag (partial; unknown keys preserved). */
  systemSettings: StoredSystemSettingsSchema,
  /** Singleton row's updatedAt (ISO) — the optimistic-concurrency token for writes. */
  updatedAt: z.string(),
});

export const UpdateSystemSettingsRequestSchema = z.object({
  /**
   * Optimistic-concurrency token: the updatedAt the client read. Mismatch is
   * rejected with 409 ("settings changed underneath you — refresh"). Datetime
   * format is validated here so a malformed token 400s like any other bad
   * field instead of reaching `new Date()` and 500ing.
   */
  expectedUpdatedAt: z.string().datetime(),
  /** Only known keys are writable — an unknown key on the wire is a typo, not drift. */
  patch: SystemSettingsSchema.partial().strict(),
});

export const UpdateSystemSettingsResponseSchema = z.object({
  systemSettings: StoredSystemSettingsSchema,
  updatedAt: z.string(),
  /** Non-blocking validation notes (e.g. catalog unavailable on a fail-open field). */
  warnings: z.array(z.string()),
});
