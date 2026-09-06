/**
 * System Settings Registry
 *
 * Registry-first: every setting is a SYSTEM_SETTINGS_REGISTRY entry carrying its
 * validator bounds (mirroring the env schema it migrates from), dashboard
 * metadata, seed source, and liveness. The registry powers schema validation,
 * the boot seed pass, write-route validation, dashboard rendering, and the
 * slash setter — one place to add setting #N+1. Design:
 * docs/proposals/backlog/admin-runtime-settings.md.
 */

import {
  AUTO_ROUTER_MODEL,
  FREE_ROUTER_MODEL,
  MODEL_DEFAULTS,
  ROUTER_ALIAS_MODELS,
  ZAI_FREE_TIER_MODEL,
  type ModelSlot,
} from '../../constants/ai.js';
import { MULTI_TAG } from '../../constants/message.js';
import type { SystemSettings } from './systemSettings.js';

/** Dashboard page-group assignment (concern grouping; the dashboard slice owns rendering). */
export type SystemSettingGroup =
  'extraction' | 'free-tier-fair-share' | 'free-tier-zai' | 'models' | 'limits' | 'operations';

const GROUP_EXTRACTION: SystemSettingGroup = 'extraction';
const GROUP_FAIR_SHARE: SystemSettingGroup = 'free-tier-fair-share';
const GROUP_ZAI: SystemSettingGroup = 'free-tier-zai';
/** The four fallback model floors. */
const GROUP_MODELS: SystemSettingGroup = 'models';
/** Numeric/behavioral ceilings: rate limit, sticker spend, multi-character cap. */
const GROUP_LIMITS: SystemSettingGroup = 'limits';
const GROUP_OPERATIONS: SystemSettingGroup = 'operations';

/**
 * `seedSource` for settings with no env-var predecessor — born as system
 * settings rather than migrated into one.
 */
export const SEED_SOURCE_NEW = '(none — introduced as a system setting)';

/** Which input control the setting renders as (dashboard + slash-setter coercion). */
export type SystemSettingControl = 'boolean' | 'integer' | 'enum' | 'model' | 'list';

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

