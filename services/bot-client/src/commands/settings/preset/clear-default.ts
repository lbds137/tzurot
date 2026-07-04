/**
 * Settings Preset Clear-Default Handler
 * Handles /settings preset clear-default subcommand
 * Clears the user's global default preset
 */

import { EmbedBuilder } from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { settingsPresetClearDefaultOptions } from '@tzurot/common-types/generated/commandOptions';
import { toConfigKind } from '@tzurot/common-types/services/LlmConfigMapper';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { clientsFor } from '../../../utils/gatewayClients.js';

const logger = createLogger('settings-preset-clear-default');

/**
 * Handle /settings preset clear-default
 */
export async function handleClearDefault(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  // No slot → clear BOTH defaults (`all`); an explicit slot clears just that one.
  // The vision default is a separate FK from the text default, so a no-slot clear
  // has to target both or it silently leaves the other in place.
  const slot = settingsPresetClearDefaultOptions(context.interaction).slot();
  const kind = slot !== null ? toConfigKind(slot) : 'all';

  try {
    const { userClient } = clientsFor(context.interaction);
    const result = await userClient.clearDefaultModelConfig({ kind });

    if (!result.ok) {
      logger.warn({ userId, status: result.status }, 'Failed to clear default');
      await context.editReply({ content: `❌ Failed to clear default: ${result.error}` });
      return;
    }

    // Tell the user explicitly what they'll fall back to next, one line per
    // cleared slot (an `all` clear reverts BOTH chat and vision — naming only
    // one would leave the user unaware the other moved too). A slot is in
    // newEffectiveDefaults iff it was cleared; its value is null when no system
    // free default exists for it. Per-character overrides are unaffected and
    // surface in the closing sentence.
    const SLOT_LABELS = { text: 'Chat', vision: 'Vision' } as const;
    const fallbackLines = (['text', 'vision'] as const).flatMap(slot => {
      const fallback = result.data.newEffectiveDefaults[slot];
      // Slot absent from the map → it wasn't cleared, so emit no line for it.
      if (fallback === undefined) {
        return [];
      }
      return [
        fallback !== null
          ? `**${SLOT_LABELS[slot]}** → falling back to system default: \`${fallback.name}\`.`
          : `**${SLOT_LABELS[slot]}** → no system default is configured; the bot will use its built-in fallback.`,
      ];
    });

    // Only insert the fallback block (with its trailing blank line) when there's
    // at least one slot line — an empty map would otherwise leave a double blank
    // line between the two sentences. The gateway always populates ≥1 slot today,
    // but this keeps the render robust if the response shape ever widens.
    const fallbackSection = fallbackLines.length > 0 ? `${fallbackLines.join('\n')}\n\n` : '';

    const embed = new EmbedBuilder()
      .setTitle('✅ Default Preset Cleared')
      .setColor(DISCORD_COLORS.SUCCESS)
      .setDescription(
        `Your default preset has been removed.\n\n${fallbackSection}` +
          'Characters with their own per-character overrides will continue to use those.'
      )
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info(
      {
        userId,
        kind,
        newDefaults: {
          text: result.data.newEffectiveDefaults.text?.name ?? null,
          vision: result.data.newEffectiveDefaults.vision?.name ?? null,
        },
      },
      'Cleared default config'
    );
  } catch (error) {
    logger.error({ err: error, userId, command: 'Preset Clear-Default' }, 'Error');
    await context.editReply({ content: '❌ An error occurred. Please try again later.' });
  }
}
