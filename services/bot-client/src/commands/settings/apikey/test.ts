/**
 * Wallet Test Subcommand
 * Tests API key validity by making a dry-run API call
 *
 * Security:
 * - Response is ephemeral (only visible to the user)
 * - Never displays the actual API key
 */

import { EmbedBuilder } from 'discord.js';
import { type AIProvider } from '@tzurot/common-types/constants/ai';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { settingsApikeyTestOptions } from '@tzurot/common-types/generated/commandOptions';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { clientsFor } from '../../../utils/gatewayClients.js';
import { getProviderDisplayName } from '../../../utils/providers.js';
import { CATALOG } from '../../../ux/catalog/catalog.js';
import { renderSpec } from '../../../ux/render/render.js';

const logger = createLogger('settings-apikey-test');

/** The ❌ embed for a key the provider actually rejected (invalid / quota). */
function buildKeyInvalidEmbed(provider: AIProvider, error: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(DISCORD_COLORS.ERROR)
    .setTitle('❌ API Key Invalid')
    .setDescription(`Your **${getProviderDisplayName(provider)}** API key failed validation.`)
    .addFields({
      name: 'Error',
      value: error,
      inline: false,
    })
    .addFields({
      name: '💡 What to do',
      value:
        '• Check if your key is still valid\n' +
        '• Ensure you have credits/quota remaining\n' +
        '• Use `/settings apikey set` to update your key',
      inline: false,
    })
    .setTimestamp();
}

/** The ⚠️ embed for a key the provider ACCEPTED but that is under-scoped. */
function buildKeyScopedEmbed(provider: AIProvider, error: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(DISCORD_COLORS.WARNING)
    .setTitle('⚠️ API Key Valid — Missing Permissions')
    .setDescription(
      `Your **${getProviderDisplayName(provider)}** API key authenticated, but it lacks permissions this bot needs.`
    )
    .addFields({
      name: 'Details',
      value: error,
      inline: false,
    })
    .addFields({
      name: '💡 What to do',
      value:
        '• Grant the permissions above to this key in your provider dashboard\n' +
        '• Or create a new key with those permissions and run `/settings apikey set`\n' +
        '• Then run `/settings apikey test` again',
      inline: false,
    })
    .setTimestamp();
}

/**
 * Handle /settings apikey test <provider> subcommand
 * Tests the API key validity
 *
 * Receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral' for this subcommand.
 */
export async function handleTestKey(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const options = settingsApikeyTestOptions(context.interaction);
  const provider = options.provider() as AIProvider;

  try {
    const { userClient } = clientsFor(context.interaction);
    const result = await userClient.testWalletKey({ provider });

    if (!result.ok) {
      if (result.status === 404) {
        await context.editReply({
          content: `❌ You don't have an API key configured for **${getProviderDisplayName(provider)}**.\n\nUse \`/settings apikey set\` to add your API key first.`,
        });
        return;
      }

      // Rate-limited (429): our own wallet limiter, NOT a bad key. Saying
      // "API Key Invalid" here is wrong and alarming — tell the user to retry.
      if (result.status === 429) {
        await context.editReply({
          content: `⏳ Too many key operations in a short window. Your **${getProviderDisplayName(provider)}** key wasn't tested — please wait a moment and try again.`,
        });
        return;
      }

      // Transport/HTTP-level failure (the gateway itself errored)
      await context.editReply({ embeds: [buildKeyInvalidEmbed(provider, result.error)] });
      return;
    }

    const data = result.data;

    // The gateway reports a failed validation as 200 + valid:false — an
    // ok result does NOT mean the key passed.
    if (!data.valid) {
      // TIMEOUT/UNKNOWN mean the provider couldn't be reached (timeout, 5xx):
      // the key was never judged, so "Invalid" would be wrong and alarming.
      if (data.errorCode === 'TIMEOUT' || data.errorCode === 'UNKNOWN') {
        await context.editReply({
          content: renderSpec(
            CATALOG.error.transient(
              `Couldn't verify your **${getProviderDisplayName(provider)}** key — the provider didn't respond normally (${data.error ?? 'no details'}). Your key wasn't judged invalid.`
            )
          ),
        });
        return;
      }

      // The provider accepted the key and rejected only its SCOPE — rendering
      // "Invalid" here sends the user to replace a working key.
      if (data.errorCode === 'MISSING_PERMISSIONS') {
        await context.editReply({
          embeds: [buildKeyScopedEmbed(provider, data.error ?? 'Validation failed')],
        });
        return;
      }

      await context.editReply({
        embeds: [buildKeyInvalidEmbed(provider, data.error ?? 'Validation failed')],
      });
      return;
    }

    // Success - key is valid
    const embed = new EmbedBuilder()
      .setColor(DISCORD_COLORS.SUCCESS)
      .setTitle('✅ API Key Valid')
      .setDescription(`Your **${getProviderDisplayName(provider)}** API key is working correctly!`);

    // Add credit balance if available (OpenRouter provides this)
    if (data.credits !== undefined) {
      embed.addFields({
        name: '💰 Credit Balance',
        value: `$${data.credits.toFixed(4)}`,
        inline: true,
      });
    }

    embed
      .addFields({
        name: '🚀 Ready to Use',
        value: 'Your key will be used for AI responses.',
        inline: true,
      })
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info({ provider, userId, hasCredits: data.credits !== undefined }, 'API key validated');
  } catch (error) {
    logger.error({ err: error, userId, provider }, 'Unexpected error');
    await context.editReply({ content: '❌ An unexpected error occurred. Please try again.' });
  }
}
