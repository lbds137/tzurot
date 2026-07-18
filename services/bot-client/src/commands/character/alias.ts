/**
 * /character alias — slash entry points for the alias subcommand group.
 *
 * The group's two subcommands: `browse [character]` (the design-system
 * pilot browse — rendering and component handling live in aliasBrowse.ts)
 * and `add` (Tier-0 inline options — character + alias + optional scope;
 * no modal). Global scope is bot-owner-only, enforced by the gateway — a
 * non-owner passing it gets the permission-denied surface.
 */

import { escapeMarkdown } from 'discord.js';
import type { AliasScope } from '@tzurot/common-types/schemas/api/personality';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { renderSpec } from '../../ux/render/render.js';
import { describeAliasFailure, renderAliasBrowse } from './aliasBrowse.js';

/** /character alias browse [character] */
export async function handleAliasBrowse(context: DeferredCommandContext): Promise<void> {
  const slug = context.interaction.options.getString('character');
  const { userClient } = clientsFor(context.interaction);
  await renderAliasBrowse(context, userClient, { page: 0, filter: 'all', query: slug });
}

/** /character alias add — Tier-0 inline options, no modal. */
export async function handleAliasAdd(context: DeferredCommandContext): Promise<void> {
  const slug = context.interaction.options.getString('character', true);
  const alias = context.interaction.options.getString('alias', true).trim();
  const scope = (context.interaction.options.getString('scope') ?? 'user') as AliasScope;
  const { userClient } = clientsFor(context.interaction);

  const result = await userClient.addPersonalityAlias(slug, { alias, scope });
  if (!result.ok) {
    await context.editReply(describeAliasFailure(result.status, result.error ?? 'Unknown'));
    return;
  }

  const badge = result.data.alias.scope === 'global' ? '🌐' : '🔒';
  await context.editReply(
    renderSpec(
      CATALOG.success.banner(
        'Added alias',
        `${badge} \`@${escapeMarkdown(result.data.alias.alias)}\` → ${escapeMarkdown(slug)}`
      )
    )
  );
}
