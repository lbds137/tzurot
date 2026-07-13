/**
 * System-settings dashboard definitions — DERIVED from SYSTEM_SETTINGS_REGISTRY
 * (labels, descriptions, groups, choices, bounds all come from the registry;
 * adding setting #18 there makes it appear here with zero dashboard edits).
 *
 * These render as the owner-only System page group inside `/admin settings`
 * (artifact D8), in `statusDisplay: 'plain'` mode — the bag is non-cascading,
 * so no Auto/inherit affordances exist anywhere on these pages.
 */

import {
  SYSTEM_SETTINGS_REGISTRY,
  SYSTEM_SETTINGS_KEYS,
  type SystemSettingMeta,
  type SystemSettingGroup,
} from '@tzurot/common-types/schemas/api/systemSettings';
import { SettingType, type SettingDefinition, type SettingsPage } from './types.js';

/** Page order + labels for the four registry groups (artifact D8). */
const SYSTEM_PAGE_LABELS: Record<SystemSettingGroup, string> = {
  extraction: 'System · Extraction',
  'free-tier-fair-share': 'System · Free Tier — Fair Share',
  'free-tier-zai': 'System · Free Tier — z.ai',
  'models-limits': 'System · Models & Limits',
};

const SYSTEM_GROUP_ORDER: SystemSettingGroup[] = [
  'extraction',
  'free-tier-fair-share',
  'free-tier-zai',
  'models-limits',
];

/** Overview-field emoji per setting (display polish only). */
const SYSTEM_SETTING_EMOJI: Record<string, string> = {
  extractionEnabled: '🧠',
  factsInPromptEnabled: '📋',
  extractionBatchThreshold: '📦',
  extractionModel: '🤖',
  extractionProvider: '🔀',
  freeTierGlobalDailyBudget: '🥧',
  freeTierWindowMinutes: '⏱️',
  freeTierMinPerWindow: '⬇️',
  freeTierMaxPerWindow: '⬆️',
  zaiFreeTierEnabled: '🎟️',
  zaiHeadroomPercent: '🌡️',
  zaiGlobalDailyBudget: '📊',
  publicRateLimitPerMin: '🚦',
  fallbackTextModel: '🛟',
  fallbackVisionModel: '👁️',
  fallbackTextModelFree: '🆓',
  fallbackVisionModelFree: '🖼️',
};

/** Human labels for enum choice values (fall back to the raw value). */
const ENUM_CHOICE_LABELS: Record<string, string> = {
  openrouter: 'OpenRouter',
  'zai-coding': 'z.ai Coding',
};

/** Model-field help text derived from the entry's validation rules. */
function modelHelpText(meta: SystemSettingMeta): string {
  const rules: string[] = [];
  if (meta.model?.freeRouteOnly === true) {
    rules.push('free-route models only (billing firewall)');
  }
  rules.push(
    meta.model?.catalogFailMode === 'closed'
      ? 'must be catalog-verifiable (fails closed when the catalog is unavailable)'
      : 'catalog-checked (warns when the catalog is unavailable)'
  );
  if (meta.model !== undefined && meta.model.aliasAllowlist.length > 0) {
    rules.push(`router aliases accepted: ${meta.model.aliasAllowlist.join(', ')}`);
  }
  return `Validated on save: ${rules.join('; ')}.`;
}

/** Map one registry entry to a dashboard setting definition. */
function toSettingDefinition(meta: SystemSettingMeta): SettingDefinition {
  const base = {
    id: meta.key,
    label: meta.label,
    emoji: SYSTEM_SETTING_EMOJI[meta.key] ?? '⚙️',
    description: meta.description,
    // Non-cascading bag: no override/inherit status, no Auto affordances —
    // rides the DEFINITION so the mixed admin dashboard renders these plain
    // while its cascade pages keep full status display.
    plainDisplay: true,
  };

  switch (meta.control) {
    case 'boolean':
      return { ...base, type: SettingType.BOOLEAN };
    case 'integer':
      return {
        ...base,
        type: SettingType.NUMERIC,
        min: meta.min ?? 1,
        // Always explicit: the modal parser defaults an absent max to 100,
        // which would wrongly reject large budget values.
        max: meta.max ?? Number.MAX_SAFE_INTEGER,
        placeholder:
          meta.max !== undefined ? `${meta.min ?? 1}–${meta.max}` : `min ${meta.min ?? 1}`,
      };
    case 'enum':
      return {
        ...base,
        type: SettingType.ENUM,
        choices: (meta.choices ?? []).map(value => ({
          value,
          label: ENUM_CHOICE_LABELS[value] ?? value,
          emoji: '🔧',
        })),
      };
    case 'model':
      return {
        ...base,
        type: SettingType.TEXT,
        placeholder: 'provider/model-id',
        helpText: modelHelpText(meta),
      };
  }
}

/**
 * All 17 system settings as dashboard definitions, registry order.
 */
export const SYSTEM_SETTINGS_DEFINITIONS: SettingDefinition[] = SYSTEM_SETTINGS_KEYS.map(key =>
  toSettingDefinition(SYSTEM_SETTINGS_REGISTRY[key])
);

/**
 * The four System concern pages (artifact D8), derived from the registry's
 * `group` field, in fixed order.
 */
export const SYSTEM_SETTINGS_PAGES: SettingsPage[] = SYSTEM_GROUP_ORDER.map(group => ({
  id: `system-${group}`,
  label: SYSTEM_PAGE_LABELS[group],
  settingIds: SYSTEM_SETTINGS_KEYS.filter(key => SYSTEM_SETTINGS_REGISTRY[key].group === group).map(
    key => key as string
  ),
}));

/** Registry-membership dispatch: is this settingId a system setting? */
export function isSystemSettingId(settingId: string): boolean {
  return settingId in SYSTEM_SETTINGS_REGISTRY;
}
