/**
 * Personality Modal Submit Handler
 * Handles personality creation modal submissions
 */

import type { ModalSubmitInteraction } from 'discord.js';
import { MessageFlags, EmbedBuilder } from 'discord.js';
import {
  getConfig,
  createLogger,
  CONTENT_TYPES,
  DISCORD_COLORS,
  TEXT_LIMITS,
} from '@tzurot/common-types';

const logger = createLogger('personality-modal');

export async function handleModalSubmit(
  interaction: ModalSubmitInteraction,
  config: ReturnType<typeof getConfig>
): Promise<void> {
  // Only handle personality-create modal
  if (interaction.customId !== 'personality-create') {
    await interaction.reply({
      content: '❌ Unknown modal submission',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // Extract values from modal
    const name = interaction.fields.getTextInputValue('name');
    const slug = interaction.fields.getTextInputValue('slug');
    const characterInfo = interaction.fields.getTextInputValue('characterInfo');
    const personalityTraits = interaction.fields.getTextInputValue('personalityTraits');
    const displayName = interaction.fields.getTextInputValue('displayName') || undefined;

    // Validate slug format
    if (!/^[a-z0-9-]+$/.test(slug)) {
      await interaction.editReply(
        '❌ Invalid slug format. Use only lowercase letters, numbers, and hyphens.\n' +
          `Example: \`${slug.toLowerCase().replace(/[^a-z0-9-]/g, '-')}\``
      );
      return;
    }

    // Build payload for API
    const payload = {
      name,
      slug,
      characterInfo,
      personalityTraits,
      displayName,
      ownerId: interaction.user.id,
    };

    // Call API Gateway to create personality
    const gatewayUrl = config.GATEWAY_URL;
    const response = await fetch(`${gatewayUrl}/admin/personality`, {
      method: 'POST',
      headers: {
        'Content-Type': CONTENT_TYPES.JSON,
        'X-Owner-Id': interaction.user.id,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, error: errorText }, 'Failed to create personality');

      if (response.status === 409) {
        await interaction.editReply(
          `❌ A personality with the slug \`${slug}\` already exists.\n` +
            'Either use a different slug or delete the existing personality first.'
        );
        return;
      }

      await interaction.editReply(
        `❌ Failed to create personality (HTTP ${response.status}):\n` +
          `\`\`\`\n${errorText.slice(0, 1500)}\n\`\`\``
      );
      return;
    }

    await response.json();

    // Success!
    const embed = new EmbedBuilder()
      .setColor(DISCORD_COLORS.SUCCESS)
      .setTitle('✅ Personality Created Successfully')
      .setDescription(`Created personality: **${name}** (\`${slug}\`)`)
      .addFields(
        {
          name: 'Character Info',
          value: `${characterInfo.substring(0, TEXT_LIMITS.PERSONALITY_PREVIEW)}...`,
          inline: false,
        },
        {
          name: 'Personality Traits',
          value: `${personalityTraits.substring(0, TEXT_LIMITS.PERSONALITY_PREVIEW)}...`,
          inline: false,
        }
      )
      .setFooter({ text: 'Use /personality edit to add more details (appearance, likes, etc.)' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    logger.info(
      `[Personality Create Modal] Created personality: ${slug} by ${interaction.user.tag}`
    );
  } catch (error) {
    logger.error({ err: error }, 'Error creating personality from modal');
    await interaction.editReply(
      '❌ An unexpected error occurred while creating the personality.\n' +
        'Check bot logs for details.'
    );
  }
}
