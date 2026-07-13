/**
 * System Settings Schema + Registry
 *
 * Owner-only operational settings stored in the `admin_settings.system_settings`
 * JSONB column. These are NON-CASCADING — a deliberate third bag on the singleton
 * row, distinct from `configDefaults` (the cascade admin tier) and the preset
 * pointers. Design: docs/proposals/backlog/admin-runtime-settings.md.
 *
 * Registry-first: every setting is a SYSTEM_SETTINGS_REGISTRY entry carrying its
 * validator bounds (mirroring the env schema it migrates from), dashboard
 * metadata, seed source, and liveness. The registry powers schema validation,
 * the boot seed pass, write-route validation, dashboard rendering, and the
 * slash setter — one place to add setting #N+1.
 */

import { z } from 'zod';
import {
  AUTO_ROUTER_MODEL,
  FREE_ROUTER_MODEL,
  MODEL_DEFAULTS,
  type ModelSlot,
} from '../../constants/ai.js';

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
  /** Share GLM-4.5-Air with guests via the system z.ai coding-plan key. */
  zaiFreeTierEnabled: z.boolean(),
  /** Episodes per (channel, personality) before an extraction batch enqueues. */
  extractionBatchThreshold: z.number().int().min(1).max(50),
  /** Extraction engine — switching models MUST re-run `pnpm eval:extraction` first. */
  extractionModel: z.string().min(1),
  /** Which provider bills extraction; 'zai-coding' requires ZAI_CODING_API_KEY on BOTH ai-worker and api-gateway. */
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
  /** The paid text floor — what runs when every chain above is exhausted. */
  fallbackTextModel: z.string().min(1),
  /** The paid vision floor. */
  fallbackVisionModel: z.string().min(1),
  /** The FREE text floor — guests only; free-route models only (billing firewall). */
  fallbackTextModelFree: z.string().min(1),
  /** The FREE vision floor — guests only; free-route models only. */
  fallbackVisionModelFree: z.string().min(1),
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
// Registry
// ============================================================================

/** Dashboard page-group assignment (concern grouping; the dashboard slice owns rendering). */
export type SystemSettingGroup =
  'extraction' | 'free-tier-fair-share' | 'free-tier-zai' | 'models-limits';

const GROUP_EXTRACTION: SystemSettingGroup = 'extraction';
const GROUP_FAIR_SHARE: SystemSettingGroup = 'free-tier-fair-share';
const GROUP_ZAI: SystemSettingGroup = 'free-tier-zai';
const GROUP_MODELS_LIMITS: SystemSettingGroup = 'models-limits';

/** Which input control the setting renders as (dashboard + slash-setter coercion). */
export type SystemSettingControl = 'boolean' | 'integer' | 'enum' | 'model';

/**
 * When a write takes effect. 'live' = next read; 'rebuild' = on singleton
 * rebuild; 'restart' = requires deploy/restart — the write response MUST render
 * a "saved; takes effect on next restart" warning banner for this tier.
 */
export type SystemSettingLiveness = 'live' | 'rebuild' | 'restart';

/** Validation metadata for model-valued settings (write-route D9 rules). */
export interface SystemSettingModelMeta {
  /** Which catalog capability the value must have. */
  readonly slot: ModelSlot;
  /**
   * Router aliases accepted WITHOUT catalog lookup — they may lack modality
   * tags in the catalog, and the capability check must not reject them.
   */
  readonly aliasAllowlist: readonly string[];
  /**
   * Free floors only: the value must be a free-route model (`isFreeModel`), so
   * a misconfiguration can never point guests at a system-key-billed model.
   */
  readonly freeRouteOnly: boolean;
  /**
   * Catalog-unavailable behavior: floors fail 'closed' (no unverifiable
   * write), other model fields fail 'open' with a warning.
   */
  readonly catalogFailMode: 'closed' | 'open';
}

export interface SystemSettingMeta<K extends keyof SystemSettings = keyof SystemSettings> {
  readonly key: K;
  /** Short human label (dashboard field name / autocomplete choice). */
  readonly label: string;
  /** One-line description shown on write surfaces. */
  readonly description: string;
  readonly group: SystemSettingGroup;
  readonly control: SystemSettingControl;
  readonly liveness: SystemSettingLiveness;
  /**
   * The in-code floor beneath the floor: served when the DB row/key is absent
   * and the seed pass hasn't run. Must parse against the schema.
   */
  readonly fallback: SystemSettings[K];
  /**
   * The env var (or code constant) this setting migrates from — traceability
   * (historical) — names the env var / constant the setting migrated from.
   * The env vars themselves are deleted; existing bags carry their values.
   */
  readonly seedSource: string;
  /** Present iff control === 'model'. */
  readonly model?: SystemSettingModelMeta;
  /** Present iff control === 'enum'. */
  readonly choices?: readonly string[];
  /**
   * Integer controls only: inclusive bounds MIRRORING the zod schema (the
   * schema stays authoritative for validation; these power dashboard/client
   * input hints). A colocated parity test asserts registry bounds and schema
   * bounds agree, so the pair cannot drift. Absent max = unbounded above.
   */
  readonly min?: number;
  readonly max?: number;
}

