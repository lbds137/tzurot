/**
 * Deny Scope + Target Derivation
 *
 * The `/deny add` and `/deny remove` subcommand groups are scope-first: the
 * subcommand name IS the denial scope, and the entity type is derived from
 * which target option was filled (`user:` → USER, `server:` → GUILD).
 *
 * Only the `everywhere` subcommand exposes `server:`, so a server denial in a
 * narrow scope is unrepresentable in the picker rather than rejected after
 * submit.
 */

import { escapeMarkdown } from 'discord.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

export type DenyScope = 'BOT' | 'GUILD' | 'CHANNEL' | 'PERSONALITY';
export type DenyEntityType = 'USER' | 'GUILD';

/** Subcommand name → denial scope. `this-server` reads as the scope; `server:` is the entity. */
const SCOPE_BY_SUBCOMMAND: Record<string, DenyScope> = {
  everywhere: 'BOT',
  'this-server': 'GUILD',
  channel: 'CHANNEL',
  character: 'PERSONALITY',
};

/** Resolve the denial scope a subcommand name selects, or null if it isn't one of the four. */
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
 * Derive the entity type and target ID from the filled option.
 *
 * Discord cannot express "exactly one of these two options", so the XOR is
 * checked here: `user` and `server` are both optional on `everywhere`, and
 * `server` does not exist on the other three subcommands.
 */
export function resolveDenyTarget(context: DeferredCommandContext): DenyTargetResult {
  const user = context.interaction.options.getUser('user');
  const rawServerId = context.getOption<string>('server');
  const serverId = rawServerId === null || rawServerId === undefined ? '' : rawServerId.trim();

  if (user !== null && serverId.length > 0) {
    return {
      ok: false,
      message: 'Provide either `user` or `server`, not both.',
    };
  }

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

  // Reachable only from `everywhere` in practice — `user` is required on the
  // other three subcommands — but worded to read correctly on any of them,
  // since `server` is named as the alternative rather than assumed available.
  return {
    ok: false,
    message: 'Pick a `user`. On `everywhere` you may supply a `server` ID instead.',
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
