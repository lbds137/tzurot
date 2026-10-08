/**
 * Preset Default Clear Handler
 * Handles /preset default clear subcommand
 * Clears the user's global default preset
 */

import { EmbedBuilder } from 'discord.js';
import { toModelSlot, MODEL_SLOT_LABELS } from '@tzurot/common-types/constants/ai';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { presetDefaultClearOptions } from '@tzurot/common-types/generated/commandOptions';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { clientsFor } from '../../../utils/gatewayClients.js';
import { classifyGatewayFailure } from '../../../ux/catalog/classify.js';
import { renderSpec } from '../../../ux/render/render.js';

const logger = createLogger('preset-default-clear');

/**
 * Handle /preset default clear
 */
export async function handleDefaultClear(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  // No slot → clear BOTH defaults (`all`); an explicit slot clears just that one.
  // The vision default is a separate FK from the text default, so a no-slot clear
  // has to target both or it silently leaves the other in place. The `both`
  // choice is the same operation made explicit — the gateway has no `both` clear
  // value, so it maps onto the existing `all` sentinel.
  const slotOption = presetDefaultClearOptions(context.interaction).slot();
  const slot = slotOption === null || slotOption === 'both' ? 'all' : toModelSlot(slotOption);

  try {
    const { userClient } = clientsFor(context.interaction);
    const result = await userClient.clearDefaultModelConfig({ slot });

    if (!result.ok) {
      logger.warn({ userId, status: result.status }, 'Failed to clear default');
      await context.editReply({
        content: renderSpec(
          classifyGatewayFailure(result, 'default preset', { failedAction: 'clear the default' })
        ),
      });
      return;
    }

    // Tell the user explicitly what will serve them next, one line per cleared
    // slot (an `all` clear reverts BOTH chat and vision — naming only one would
    // leave the user unaware the other moved too). The gateway already picked
    // the fallback by the caller's tier (keyed → global default, guest → free
    // default), so this render names whichever it sent. A slot is in
    // newEffectiveDefaults iff it was cleared; its value is null when no
    // fallback default is configured. Character-level defaults and overrides
    // sit ABOVE this fallback and surface in the closing sentence.
    const fallbackLines = (['text', 'vision'] as const).flatMap(slotKey => {
      const fallback = result.data.newEffectiveDefaults[slotKey];
      // Slot absent from the map → it wasn't cleared, so emit no line for it.
      if (fallback === undefined) {
        return [];
      }
      return [
        fallback !== null
          ? `**${MODEL_SLOT_LABELS[slotKey]}** → characters without their own preset will use \`${fallback.name}\`.`
          : `**${MODEL_SLOT_LABELS[slotKey]}** → no fallback default is configured; the bot will use its built-in fallback.`,
      ];
    });

    // Only insert the fallback block (with its trailing blank line) when there's
    // at least one slot line — an empty map would otherwise leave a double blank
    // line between the two sentences. The gateway always populates ≥1 slot today,
    // but this keeps the render robust if the response shape ever widens.
    const fallbackSection = fallbackLines.length > 0 ? `${fallbackLines.join('\n')}\n\n` : '';

    const clearedDescription =
      slotOption === 'both'
        ? // Explicit `both` names both slots (the no-slot clear keeps its generic line).
          `Your default presets for ${MODEL_SLOT_LABELS.text} and ${MODEL_SLOT_LABELS.vision} have been removed.`
        : slot === 'all'
          ? 'Your default preset has been removed.'
          : `Your default ${MODEL_SLOT_LABELS[slot]} preset has been removed.`;

    const embed = new EmbedBuilder()
      .setTitle('✅ Default Preset Cleared')
      .setColor(DISCORD_COLORS.SUCCESS)
      .setDescription(
        `${clearedDescription}\n\n${fallbackSection}` +
          'Characters with their own per-character overrides will continue to use those.'
      )
      .setTimestamp();

    await context.editReply({ embeds: [embed] });

    logger.info(
      {
        userId,
        slot,
        newDefaults: {
          text: result.data.newEffectiveDefaults.text?.name ?? null,
          vision: result.data.newEffectiveDefaults.vision?.name ?? null,
        },
      },
      'Cleared default config'
    );
  } catch (error) {
    logger.error({ err: error, userId, command: 'Preset Default Clear' }, 'Error');
    await context.editReply({
      content: renderSpec(
        classifyGatewayFailure(error, 'default preset', { failedAction: 'clear the default' })
      ),
    });
  }
}