export type SystemSettingsRegistry = {
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
  rosterBlurbEnabled: {
    key: 'rosterBlurbEnabled',
    label: 'Character Roster Blurbs',
    description:
      'Runtime switch for character roster blurbs: the summarizer sweep (per tick) and rendering them in the prompt (per turn). Off stops new spend AND hides stored blurbs.',
    group: GROUP_EXTRACTION,
    control: 'boolean',
    liveness: 'live',
    fallback: false,
    seedSource: SEED_SOURCE_NEW,
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
  archiveSplitRenderPersonalities: {
    key: 'archiveSplitRenderPersonalities',
    label: 'Archive Split Render',
    description:
      'Personality slugs whose memory archive renders split (user turn verbatim + linked facts, assistant prose omitted). Empty = every character renders verbatim.',
    // GROUP_OPERATIONS, not GROUP_EXTRACTION: a rendering-shape switch, same
    // kind as realMessagesEnabled (which chat_log format renders) rather than
    // an extraction-pipeline setting — and GROUP_EXTRACTION was already at the
    // dashboard's 6-settings-per-page design ceiling before this entry.
    group: GROUP_OPERATIONS,
    control: 'list',
    liveness: 'live',
    fallback: [],
    seedSource: SEED_SOURCE_NEW,
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
      'Engine for ALL background model work — fact extraction and roster-blurb summarization both bill it. Switching models must re-run `pnpm eval:extraction` first; the quality gate is model-specific.',
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
      "Which provider bills ALL background model work (fact extraction and roster blurbs); 'zai-coding' requires ZAI_CODING_API_KEY on BOTH ai-worker (bills the calls) and api-gateway (validates writes to this setting).",
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
    // Interpolated, not spelled out: this string renders verbatim into the
    // /admin settings embed, so it must name whatever the piggyback constant
    // currently holds — a hand-written id drifts the moment it moves.
    description: `Share the z.ai piggyback model (${ZAI_FREE_TIER_MODEL}) with guests via the system z.ai coding-plan key.`,
    group: GROUP_ZAI,
    control: 'boolean',
    liveness: 'live',
    fallback: false,
    seedSource: 'ZAI_FREE_TIER_ENABLED',
  },
  stickerVisionEnabled: {
    key: 'stickerVisionEnabled',
    label: 'Sticker Vision',
    description:
      'Vision-describe rasterizable stickers. Instance-funded; one call per sticker, ever.',
    group: GROUP_LIMITS,
    control: 'boolean',
    liveness: 'live',
    // Defaults ON: the feature is the point, and the spend it authorizes is
    // bounded by the number of DISTINCT stickers ever seen rather than by
    // traffic — each one is described once and cached under its immutable
    // snowflake. The switch exists to stop a surprising warmup burst, not
    // because the steady state is expensive.
    fallback: true,
    // No predecessor: this setting is new, not migrated from an env var.
    seedSource: SEED_SOURCE_NEW,
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
    group: GROUP_LIMITS,
    control: 'integer',
    liveness: 'live',
    fallback: 60,
    seedSource: 'PUBLIC_RATE_LIMIT_PER_MIN',
    min: 1,
  },
  multiTagMaxCharacters: {
    key: 'multiTagMaxCharacters',
    label: 'Multi-Character Cap',
    description:
      'How many characters may respond to a single message: the multi-tag fan-out cap (extra tagged characters are dropped with a notice), and the size of the random character sample when a `/chime-in tag:` pool exceeds it. Does not affect `/random`, which always picks one.',
    group: GROUP_LIMITS,
    control: 'integer',
    liveness: 'live',
    // The in-code constant IS the floor here — bot-client falls back to it
    // whenever the gateway read fails or the key is absent, so registry and
    // code cannot disagree about the default.
    fallback: MULTI_TAG.MAX_TAGS,
    // No predecessor: this setting is new, not migrated from an env var.
    seedSource: SEED_SOURCE_NEW,
    min: 1,
    // The mention parser's MAX_POTENTIAL_MENTIONS position-scan bound sits at
    // this same value — raising this ceiling past 10 makes that the binding
    // cap, so raise both together (personalityMentionParser.ts).
    max: 10,
  },
  fallbackTextModel: {
    key: 'fallbackTextModel',
    label: 'Fallback Text Model (paid)',
    description:
      'The paid text floor — runs when every chain above is exhausted. Choose boring, highly-available targets.',
    group: GROUP_MODELS,
    control: 'model',
    liveness: 'live',
    fallback: AUTO_ROUTER_MODEL,
    seedSource: 'DEFAULT_AI_MODEL',
    model: {
      slot: 'text',
      aliasAllowlist: ROUTER_ALIAS_MODELS,
      freeRouteOnly: false,
      catalogFailMode: 'closed',
    },
  },
  fallbackVisionModel: {
    key: 'fallbackVisionModel',
    label: 'Fallback Vision Model (paid)',
    description: 'The paid vision floor — must accept image input.',
    group: GROUP_MODELS,
    control: 'model',
    liveness: 'live',
    fallback: AUTO_ROUTER_MODEL,
    seedSource: 'VISION_FALLBACK_MODEL',
    model: {
      slot: 'vision',
      aliasAllowlist: ROUTER_ALIAS_MODELS,
      freeRouteOnly: false,
      catalogFailMode: 'closed',
    },
  },
  fallbackTextModelFree: {
    key: 'fallbackTextModelFree',
    label: 'Fallback Text Model (free)',
    description:
      'The FREE text floor (guest ladder last resort + quota-degrade retarget). Free-route models only.',
    group: GROUP_MODELS,
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
    group: GROUP_MODELS,
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
  nightlySyncEnabled: {
    key: 'nightlySyncEnabled',
    label: 'Nightly Sync Enabled',
    description: 'Run the scheduled nightly dev↔prod database sync (prod bot only).',
    group: GROUP_OPERATIONS,
    control: 'boolean',
    liveness: 'live',
    // Defaults ON: the scheduled sync is the mechanism that keeps dev usable as
    // a rehearsal of prod, and it is silent when nothing moved. The switch
    // exists to park it during a migration soak, not because the steady state
    // is risky.
    fallback: true,
    // No predecessor: this setting is new, not migrated from an env var.
    seedSource: SEED_SOURCE_NEW,
  },
  nightlySyncHourUtc: {
    key: 'nightlySyncHourUtc',
    label: 'Nightly Sync Hour (UTC)',
    description:
      'UTC hour the nightly database sync fires (7 ≈ 3am US Eastern in summer, 2am in winter).',
    group: GROUP_OPERATIONS,
    control: 'integer',
    liveness: 'live',
    fallback: 7,
    // No predecessor: this setting is new, not migrated from an env var.
    seedSource: SEED_SOURCE_NEW,
    min: 0,
    max: 23,
  },
  realMessagesEnabled: {
    key: 'realMessagesEnabled',
    label: 'Real Messages',
    description:
      'Render conversation history as real user/assistant provider messages instead of <chat_log> XML in the system prompt (prompt-assembly Phase 2 rollout switch).',
    group: GROUP_OPERATIONS,
    control: 'boolean',
    liveness: 'live',
    // Defaults OFF: this is a staged rollout switch for a structural prompt
    // change (§9c of the prompt-assembly design) — flip explicitly, never by
    // a lost DB row silently changing what every persona's prompt looks like.
    fallback: false,
    // No predecessor: this setting is new, not migrated from an env var.
    seedSource: SEED_SOURCE_NEW,
  },
  headerSpoofNeutralizeEnabled: {
    key: 'headerSpoofNeutralizeEnabled',
    label: 'Header Spoof Neutralization',
    description:
      'Convert header-shaped lines in real-message body content to parentheses, so a user cannot forge a platform speaker header. Only takes effect when Real Messages is on; governs the input-side transform only — output-side echo stripping rides Real Messages alone.',
    group: GROUP_OPERATIONS,
    control: 'boolean',
    liveness: 'live',
    // Defaults ON, unlike the rollout switch it rides: this is a hardening
    // measure with no staged-rollout semantics, and a lost DB row must not
    // silently reopen the spoof path on a flag-on deployment. The empirical
    // exit is an owner flip when false-positive volume outweighs the
    // invariant, not a dark default.
    fallback: true,
    // No predecessor: this setting is new, not migrated from an env var.
    seedSource: SEED_SOURCE_NEW,
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
  // With the env vars deleted, the seed IS the fallback set:
  // existing environments already carry env-derived values in their bag (the
  // seed never clobbers present keys), and fresh environments start from the
  // registry constants. The four floors seed router aliases per owner
  // directives 7/8 — encoded in their fallback constants.
  return { ...SYSTEM_SETTINGS_FALLBACKS };
}
