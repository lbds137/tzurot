/**
 * Preset browse filter encoding.
 *
 * `/preset browse` has two orthogonal filter axes — a scope (all/global/mine/free)
 * and a kind (all/text/vision) — but Discord pagination buttons carry a single
 * `filter` customId segment. We pack both into one `scope.kind` token (e.g.
 * `global.vision`) so the shared customId factory can treat it as an opaque
 * filter string with no factory change. This module is the ONLY place that knows
 * the encoding; everything else passes the composite around verbatim.
 */

import { CONFIG_KINDS } from '@tzurot/common-types';

// Single source of truth for each axis: the runtime arrays drive the types
// (`typeof[number]`) AND the customId factory's validation, so the two can't
// drift. Adding a scope/kind value here updates both with no second edit.
const PRESET_SCOPE_FILTERS = ['all', 'global', 'mine', 'free'] as const;
const PRESET_KIND_FILTERS = ['all', ...CONFIG_KINDS] as const;

/** Scope axis of the browse filter (independent of kind). */
export type PresetScopeFilter = (typeof PRESET_SCOPE_FILTERS)[number];
/** Kind axis of the browse filter — `'all'` means both kinds (derived from CONFIG_KINDS). */
export type PresetKindFilter = (typeof PRESET_KIND_FILTERS)[number];

/**
 * The packed `scope.kind` token stored in the customId's single filter segment.
 * {@link splitBrowseFilter} / {@link composeBrowseFilter} are the encode/decode
 * boundary.
 */
export type PresetBrowseFilter = `${PresetScopeFilter}.${PresetKindFilter}`;

/** Every valid `scope.kind` composite (the customId factory validates against this). */
export const VALID_PRESET_FILTERS: readonly PresetBrowseFilter[] = PRESET_SCOPE_FILTERS.flatMap(
  scope => PRESET_KIND_FILTERS.map((kind): PresetBrowseFilter => `${scope}.${kind}`)
);

export function composeBrowseFilter(
  scope: PresetScopeFilter,
  kind: PresetKindFilter
): PresetBrowseFilter {
  return `${scope}.${kind}`;
}

export function splitBrowseFilter(filter: PresetBrowseFilter): {
  scope: PresetScopeFilter;
  kind: PresetKindFilter;
} {
  const [scope, kind] = filter.split('.') as [PresetScopeFilter, PresetKindFilter | undefined];
  // Defensive boundary guard for this exported helper. The customId factory
  // validates against VALID_PRESET_FILTERS before any caller reaches here, so a
  // well-formed token always carries a kind segment — but if a malformed or
  // future-format token ever does slip through, default the missing segment to
  // "all kinds" so the listing degrades gracefully instead of silently
  // narrowing to the gateway's text default.
  return { scope, kind: kind ?? 'all' };
}

const SCOPE_LABELS: Record<PresetScopeFilter, string> = {
  all: 'All',
  global: 'Global Only',
  mine: 'My Presets',
  free: 'Free Only',
};

const KIND_LABELS: Record<PresetKindFilter, string> = {
  // `all` is present for Record completeness; describeFilter skips the kind axis
  // when kind === 'all', so this label isn't rendered today — it's the slot a
  // future "both kinds selected" display would use.
  all: 'All Kinds',
  text: 'Text Only',
  vision: 'Vision Only',
};

/**
 * Human-readable label for the active filter, or null when neither axis is
 * narrowed (so callers can suppress the "Filter:" line entirely).
 */
export function describeFilter(scope: PresetScopeFilter, kind: PresetKindFilter): string | null {
  const parts: string[] = [];
  if (scope !== 'all') {
    parts.push(SCOPE_LABELS[scope]);
  }
  if (kind !== 'all') {
    parts.push(KIND_LABELS[kind]);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}
