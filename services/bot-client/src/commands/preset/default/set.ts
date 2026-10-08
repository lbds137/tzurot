/**
 * Preset Default Set Handler
 * Handles /preset default set subcommand
 * Sets the user's global default preset (applies to all characters)
 */

import { EmbedBuilder } from 'discord.js';
import { toModelSlotOrBoth, MODEL_SLOT_LABELS } from '@tzurot/common-types/constants/ai';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { presetDefaultSetOptions } from '@tzurot/common-types/generated/commandOptions';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { clientsFor } from '../../../utils/gatewayClients.js';
import { classifyGatewayFailure } from '../../../ux/catalog/classify.js';
import { renderSpec } from '../../../ux/render/render.js';
import {
  handleUnlockModelsUpsell,
  checkGuestModePremiumAccess,
} from '../override/guestModeValidation.js';

const logger = createLogger('preset-default-set');

/**
 * Handle /preset default set
 */
export async function handleDefaultSet(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const options = presetDefaultSetOptions(context.interaction);
  const configId = options.preset();
  // The slot (text = chat default, vision, or the `both` alias writing both
  // defaults in one request) decides which default FK(s) the value writes; the
  // gateway capability-gates the vision side BEFORE writing. Without sending it
  // a vision default silently lands in the text slot — mirror `default clear`.
  const slot = toModelSlotOrBoth(options.slot());

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

    const result = await userClient.setDefaultModelConfig({ configId }, { slot });

    if (!result.ok) {
      logger.warn({ userId, status: result.status, configId, slot }, 'Failed to set default');
      await context.editReply({
        content: renderSpec(
          classifyGatewayFailure(result, 'default preset', { failedAction: 'set the default' })
        ),
      });
      return;
    }

    const data = result.data;

    const embed = new EmbedBuilder()
      .setTitle('✅ Default Preset Set')
      .setColor(DISCORD_COLORS.SUCCESS)
      .setDescription(
        (slot === 'both'
          ? // `both` names both slots — the gateway wrote text AND vision in one call.
            `Your default ${MODEL_SLOT_LABELS.text} and ${MODEL_SLOT_LABELS.vision} presets are now **${data.default.configName}**.\n\n`
          : `Your default ${MODEL_SLOT_LABELS[slot]} preset is now **${data.default.configName}**.\n\n`) +
          'This will be used for all characters unless you have a specific override.'
      )
      .setFooter({ text: 'Use /preset default clear to remove this setting' })
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info(
      { userId, configId, configName: data.default.configName, slot, reason },
      'Set default config'
    );
  } catch (error) {
    logger.error({ err: error, userId, command: 'Preset Default Set' }, 'Error');
    await context.editReply({
      content: renderSpec(
        classifyGatewayFailure(error, 'default preset', { failedAction: 'set the default' })
      ),
    });
  }
}
