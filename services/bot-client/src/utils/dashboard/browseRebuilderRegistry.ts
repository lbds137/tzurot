// Module-level registry mapping each browse-capable command to an adapter that
// rebuilds its browse view from a preserved BrowseContext. Keyed by the closed
// `BrowseCapableEntityType` union (NOT `string`) so typos fail at compile time
// rather than silently returning undefined at runtime.
//
// Why a registry instead of a callback on BrowseContext: DashboardSession data
// is Redis-backed JSON. Functions don't serialize, so storing the adapter on
// the session would become `undefined` on rehydration. The registry lives in
// process memory and is populated at module-load time via
// `registerBrowseRebuilder` calls at the bottom of each command's browse.ts.

import type { ButtonInteraction, MessageEditOptions } from 'discord.js';
import type { BrowseCapableEntityType } from './terminalScreen.js';
import type { BrowseContext } from './types.js';

/**
 * The shape of a rebuilt browse view, narrow-matched to what
 * `interaction.editReply` accepts. Each command's adapter assembles this from
 * its own `buildBrowseResponse` + any required pre-fetch (deny fetches entries
 * first, character needs the `client` + config, etc.).
 *
 * Returning `null` signals "rebuild failed" — caller (postActionScreen /
 * sharedBackButtonHandler) falls through to the error terminal.
 */
export type BrowseRebuildResult = Pick<MessageEditOptions, 'content' | 'embeds' | 'components'>;

/**
 * Command-specific adapter. Takes the live interaction (for `client`,
 * `user.id`, and access to `interaction.editReply` context if needed), the
 * preserved browse coordinates, and an optional success banner to render as
 * the `content` field above the rebuilt browse embed. Returns the message
 * payload for `editReply`, or `null` if the rebuild itself failed.
 */
export type BrowseRebuilder = (
  interaction: ButtonInteraction,
  browseContext: BrowseContext,
  successBanner?: string
) => Promise<BrowseRebuildResult | null>;

const registry = new Map<BrowseCapableEntityType, BrowseRebuilder>();

/**
 * Register a browse-rebuilder for an entity type. Idempotent for the same
 * function reference (tolerates module re-import in tests), but throws on
 * registering a different function for a type that's already registered —
 * that usually indicates two commands claiming the same key, which would
 * produce silent dispatch errors at runtime.
 */
export function registerBrowseRebuilder(
  entityType: BrowseCapableEntityType,
  rebuilder: BrowseRebuilder
): void {
  const existing = registry.get(entityType);
  if (existing !== undefined && existing !== rebuilder) {
    throw new Error(
      `BrowseRebuilder conflict for entity type "${entityType}": a different rebuilder is already registered. ` +
        `This usually indicates two commands claiming the same BrowseCapableEntityType key.`
    );
  }
  registry.set(entityType, rebuilder);
}

/**
 * Look up the registered rebuilder for an entity type. Returns `undefined`
 * when nothing is registered — callers must handle this case explicitly
 * (postActionScreen logs a warning and falls through to error terminal).
 */
export function getBrowseRebuilder(
  entityType: BrowseCapableEntityType
): BrowseRebuilder | undefined {
  return registry.get(entityType);
}

/**
 * Test-only helper to reset the registry between test cases. Production code
 * never calls this.
 */
export function clearBrowseRegistry(): void {
  registry.clear();
}
