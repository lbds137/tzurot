/**
 * The UX vocabulary registry — entity emojis, badge legend vocabulary, and
 * display sentinels (design-system spec §2.1/§2.2/§2.5).
 *
 * The entity emoji is the entity's IDENTITY across every surface — browse
 * titles, detail/edit views, autocomplete badges, help categories. The view
 * kind is expressed in words, never by swapping the glyph. Badges live in
 * `utils/autocompleteFormat.ts` (`AUTOCOMPLETE_BADGES` is THE badge registry);
 * this module owns the entity register, the per-badge legend words, and the
 * word-first legend builder that replaces hand-written legend strings.
 *
 * Collision rule (§2.2): no glyph may serve as both an entity emoji and a
 * badge — a reader must never wonder which register a glyph is in. The
 * colocated test pins it mechanically. Glyph reuse ACROSS display registers
 * that never co-occur in one string (e.g. ⚠️ as the shadowed badge vs ⚠️ as
 * the renderer's warning severity glyph) is deliberate and allowed.
 */

import { AUTOCOMPLETE_BADGES } from '../utils/autocompleteFormat.js';

/** The entities the design system names. Keys are code-facing, not user copy. */
export type UxEntityKind =
  | 'character'
  | 'persona'
  | 'preset'
  | 'memory'
  | 'history'
  | 'channel'
  | 'model'
  | 'voice'
  | 'apiKey'
  | 'denial'
  | 'shapes';

/**
 * Entity emoji registry (§2.1) — one glyph per entity, everywhere.
 *
 * Notable deliberate assignments:
 * - 👤 persona: reclaimed from "owned by another user" (now 👥 in the badge
 *   register) — roleplay 🎭 belongs to the character.
 * - 💳 API key: keeps the wallet identity; 🔑 is the needs-your-own-key BADGE
 *   and may not double as an entity glyph.
 * - 🎤 voice: the single voice glyph (🎙️ variants collapse onto it).
 * - ⚙️ preset: the single preset glyph (🔧 variants collapse onto it).
 */
export const ENTITY_EMOJI: Readonly<Record<UxEntityKind, string>> = {
  character: '🎭',
  persona: '👤',
  preset: '⚙️',
  memory: '🧠',
  history: '📜',
  channel: '📍',
  model: '🤖',
  voice: '🎤',
  apiKey: '💳',
  denial: '🚫',
  shapes: '🔗',
} as const;

/**
 * Title grammar (§2.1): `{entity emoji} {Title}` — browse titles use the
 * plural noun (`🎭 Characters`), detail views the name (`🎭 Lilith`), edit
 * views `🎭 Editing: Lilith`. Callers compose the title text; this helper
 * only owns the emoji prefix so the pairing can't drift.
 */
export function entityTitle(kind: UxEntityKind, title: string): string {
  return `${ENTITY_EMOJI[kind]} ${title}`;
}

/**
 * Display sentinels (§2.5/D6) — the ONLY sanctioned empty-value strings.
 * `_Not configured_`, `—`, `_none_`, `None`, and `N/A` are retired.
 */
export const UX_SENTINELS = {
  /** Empty/unset field value — italic meta text. */
  NOT_SET: '_Not set_',
  /** Temporal never-happened (e.g. "Last used: Never"). */
  NEVER: 'Never',
} as const;

/**
 * Word-first legend vocabulary — one short word (or two) per badge, keyed by
 * the badge REGISTRY key (not the glyph, since GLOBAL/PUBLIC deliberately
 * share 🌐 — one "everyone" concept surfacing in two naming contexts).
 */
export const BADGE_LEGEND_WORDS: Readonly<Record<keyof typeof AUTOCOMPLETE_BADGES, string>> = {
  GLOBAL: 'Public',
  PUBLIC: 'Public',
  OWNED: 'Private',
  READ_ONLY: 'Read-only',
  OWNED_BY_OTHER: 'Other user',
  DEFAULT: 'Default',
  ACTIVE: 'Active',
  FREE: 'Free',
  LOCKED: 'Locked',
  NEEDS_KEY: 'Needs a key',
  VISION: 'Vision',
  EDITABLE: 'Yours',
  CORRECTED: 'Corrected',
  SHADOWED: 'Shadowed',
} as const;

export type BadgeKey = keyof typeof AUTOCOMPLETE_BADGES;

/**
 * Build a word-first badge legend (§2.2): `Private 🔒 · Locked 🔐` — for
 * exactly the badges present on the surface, in the caller's order. Replaces
 * hand-written `badgeLegend` strings so wording and glyphs can't drift from
 * the registry. Word-first keeps the legend scannable on mobile; keep the
 * badge list to what the embed actually renders.
 */
export function buildBadgeLegend(badges: readonly BadgeKey[]): string {
  return badges.map(key => `${BADGE_LEGEND_WORDS[key]} ${AUTOCOMPLETE_BADGES[key]}`).join(' · ');
}
