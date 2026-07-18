/**
 * Alias browse data model: the normalized row shape both endpoints map
 * into, the scope-filter vocabulary, and the filter-cycle function behind
 * the design system's first in-place filter toggle.
 */

import type { AliasScope } from '@tzurot/common-types/schemas/api/personality';
import type { UserClient } from '@tzurot/clients';

export const ALIAS_FILTERS = ['all', 'mine', 'global'] as const;
export type AliasFilter = (typeof ALIAS_FILTERS)[number];

/** One row of either browse mode, normalized. */
export interface AliasRow {
  alias: string;
  scope: AliasScope;
  /** Only the my-aliases endpoint computes this; per-character rows never ⚠️. */
  shadowed: boolean;
  /** Character context — name only known in my-aliases mode. */
  character: { name: string | null; slug: string };
}

export interface FetchedAliases {
  rows: AliasRow[];
  truncated: boolean;
}

/** Fetch the mode's rows: per-character (slug) or cross-character (null). */
export async function fetchAliasRows(
  userClient: UserClient,
  slug: string | null
): Promise<{ ok: true; data: FetchedAliases } | { ok: false; status: number; error: string }> {
  if (slug !== null) {
    const result = await userClient.listPersonalityAliases(slug);
    if (!result.ok) {
      return { ok: false, status: result.status, error: result.error ?? 'Unknown' };
    }
    return {
      ok: true,
      data: {
        rows: result.data.aliases.map(entry => ({
          alias: entry.alias,
          scope: entry.scope,
          shadowed: false,
          character: { name: null, slug },
        })),
        truncated: result.data.truncated,
      },
    };
  }

  const result = await userClient.listMyAliases();
  if (!result.ok) {
    return { ok: false, status: result.status, error: result.error ?? 'Unknown' };
  }
  return {
    ok: true,
    data: {
      rows: result.data.aliases.map(entry => ({
        alias: entry.alias,
        scope: entry.scope,
        shadowed: entry.shadowed,
        character: { name: entry.personality.name, slug: entry.personality.slug },
      })),
      truncated: result.data.truncated,
    },
  };
}

export function applyFilter(rows: AliasRow[], filter: AliasFilter): AliasRow[] {
  if (filter === 'mine') {
    return rows.filter(row => row.scope === 'user');
  }
  if (filter === 'global') {
    return rows.filter(row => row.scope === 'global');
  }
  return rows;
}

/** The design system's first in-place filter toggle: all → mine → global. */
export function nextAliasFilter(filter: AliasFilter): AliasFilter {
  const index = ALIAS_FILTERS.indexOf(filter);
  return ALIAS_FILTERS[(index + 1) % ALIAS_FILTERS.length];
}
