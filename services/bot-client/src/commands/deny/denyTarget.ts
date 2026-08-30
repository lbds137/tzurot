/**
 * Deny Scope + Target Derivation
 *
 * The `/deny add` and `/deny remove` subcommand groups are scope-first: the
 * subcommand name selects the denial scope, and for BOT scope it additionally
 * selects the target type (`everywhere` → a user, `server` → a whole server).
 *
 * These two groups offer a server target at BOT scope only — that is a property
 * of THIS surface, not of the stored data. The detail edit modal writes scope
 * through `validateEditInput` (`detailEdit.ts`), which accepts any of the four
 * scopes without consulting the entry's entity type, so a stored GUILD-type
 * entry at a narrower scope is reachable by that path. Do not treat "server
 * denials are bot-wide" as an invariant when reading denylist rows.
 */

import { escapeMarkdown } from 'discord.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

export type DenyScope = 'BOT' | 'GUILD' | 'CHANNEL' | 'PERSONALITY';
export type DenyEntityType = 'USER' | 'GUILD';

/**
 * Subcommand name → denial scope. Two names collapse to BOT and are told apart
 * by target type, not scope: `everywhere` denies a user, `server` denies a whole
 * server. `this-server` is the narrower GUILD scope — a different question from
 * either, despite reading similarly to `server`.
 */
const SCOPE_BY_SUBCOMMAND: Record<string, DenyScope> = {
  everywhere: 'BOT',
  server: 'BOT',
  'this-server': 'GUILD',
  channel: 'CHANNEL',
  character: 'PERSONALITY',
};

/** Resolve the denial scope a subcommand name selects, or null if it isn't one of the five. */
export function scopeForSubcommand(subcommand: string | null): DenyScope | null {
  if (subcommand === null) {
    return null;
  }
  return SCOPE_BY_SUBCOMMAND[subcommand] ?? null;
}

export interface DenyTarget {
  type: DenyEntityType;
  discordId: string;
  /**
   * Confirmation-ready description of the target. For a user this names the
   * display name, the account handle AND the snowflake, so the reader can tell
   * which account was acted on without a second lookup.
   */
  display: string;
}

export type DenyTargetResult = { ok: true; target: DenyTarget } | { ok: false; message: string };

/**
 * Derive the entity type and target ID from whichever single target option
 * the subcommand exposed.
 */
export function resolveDenyTarget(context: DeferredCommandContext): DenyTargetResult {
  const user = context.interaction.options.getUser('user');
  const rawServerId = context.getOption<string>('server');
  const serverId = rawServerId === null || rawServerId === undefined ? '' : rawServerId.trim();

  if (user !== null) {
    return {
      ok: true,
      target: {
        type: 'USER',
        discordId: user.id,
        display: `**${escapeMarkdown(user.displayName)}** (@${escapeMarkdown(user.username)} · \`${user.id}\`)`,
      },
    };
  }

  if (serverId.length > 0) {
    return {
      ok: true,
      target: {
        type: 'GUILD',
        discordId: serverId,
        display: `server \`${escapeMarkdown(serverId)}\``,
      },
    };
  }

  // Defensive only: every scope subcommand requires its single target option,
  // so Discord's own validation should make this branch unreachable in
  // practice. The unit test reaches it by constructing a context with
  // neither option filled.
  //
  // The message names no group verb. Both `handleAdd` and `handleRemove` route
  // here, so naming one ("use `/deny add server`") would hand the wrong command
  // to the other's caller. Pinned by denyTarget.test.ts, "names no group verb
  // in the no-target message".
  return {
    ok: false,
    message:
      'No target supplied. Pick a `user`, or use the `server` subcommand for a whole server.',
  };
}

/** Plain-words rendering of the scope, for the confirmation line. */
export function describeDenyScope(
  scope: DenyScope,
  details: { channelId: string | null; character: string | null }
): string {
  switch (scope) {
    case 'BOT':
      return 'everywhere (every server and DM)';
    case 'GUILD':
      return 'in this server';
    case 'CHANNEL':
      return details.channelId === null ? 'in this channel' : `in <#${details.channelId}>`;
    case 'PERSONALITY':
      return details.character === null || details.character.length === 0
        ? 'for this character'
        : `for the character **${escapeMarkdown(details.character)}**`;
  }
}
