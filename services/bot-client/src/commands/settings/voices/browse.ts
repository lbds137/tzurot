/**
 * Voice Browse Handler
 * Lists ElevenLabs cloned voices (tzurot-prefixed) with slot summary
 */

import { EmbedBuilder } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { callGatewayApi, GATEWAY_TIMEOUTS } from '../../../utils/userGatewayClient.js';
import type { VoicesListResponse } from './types.js';

const logger = createLogger('settings-voices-browse');

/**
 * Build the browse embed for voice listing
 */
function buildVoiceBrowseEmbed(data: VoicesListResponse): EmbedBuilder {
  const { voices, totalSlots, tzurotCount } = data;

  const embed = new EmbedBuilder()
    .setTitle('🎤 Cloned Voices')
    .setColor(voices.length > 0 ? DISCORD_COLORS.SUCCESS : DISCORD_COLORS.BLURPLE)
    .setTimestamp();

  if (voices.length === 0) {
    embed.setDescription(
      'No Tzurot-cloned voices found.\n\n' +
        'Voices are auto-cloned when you talk to a character with voice enabled.\n' +
        `Your ElevenLabs account has **${totalSlots}** total voice slots.`
    );
    return embed;
  }

  const voiceLines = voices.map((v, i) => `**${i + 1}.** \`${v.slug}\` — \`${v.voiceId}\``);

  embed.setDescription(voiceLines.join('\n'));
  embed.setFooter({
    text: `${tzurotCount} Tzurot voice${tzurotCount !== 1 ? 's' : ''} / ${totalSlots} total ElevenLabs slots`,
  });

  embed.addFields({
    name: '💡 Management',
    value: [
      '`/settings voices delete <voice>` - Remove a single voice',
      '`/settings voices clear` - Remove all Tzurot voices',
    ].join('\n'),
    inline: false,
  });

  return embed;
}

/**
 * Handle /settings voices browse
 * Lists all tzurot-prefixed cloned voices from ElevenLabs
 */
export async function handleBrowseVoices(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;

  try {
    const result = await callGatewayApi<VoicesListResponse>('/user/voices', {
      userId,
      timeout: GATEWAY_TIMEOUTS.DEFERRED,
    });

    if (!result.ok) {
      await context.editReply({ content: `❌ ${result.error}` });
      return;
    }

    const embed = buildVoiceBrowseEmbed(result.data);
    await context.editReply({ embeds: [embed] });

    logger.info({ userId, voiceCount: result.data.voices.length }, '[Voices Browse] Listed voices');
  } catch (error) {
    logger.error({ err: error, userId }, '[Voices Browse] Unexpected error');
    await context.editReply({ content: '❌ An unexpected error occurred. Please try again.' });
  }
}