type SystemSettingsRegistry = {
  readonly [K in keyof SystemSettings]: SystemSettingMeta<K>;
};

/**
 * The registry. The mapped type forces one entry per schema key — adding a
 * schema field without a registry entry (or vice versa) is a compile error.
 */
export const SYSTEM_SETTINGS_REGISTRY: SystemSettingsRegistry = {
  extractionEnabled: {
    key: 'extractionEnabled',
    label: 'Extraction Enabled',
    description: 'Runtime kill switch for async fact extraction (checked per trigger-fire).',
    group: GROUP_EXTRACTION,
    control: 'boolean',
    liveness: 'live',
    fallback: false,
    seedSource: 'EXTRACTION_ENABLED',
  },
  factsInPromptEnabled: {
    key: 'factsInPromptEnabled',
    label: 'Facts In Prompt',
    description: 'Inject extracted facts into the generation prompt.',
    group: GROUP_EXTRACTION,
    control: 'boolean',
    liveness: 'live',
    fallback: false,
    seedSource: 'FACTS_IN_PROMPT_ENABLED',
  },
  extractionBatchThreshold: {
    key: 'extractionBatchThreshold',
    label: 'Extraction Batch Threshold',
    description: 'Episodes per (channel, personality) before an extraction batch enqueues.',
    group: GROUP_EXTRACTION,
    control: 'integer',
    liveness: 'live',
    fallback: 6,
    seedSource: 'EXTRACTION_BATCH_THRESHOLD',
    min: 1,
    max: 50,
  },
  extractionModel: {
    key: 'extractionModel',
    label: 'Extraction Model',
    description:
      'Extraction engine. Switching models must re-run `pnpm eval:extraction` first — the quality gate is model-specific.',
    group: GROUP_EXTRACTION,
    control: 'model',
    liveness: 'live',
    fallback: MODEL_DEFAULTS.FACT_EXTRACTION,
    seedSource: 'EXTRACTION_MODEL',
    model: {
      slot: 'text',
      aliasAllowlist: [],
      freeRouteOnly: false,
      catalogFailMode: 'open',
    },
  },
  extractionProvider: {
    key: 'extractionProvider',
    label: 'Extraction Provider',
    description:
      "Which provider bills extraction; 'zai-coding' requires ZAI_CODING_API_KEY on BOTH ai-worker (bills the calls) and api-gateway (validates writes to this setting).",
    group: GROUP_EXTRACTION,
    control: 'enum',
    liveness: 'live',
    fallback: 'openrouter',
    seedSource: 'EXTRACTION_PROVIDER',
    choices: ['openrouter', 'zai-coding'],
  },
  freeTierGlobalDailyBudget: {
    key: 'freeTierGlobalDailyBudget',
    label: 'Free Tier Daily Budget',
    description: "The shared free key's daily free-request allowance (the pie).",
    group: GROUP_FAIR_SHARE,
    control: 'integer',
    liveness: 'live',
    fallback: 1000,
    seedSource: 'FREE_TIER_GLOBAL_DAILY_BUDGET',
    min: 1,
  },
  freeTierWindowMinutes: {
    key: 'freeTierWindowMinutes',
    label: 'Free Tier Window (min)',
    description: 'Rolling contention window for the free-tier fair share.',
    group: GROUP_FAIR_SHARE,
    control: 'integer',
    liveness: 'live',
    fallback: 60,
    seedSource: 'FREE_TIER_WINDOW_MINUTES',
    min: 1,
    max: 1440,
  },
  freeTierMinPerWindow: {
    key: 'freeTierMinPerWindow',
    label: 'Free Tier Min/Window',
    description: 'Per-user floor: everyone gets at least this per window when budget permits.',
    group: GROUP_FAIR_SHARE,
    control: 'integer',
    liveness: 'live',
    fallback: 5,
    seedSource: 'FREE_TIER_MIN_PER_WINDOW',
    min: 1,
  },
  freeTierMaxPerWindow: {
    key: 'freeTierMaxPerWindow',
    label: 'Free Tier Max/Window',
    description: "Per-user ceiling: a lone user can't drain the whole pie.",
    group: GROUP_FAIR_SHARE,
    control: 'integer',
    liveness: 'live',
    fallback: 30,
    seedSource: 'FREE_TIER_MAX_PER_WINDOW',
    min: 1,
  },
  zaiFreeTierEnabled: {
    key: 'zaiFreeTierEnabled',
    label: 'z.ai Free Tier Enabled',
    description: 'Share GLM-4.5-Air with guests via the system z.ai coding-plan key.',
    group: GROUP_ZAI,
    control: 'boolean',
    liveness: 'live',
    fallback: false,
    seedSource: 'ZAI_FREE_TIER_ENABLED',
  },
  zaiHeadroomPercent: {
    key: 'zaiHeadroomPercent',
    label: 'z.ai Headroom %',
    description: "Guests shut off when the plan's tighter window is this % consumed.",
    group: GROUP_ZAI,
    control: 'integer',
    liveness: 'live',
    fallback: 75,
    seedSource: 'ZAI_FREE_TIER_HEADROOM_PERCENT',
    min: 1,
    max: 99,
  },
  zaiGlobalDailyBudget: {
    key: 'zaiGlobalDailyBudget',
    label: 'z.ai Daily Budget',
    description: 'Static daily request ceiling for guest z.ai traffic.',
    group: GROUP_ZAI,
    control: 'integer',
    liveness: 'live',
    fallback: 1000,
    seedSource: 'ZAI_FREE_TIER_GLOBAL_DAILY_BUDGET',
    min: 1,
  },
  publicRateLimitPerMin: {
    key: 'publicRateLimitPerMin',
    label: 'Public Rate Limit (req/min)',
    description: 'Per-IP public API rate limit.',
    group: GROUP_MODELS_LIMITS,
    control: 'integer',
    liveness: 'live',
    fallback: 60,
    seedSource: 'PUBLIC_RATE_LIMIT_PER_MIN',
    min: 1,
  },
  fallbackTextModel: {
    key: 'fallbackTextModel',
    label: 'Fallback Text Model (paid)',
    description:
      'The paid text floor — runs when every chain above is exhausted. Choose boring, highly-available targets.',
    group: GROUP_MODELS_LIMITS,
    control: 'model',
    liveness: 'live',
    fallback: AUTO_ROUTER_MODEL,
    seedSource: 'DEFAULT_AI_MODEL',
    model: {
      slot: 'text',
      aliasAllowlist: [AUTO_ROUTER_MODEL, FREE_ROUTER_MODEL],
      freeRouteOnly: false,
      catalogFailMode: 'closed',
    },
  },
  fallbackVisionModel: {
    key: 'fallbackVisionModel',
    label: 'Fallback Vision Model (paid)',
    description: 'The paid vision floor — must accept image input.',
    group: GROUP_MODELS_LIMITS,
    control: 'model',
    liveness: 'live',
    fallback: AUTO_ROUTER_MODEL,
    seedSource: 'VISION_FALLBACK_MODEL',
    model: {
      slot: 'vision',
      aliasAllowlist: [AUTO_ROUTER_MODEL, FREE_ROUTER_MODEL],
      freeRouteOnly: false,
      catalogFailMode: 'closed',
    },
  },
  fallbackTextModelFree: {
    key: 'fallbackTextModelFree',
    label: 'Fallback Text Model (free)',
    description:
      'The FREE text floor (guest ladder last resort + quota-degrade retarget). Free-route models only.',
    group: GROUP_MODELS_LIMITS,
    control: 'model',
    liveness: 'live',
    fallback: FREE_ROUTER_MODEL,
    seedSource: 'FREE_ROUTER_MODEL (constant; formerly aliased as GUEST_MODE.DEFAULT_MODEL)',
    model: {
      slot: 'text',
      aliasAllowlist: [FREE_ROUTER_MODEL],
      freeRouteOnly: true,
      catalogFailMode: 'closed',
    },
  },
  fallbackVisionModelFree: {
    key: 'fallbackVisionModelFree',
    label: 'Fallback Vision Model (free)',
    description: 'The FREE vision floor (guest clamp). Free-route, image-capable models only.',
    group: GROUP_MODELS_LIMITS,
    control: 'model',
    liveness: 'live',
    fallback: FREE_ROUTER_MODEL,
    seedSource:
      'FREE_ROUTER_MODEL (constant; formerly aliased as MODEL_DEFAULTS.VISION_FALLBACK_FREE)',
    model: {
      slot: 'vision',
      aliasAllowlist: [FREE_ROUTER_MODEL],
      freeRouteOnly: true,
      catalogFailMode: 'closed',
    },
  },
};

