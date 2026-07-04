/**
 * Preset browse filter encoding.
 *
 * `/preset browse` has two orthogonal filter axes — a scope (all/global/mine/free)
 * and a capability (all/text/vision) — but Discord pagination buttons carry a
 * single `filter` customId segment. We pack both into one `scope.capability` token
 * (e.g. `global.vision`) so the shared customId factory can treat it as an opaque
 * filter string with no factory change. This module is the ONLY place that knows
 * the encoding; everything else passes the composite around verbatim.
 */

import { CONFIG_KINDS } from '@tzurot/common-types/constants/ai';

// Single source of truth for each axis: the runtime arrays drive the types
// (`typeof[number]`) AND the customId factory's validation, so the two can't
// drift. Adding a scope/capability value here updates both with no second edit.
const PRESET_SCOPE_FILTERS = ['all', 'global', 'mine', 'free'] as const;
// The capability values reuse CONFIG_KINDS ('text'/'vision') as the encoded
// tokens so the customId format is unchanged from when this axis was a config
// `kind` — but they're now interpreted as a model-capability filter, not a kind.
const PRESET_CAPABILITY_FILTERS = ['all', ...CONFIG_KINDS] as const;

/** Scope axis of the browse filter (independent of capability). */
export type PresetScopeFilter = (typeof PRESET_SCOPE_FILTERS)[number];
/** Capability axis — `'all'` means no capability filter (derived from CONFIG_KINDS). */
export type PresetCapabilityFilter = (typeof PRESET_CAPABILITY_FILTERS)[number];

/**
 * The packed `scope.capability` token stored in the customId's single filter
 * segment. {@link splitBrowseFilter} / {@link composeBrowseFilter} are the
 * encode/decode boundary.
 */
export type PresetBrowseFilter = `${PresetScopeFilter}.${PresetCapabilityFilter}`;

/** Every valid `scope.capability` composite (the customId factory validates against this). */
export const VALID_PRESET_FILTERS: readonly PresetBrowseFilter[] = PRESET_SCOPE_FILTERS.flatMap(
  scope =>
    PRESET_CAPABILITY_FILTERS.map((capability): PresetBrowseFilter => `${scope}.${capability}`)
);

export function composeBrowseFilter(
  scope: PresetScopeFilter,
  capability: PresetCapabilityFilter
): PresetBrowseFilter {
  return `${scope}.${capability}`;
}

export function splitBrowseFilter(filter: PresetBrowseFilter): {
  scope: PresetScopeFilter;
  capability: PresetCapabilityFilter;
} {
  const [scope, capability] = filter.split('.') as [
    PresetScopeFilter,
    PresetCapabilityFilter | undefined,
  ];
  // Defensive boundary guard for this exported helper. The customId factory
  // validates against VALID_PRESET_FILTERS before any caller reaches here, so a
  // well-formed token always carries a capability segment — but if a malformed or
  // future-format token ever does slip through, default the missing segment to
  // "all" so the listing degrades gracefully instead of silently narrowing.
  return { scope, capability: capability ?? 'all' };
}

const SCOPE_LABELS: Record<PresetScopeFilter, string> = {
  all: 'All',
  global: 'Global Only',
  mine: 'My Presets',
  free: 'Free Only',
};

// This axis is a capability check, not a fetch-scope parameter: 'vision'/'text'
// are applied client-side off each row's `supportsVision`. The encoded values
// stay 'text'/'vision' intentionally so the customId format is unchanged.
const CAPABILITY_LABELS: Record<PresetCapabilityFilter, string> = {
  // `all` is present for Record completeness; describeFilter skips the axis when
  // it's 'all', so this label isn't rendered today.
  all: 'All Models',
  text: 'Text-only Models',
  vision: 'Vision-capable Models',
};

/**
 * Human-readable label for the active filter, or null when neither axis is
 * narrowed (so callers can suppress the "Filter:" line entirely).
 */
export function describeFilter(
  scope: PresetScopeFilter,
  capability: PresetCapabilityFilter
): string | null {
  const parts: string[] = [];
  if (scope !== 'all') {
    parts.push(SCOPE_LABELS[scope]);
  }
  if (capability !== 'all') {
    parts.push(CAPABILITY_LABELS[capability]);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}
