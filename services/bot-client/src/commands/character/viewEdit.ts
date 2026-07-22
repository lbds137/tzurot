/**
 * View → Edit transition: the Edit button on /character view opens the edit
 * dashboard for a character the viewer can edit (owner or bot admin —
 * server-computed canEdit, re-checked at click time).
 *
 * The classic embed view is edited into the dashboard in place (both are
 * ephemeral embed messages). A Components-V2 view message cannot host the
 * embed dashboard — the IsComponentsV2 flag is permanent on the message and
 * forbids embeds on later edits — so that path opens the dashboard as a
 * fresh ephemeral reply instead.
 */

import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { type EnvConfig } from '@tzurot/common-types/config/config';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { isBotOwner } from '@tzurot/common-types/utils/ownerMiddleware';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import type { MessageSpec } from '../../ux/catalog/types.js';
import { replySpec, followUpSpec } from '../../ux/render/reply.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import {
  buildDashboardEmbed,
  buildDashboardComponents,
  getSessionManager,
} from '../../utils/dashboard/index.js';
import { fetchCharacter } from './api.js';
import {
  getCharacterDashboardConfig,
  buildCharacterDashboardOptions,
  type CharacterSessionData,
} from './config.js';

const logger = createLogger('character-view-edit');

/**
 * Handle the view screen's Edit button.
 */
export async function handleViewEdit(
  interaction: ButtonInteraction,
  slug: string,
  config: EnvConfig
): Promise<void> {
  // Synchronous flag read before the ack: the ack SHAPE depends on it
  // (deferUpdate edits in place; a V2 source needs a new ephemeral reply).
  const sourceIsV2 = interaction.message.flags.has(MessageFlags.IsComponentsV2);
  if (sourceIsV2) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } else {
    await interaction.deferUpdate();
  }

  // Error delivery must fork the SAME way the ack did. After deferUpdate,
  // editReply (which replySpec resolves to) would overwrite the character-view
  // message with a bare error — so the deferUpdate branch follows up ephemerally
  // and leaves the view intact. After deferReply, replySpec fills the ephemeral
  // placeholder (correct). See reply.ts replySpec/followUpSpec JSDoc.
  const deliverError = (spec: MessageSpec): Promise<void> =>
    sourceIsV2 ? replySpec(interaction, spec) : followUpSpec(interaction, spec);

  try {
    const { userClient } = clientsFor(interaction);
    const character = await fetchCharacter(slug, config, userClient);
    if (!character) {
      await deliverError(CATALOG.error.notFound('Character'));
      return;
    }
    if (!character.canEdit) {
      // Stale button after a permission change — name the state instead of
      // rendering a dashboard the gateway would reject every write to.
      await deliverError(
        CATALOG.error.validation("You don't have permission to edit this character.")
      );
      return;
    }

    // isAdmin gates the bot-owner-only Admin Settings section; it is NOT
    // canEdit (which is true for any character owner). Every other
    // dashboard-opening path derives it from isBotOwner — matching here keeps
    // a non-admin owner from seeing an admin section on the initial render.
    const isAdmin = isBotOwner(interaction.user.id);
    const dashboardConfig = getCharacterDashboardConfig(isAdmin, character.hasVoiceReference);
    const embed = buildDashboardEmbed(dashboardConfig, character);
    const sessionData: CharacterSessionData = { ...character, _isAdmin: isAdmin };
    const components = buildDashboardComponents(
      dashboardConfig,
      character.slug,
      sessionData,
      buildCharacterDashboardOptions(sessionData)
    );

    // editReply targets the source message after deferUpdate and the new
    // ephemeral reply after deferReply — the session rides whichever
    // message the dashboard actually landed on.
    const message = await interaction.editReply({ embeds: [embed], components });

    await getSessionManager().set<CharacterSessionData>({
      userId: interaction.user.id,
      entityType: 'character',
      entityId: character.slug,
      data: sessionData,
      messageId: message.id,
      channelId: interaction.channelId,
    });

    logger.info(
      { userId: interaction.user.id, slug, sourceIsV2 },
      'Opened edit dashboard from view'
    );
  } catch (error) {
    logger.error({ err: error, slug }, 'Failed to open edit dashboard from view');
    await deliverError(classifyGatewayFailure(error, 'character', { operation: 'read' }));
  }
}
