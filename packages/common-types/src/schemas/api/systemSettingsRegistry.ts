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
} from '../../constants/ai.js';
import { MULTI_TAG } from '../../constants/message.js';
import type { SystemSettings } from './systemSettings.js';
import { SYSTEM_SETTINGS_REGISTRY_OPERATIONS } from './systemSettingsRegistryOperations.js';
import {
  SEED_SOURCE_NEW,
  type OperationsRegistryKey,
  type SystemSettingGroup,
  type SystemSettingMeta,
  type SystemSettingsRegistry,
} from './systemSettingsRegistryTypes.js';

// Re-exported for existing consumers that import these from this module.
// SystemSettingControl/SystemSettingLiveness/SystemSettingModelMeta are NOT
// re-exported here — nothing imports them via this path (only from
// systemSettingsRegistryTypes.js), and a pure pass-through re-export with no
// consumer trips knip's unused-export check.
export {
  SEED_SOURCE_NEW,
  type SystemSettingGroup,
  type SystemSettingMeta,
  type SystemSettingsRegistry,
};

const GROUP_EXTRACTION: SystemSettingGroup = 'extraction';
const GROUP_FAIR_SHARE: SystemSettingGroup = 'free-tier-fair-share';
const GROUP_ZAI: SystemSettingGroup = 'free-tier-zai';
/** The four fallback model floors. */
const GROUP_MODELS: SystemSettingGroup = 'models';
/** Numeric/behavioral ceilings: rate limit, sticker spend, multi-character cap. */
const GROUP_LIMITS: SystemSettingGroup = 'limits';
// GROUP_OPERATIONS and GROUP_MEMORY_ARCHIVE are declared in
// systemSettingsRegistryOperations.ts, which owns every entry in both groups.

/**
 * The core registry entries. The mapped type forces one entry per REMAINING
 * schema key (everything except `OperationsRegistryKey`) — adding a schema
 * field without a registry entry somewhere (here or in the operations
 * module) is a compile error.
 */
const SYSTEM_SETTINGS_REGISTRY_CORE: {
  readonly [K in Exclude<keyof SystemSettings, OperationsRegistryKey>]: SystemSettingMeta<K>;
} = {
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
};

/**
 * The full registry: core entries above, plus the `operations` and
 * `memory-archive` group entries split into their own module purely to stay
 * under the `max-lines` limit (see that module's header comment).
 */
export const SYSTEM_SETTINGS_REGISTRY: SystemSettingsRegistry = {
  ...SYSTEM_SETTINGS_REGISTRY_CORE,
  ...SYSTEM_SETTINGS_REGISTRY_OPERATIONS,
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
