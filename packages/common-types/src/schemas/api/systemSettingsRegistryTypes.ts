/**
 * System Settings Registry — shared types
 *
 * Split out of `systemSettingsRegistry.ts` so the registry's `operations`/
 * `memory-archive` entries can live in their own module
 * (`systemSettingsRegistryOperations.ts`, split to stay under `max-lines`)
 * WITHOUT a runtime circular import: both `systemSettingsRegistry.ts` and
 * `systemSettingsRegistryOperations.ts` import from here, and this module
 * imports from neither of them. `dependency-cruiser`'s circular-dependency
 * check does not special-case type-only imports, so a genuine module split
 * — not just `import type` — is what breaks the cycle.
 */

import type { ModelSlot } from '../../constants/ai.js';
import type { SystemSettings } from './systemSettings.js';

/** Dashboard page-group assignment (concern grouping; the dashboard slice owns rendering). */
export type SystemSettingGroup =
  | 'extraction'
  | 'free-tier-fair-share'
  | 'free-tier-zai'
  | 'models'
  | 'limits'
  | 'operations'
  | 'memory-archive';

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

/** Keys carried by `systemSettingsRegistryOperations.ts` rather than the core registry. */
export type OperationsRegistryKey =
  | 'archiveSplitRenderPersonalities'
  | 'archiveSummaryEnqueueEnabled'
  | 'archiveSummaryModelEnabled'
  | 'archiveSummaryDailyCap'
  | 'nightlySyncEnabled'
  | 'nightlySyncHourUtc'
  | 'realMessagesEnabled'
  | 'headerSpoofNeutralizeEnabled';