/** Every settings key, registry-derived (registry completeness is compile-checked). */
export const SYSTEM_SETTINGS_KEYS = Object.keys(
  SYSTEM_SETTINGS_REGISTRY
) as readonly (keyof SystemSettings)[];

/**
 * The in-code floor beneath the floor: the full resolved bag served before the
 * seed pass has ever run (fresh DB, PGLite tests).
 */
export const SYSTEM_SETTINGS_FALLBACKS: SystemSettings = Object.fromEntries(
  SYSTEM_SETTINGS_KEYS.map(key => [key, SYSTEM_SETTINGS_REGISTRY[key].fallback])
) as SystemSettings;

/**
 * Build the boot-seed bag (the registry fallback set). Called once per
 * api-gateway boot by the race-safe seed pass (insert-if-absent per key — an
 * admin's explicit write is never clobbered).
 */
export function buildSystemSettingsSeed(): SystemSettings {
  // Since env deletion (admin-runtime PR 3) the seed IS the fallback set:
  // existing environments already carry env-derived values in their bag (the
  // seed never clobbers present keys), and fresh environments start from the
  // registry constants. The four floors seed router aliases per owner
  // directives 7/8 — encoded in their fallback constants.
  return { ...SYSTEM_SETTINGS_FALLBACKS };
}

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
