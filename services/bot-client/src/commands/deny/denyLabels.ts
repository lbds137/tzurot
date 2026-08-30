/**
 * Deny Command Display Labels
 *
 * Single source for every user-facing display string derived from a
 * denylist enum (`DenylistEntityType`, `DenylistScope`, `DenylistMode`),
 * plus the inverse parse for the one surface that accepts a typed scope
 * (`parseScopeInput`, used by the edit modal).
 *
 * Enum values themselves stay untouched in the DB and in every comparison:
 * callers compare raw enums and take only display text from these maps
 * (`browse.ts` tests `entry.mode === 'MUTE'`, then reads `MODE_LABELS.MUTE`
 * for the label). `parseScopeInput` maps a label back onto the canonical
 * enum rather than defining one, so the schema stays the source of truth
 * for the values themselves — this module owns how they READ, never what
 * they ARE.
 */

import {
  type DenylistEntityType,
  type DenylistScope,
  type DenylistMode,
} from '@tzurot/common-types/schemas/api/denylist';

/** Display label for each entity type. `Record<Enum, string>` breaks the build if the union grows. */
export const TYPE_LABELS: Record<DenylistEntityType, string> = {
  USER: 'User',
  GUILD: 'Server',
};

/** Display label for each denial mode. `Record<Enum, string>` breaks the build if the union grows. */
export const MODE_LABELS: Record<DenylistMode, string> = {
  BLOCK: 'Block',
  MUTE: 'Mute',
};

/** Display label for each scope. `Record<Enum, string>` breaks the build if the union grows. */
export const SCOPE_LABELS: Record<DenylistScope, string> = {
  BOT: 'Bot-wide',
  GUILD: 'Server',
  CHANNEL: 'Channel',
  PERSONALITY: 'Character',
};

/**
 * Human-readable list of scope labels for modal placeholder + error copy,
 * derived from `SCOPE_LABELS` so the two can't drift: "Bot-wide, Server,
 * Channel, or Character" (pinned exactly in the colocated test).
 *
 * `Intl.ListFormat` rather than a hand-rolled join: it produces the identical
 * string for the current four scopes, and handles the 0/1/2-element cases
 * natively instead of needing a guard branch no input can reach. It is also
 * the more correct of the two at two elements — a hand-rolled Oxford join
 * emits "A, or B" where English wants "A or B".
 */
export const SCOPE_LABEL_LIST: string = new Intl.ListFormat('en', {
  style: 'long',
  type: 'disjunction',
}).format(Object.values(SCOPE_LABELS));

/**
 * Format a scope for display, including its scope ID where relevant.
 * `BOT` scope has no meaningful ID (always `*`), so it renders alone.
 * The detail card wraps the ID in backticks (`monospaceId: true`) to match
 * its Target field, while the browse list renders the ID plain.
 */
export function formatScopeWithId(
  scope: DenylistScope,
  scopeId: string,
  options: { monospaceId?: boolean } = {}
): string {
  if (scope === 'BOT') {
    return SCOPE_LABELS.BOT;
  }
  const renderedId = options.monospaceId === true ? `\`${scopeId}\`` : scopeId;
  return `${SCOPE_LABELS[scope]}: ${renderedId}`;
}

/** Reverse lookup: uppercased canonical enum name AND uppercased display label → canonical scope. */
const SCOPE_INPUT_LOOKUP: ReadonlyMap<string, DenylistScope> = new Map(
  (Object.keys(SCOPE_LABELS) as DenylistScope[]).flatMap(scope => [
    [scope.toUpperCase(), scope],
    [SCOPE_LABELS[scope].toUpperCase(), scope],
  ])
);

/**
 * Parse user-supplied scope text, accepting either the canonical enum name
 * (`'GUILD'`) or the display label (`'Server'`), trimmed and case-insensitive.
 * Returns `null` for anything unrecognized.
 */
export function parseScopeInput(raw: string): DenylistScope | null {
  const key = raw.trim().toUpperCase();
  return SCOPE_INPUT_LOOKUP.get(key) ?? null;
}

/**
 * Case-insensitive lookup into `TYPE_LABELS`. Returns the input unchanged
 * when it is not a recognized type — defensive for a value Discord's own
 * choice list cannot actually produce; not verified as reachable at runtime.
 *
 * `Object.hasOwn` over `key in TYPE_LABELS` is idiom rather than defense here,
 * and the two are indistinguishable by test: the lookup key is uppercased, and
 * every `Object.prototype` key contains a lowercase letter, so no input can
 * reach one. It matches `parseScopeInput`'s derive-from-the-map shape, which is
 * the property that matters — a new `DenylistEntityType` is picked up by the
 * `Record` rather than by a literal comparison this function would not have.
 */
export function formatTypeLabel(raw: string): string {
  const key = raw.toUpperCase();
  return Object.hasOwn(TYPE_LABELS, key) ? TYPE_LABELS[key as DenylistEntityType] : raw;
}
