/**
 * Wallet Remove Subcommand
 * Removes an API key for a provider
 *
 * Security:
 * - Response is ephemeral (only visible to the user)
 * - Confirms removal before deletion
 */

import { EmbedBuilder } from 'discord.js';
import { type AIProvider } from '@tzurot/common-types/constants/ai';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { settingsApikeyRemoveOptions } from '@tzurot/common-types/generated/commandOptions';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { clientsFor } from '../../../utils/gatewayClients.js';
import { getProviderDisplayName } from '../../../utils/providers.js';
import { CATALOG } from '../../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../../ux/catalog/classify.js';
import { renderSpec } from '../../../ux/render/render.js';

const logger = createLogger('settings-apikey-remove');

/**
 * Handle /settings apikey remove <provider> subcommand
 * Removes the API key for the specified provider
 *
 * Receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral' for this subcommand.
 */
export async function handleRemoveKey(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const options = settingsApikeyRemoveOptions(context.interaction);
  const provider = options.provider() as AIProvider;

  try {
    const { userClient } = clientsFor(context.interaction);
    const result = await userClient.removeWalletKey(provider);

    if (!result.ok) {
      if (result.status === 404) {
        await context.editReply({
          content: renderSpec(
            CATALOG.error.validation(
              `You don't have an API key configured for **${getProviderDisplayName(provider)}**.`
            )
          ),
        });
        return;
      }

      await context.editReply({
        content: renderSpec(
          classifyGatewayFailure(result, 'API key', { failedAction: 'remove the API key' })
        ),
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(DISCORD_COLORS.WARNING)
      .setTitle('🗑️ API Key Removed')
      .setDescription(
        `Your **${getProviderDisplayName(provider)}** API key has been deleted.\n\n` +
          'The bot will now use the default system key (if available) for this provider.'
      )
      .setFooter({ text: 'Use /settings apikey set to configure a new key' })
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info({ provider, userId }, 'API key removed');
  } catch (error) {
    logger.error({ err: error, userId, provider }, 'Unexpected error');
    await context.editReply({
      content: renderSpec(
        classifyGatewayFailure(error, 'API key', { failedAction: 'remove the API key' })
      ),
    });
  }
}
