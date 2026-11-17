/**
 * Preset Override Set Handler
 * Handles /preset override set subcommand
 */

import { EmbedBuilder } from 'discord.js';
import { toModelSlotOrBoth, MODEL_SLOT_LABELS } from '@tzurot/common-types/constants/ai';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { presetOverrideSetOptions } from '@tzurot/common-types/generated/commandOptions';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import {
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
  isAutocompleteErrorSentinel,
} from '../../../utils/apiCheck.js';
import { clientsFor } from '../../../utils/gatewayClients.js';
import { classifyGatewayFailure } from '../../../ux/catalog/classify.js';
import { renderSpec } from '../../../ux/render/render.js';
import { handleUnlockModelsUpsell, checkGuestModePremiumAccess } from './guestModeValidation.js';

const logger = createLogger('preset-override-set');

/**
 * Handle /preset override set
 */
export async function handleSet(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const options = presetOverrideSetOptions(context.interaction);
  const personalityId = options.character();
  const configId = options.preset();
  // The slot (text = chat default, vision, or the `both` alias pinning both
  // slots in one request) decides which FK(s) the override writes; the gateway
  // capability-gates the vision side BEFORE writing. Without sending it a
  // vision override silently lands in the text slot — mirror clear, which sends it.
  const slot = toModelSlotOrBoth(options.slot());

  if (isAutocompleteErrorSentinel(personalityId)) {
    await context.editReply({ content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE });
    return;
  }

  if (await handleUnlockModelsUpsell(context, configId, userId)) {
    return;
  }

  try {
    const { userClient } = clientsFor(context.interaction);
    const outcome = await checkGuestModePremiumAccess(context, configId, userClient);
    if (outcome.blocked) {
      return;
    }
    const { reason } = outcome;

    const result = await userClient.setModelOverride({ personalityId, configId }, { slot });

    if (!result.ok) {
      logger.warn(
        { userId, status: result.status, personalityId, configId, slot },
        'Failed to set override'
      );
      await context.editReply({
        content: renderSpec(
          classifyGatewayFailure(result, 'preset override', { failedAction: 'set the override' })
        ),
      });
      return;
    }

    const data = result.data;

    // `both` names both slots — the gateway pinned text AND vision in one call.
    const slotPhrase =
      slot === 'both'
        ? `${MODEL_SLOT_LABELS.text} and ${MODEL_SLOT_LABELS.vision}`
        : MODEL_SLOT_LABELS[slot];

    const embed = new EmbedBuilder()
      .setTitle('✅ Preset Override Set')
      .setColor(DISCORD_COLORS.SUCCESS)
      .setDescription(
        `**${data.override.personalityName}** will now use the **${data.override.configName}** preset for ${slotPhrase} messages.`
      )
      .setFooter({ text: 'Use /preset override clear to remove this override' })
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info(
      {
        userId,
        personalityId,
        personalityName: data.override.personalityName,
        configId,
        configName: data.override.configName,
        slot,
        reason,
      },
      'Set override'
    );
  } catch (error) {
    logger.error({ err: error, userId, command: 'Preset Set' }, 'Error');
    await context.editReply({
      content: renderSpec(
        classifyGatewayFailure(error, 'preset override', { failedAction: 'set the override' })
      ),
    });
  }
}
