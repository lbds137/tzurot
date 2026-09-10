/**
 * Which accounts a retention purge may erase in THIS environment.
 *
 * `users` carries an AFTER DELETE sync tombstone trigger, and the dev<->prod
 * db-sync executes the other side's tombstoned deletes. Dev has no organic
 * traffic, so its eligibility runs on unrepresentative activity data: an
 * unscoped dev purge of someone active in prod could delete that prod account
 * at the next sync, with no notice and no character re-homing (users-tombstone
 * propagation is pinned by DatabaseSyncService.component.test.ts; that a prod
 * row's activity stamps, which bypass updated_at, cannot save it from the
 * tombstone is code-read, not runtime-verified). The tombstones
 * themselves must stay — a prod purge has to reach dev, or the sync would
 * resurrect the row — so the guard is scope, not suppression.
 *
 * The purge therefore gets the same scope the notify side already has, from
 * the same source (`getOutboundDmAllowlist`, the single gate every outbound
 * feature consults):
 *
 *   - allowlist set            → only allowlisted Discord ids (any env)
 *   - allowlist unset, prod    → unrestricted
 *   - allowlist unset, non-prod → nobody (fail closed: a dev gateway that lost
 *     its allowlist must not purge unscoped)
 *
 * In a scoped environment the hard-ceiling breaker is NOT the safety
 * mechanism: its numerator is the scope-narrowed eligible count while its
 * denominator stays the whole userbase, so a small allowlist cannot trip it
 * even when every allowlisted account is eligible. What bounds a scoped
 * run's blast radius is scope membership itself (plus the CLI's confirmation
 * prompt).
 */

import { getConfig } from '@tzurot/common-types/config/config';
import { getOutboundDmAllowlist } from '@tzurot/common-types/utils/outboundDmAllowlist';

export type PurgeScope =
  | { kind: 'unrestricted' }
  | { kind: 'allowlist'; discordIds: ReadonlySet<string> }
  | { kind: 'unscoped_non_production' };

/** Why a target is out of scope — doubles as the purge's skip reason. */
export type PurgeScopeRefusal = 'outside_allowlist' | 'unscoped_non_production';

/** Resolve this environment's purge scope (read per call, like the notify side). */
export function resolvePurgeScope(): PurgeScope {
  const allowlist = getOutboundDmAllowlist();
  if (allowlist !== null) {
    return { kind: 'allowlist', discordIds: allowlist };
  }
  return getConfig().NODE_ENV === 'production'
    ? { kind: 'unrestricted' }
    : { kind: 'unscoped_non_production' };
}

/**
 * The SQL narrowing for a scope, in the shape the eligibility queries take:
 * `null` = unrestricted, and an EMPTY set selects nobody — which is how the
 * fail-closed scope makes the preview and the ceiling count describe exactly
 * what the run can erase.
 */
export function purgeScopeAllowlist(scope: PurgeScope): ReadonlySet<string> | null {
  switch (scope.kind) {
    case 'unrestricted':
      return null;
    case 'allowlist':
      return scope.discordIds;
    case 'unscoped_non_production':
      return new Set<string>();
  }
}

/** Why this target may not be purged here, or null when it is in scope. */
export function purgeScopeRefusal(scope: PurgeScope, discordId: string): PurgeScopeRefusal | null {
  if (scope.kind === 'unscoped_non_production') {
    return 'unscoped_non_production';
  }
  if (scope.kind === 'allowlist' && !scope.discordIds.has(discordId)) {
    return 'outside_allowlist';
  }
  return null;
}
