/**
 * Personality Import Subcommand
 * Handles /personality import
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { MessageFlags, EmbedBuilder } from 'discord.js';
import {
  getConfig,
  createLogger,
  CONTENT_TYPES,
  DISCORD_LIMITS,
  DISCORD_COLORS,
} from '@tzurot/common-types';

const logger = createLogger('personality-import');

/**
 * Handle /personality import subcommand
 */
export async function handleImport(
  interaction: ChatInputCommandInteraction,
  config: ReturnType<typeof getConfig>
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const fileAttachment = interaction.options.getAttachment('file', true);

    // Validate file type
    if (
      (fileAttachment.contentType?.includes('json') ?? false) === false &&
      !fileAttachment.name.endsWith('.json')
    ) {
      await interaction.editReply('❌ File must be a JSON file (.json)');
      return;
    }

    // Validate file size (Discord limit)
    if (fileAttachment.size > DISCORD_LIMITS.AVATAR_SIZE) {
      await interaction.editReply('❌ File is too large (max 10MB)');
      return;
    }

    // Download and parse JSON
    let personalityData: Record<string, unknown>;
    try {
      const response = await fetch(fileAttachment.url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const text = await response.text();
      personalityData = JSON.parse(text) as Record<string, unknown>;

      logger.info(
        `[Personality Import] Downloaded JSON: ${fileAttachment.name} (${(text.length / 1024).toFixed(2)} KB)`
      );
    } catch (error) {
      logger.error({ err: error }, 'Failed to download or parse JSON');
      await interaction.editReply(
        '❌ Failed to parse JSON file.\n' + 'Make sure the file is valid JSON format.'
      );
      return;
    }

    // Validate required fields
    const requiredFields = ['name', 'slug', 'characterInfo', 'personalityTraits'];
    const missingFields = requiredFields.filter(
      field =>
        personalityData[field] === undefined ||
        personalityData[field] === null ||
        personalityData[field] === ''
    );

    if (missingFields.length > 0) {
      await interaction.editReply(
        `❌ Missing required fields: ${missingFields.join(', ')}\n` +
          'JSON must include: name, slug, characterInfo, personalityTraits'
      );
      return;
    }

    // Validate slug format
    const slug = personalityData.slug as string;
    if (!/^[a-z0-9-]+$/.test(slug)) {
      await interaction.editReply(
        '❌ Invalid slug format in JSON. Use only lowercase letters, numbers, and hyphens.\n' +
          `Example: \`${slug.toLowerCase().replace(/[^a-z0-9-]/g, '-')}\``
      );
      return;
    }

    // Build payload for API
    const payload = {
      name: personalityData.name,
      slug: personalityData.slug,
      characterInfo: personalityData.characterInfo,
      personalityTraits: personalityData.personalityTraits,
      displayName: personalityData.displayName ?? undefined,
      personalityTone: personalityData.personalityTone ?? undefined,
      personalityAge: personalityData.personalityAge ?? undefined,
      personalityAppearance: personalityData.personalityAppearance ?? undefined,
      personalityLikes: personalityData.personalityLikes ?? undefined,
      personalityDislikes: personalityData.personalityDislikes ?? undefined,
      conversationalGoals: personalityData.conversationalGoals ?? undefined,
      conversationalExamples: personalityData.conversationalExamples ?? undefined,
      customFields: personalityData.customFields ?? undefined,
      avatarData: personalityData.avatarData ?? undefined,
      ownerId: interaction.user.id,
    };

    // Call API Gateway to create personality
    const gatewayUrl = config.GATEWAY_URL;
    const response = await fetch(`${gatewayUrl}/admin/personality`, {
      method: 'POST',
      headers: {
        'Content-Type': CONTENT_TYPES.JSON,
        'X-Owner-Id': interaction.user.id,
        'X-Service-Auth': config.INTERNAL_SERVICE_SECRET ?? '',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, error: errorText }, 'Failed to import personality');

      // Check for common errors
      if (response.status === 409) {
        await interaction.editReply(
          `❌ A personality with the slug \`${slug}\` already exists.\n` +
            'Either change the slug in the JSON file or delete the existing personality first.'
        );
        return;
      }

      await interaction.editReply(
        `❌ Failed to import personality (HTTP ${response.status}):\n` +
          `\`\`\`\n${errorText.slice(0, 1500)}\n\`\`\``
      );
      return;
    }

    await response.json();

    // Build success embed
    const embed = new EmbedBuilder()
      .setColor(DISCORD_COLORS.SUCCESS)
      .setTitle('✅ Personality Imported Successfully')
      .setDescription(`Imported personality: **${String(payload.name)}** (\`${slug}\`)`)
      .setTimestamp();

    // Show what was imported
    const importedFields: string[] = [];
    if (payload.characterInfo !== undefined && payload.characterInfo !== null) {
      importedFields.push('Character Info');
    }
    if (payload.personalityTraits !== undefined && payload.personalityTraits !== null) {
      importedFields.push('Personality Traits');
    }
    if (payload.displayName !== undefined && payload.displayName !== null) {
      importedFields.push('Display Name');
    }
    if (payload.personalityTone !== undefined && payload.personalityTone !== null) {
      importedFields.push('Tone');
    }
    if (payload.personalityAge !== undefined && payload.personalityAge !== null) {
      importedFields.push('Age');
    }
    if (payload.personalityAppearance !== undefined && payload.personalityAppearance !== null) {
      importedFields.push('Appearance');
    }
    if (payload.personalityLikes !== undefined && payload.personalityLikes !== null) {
      importedFields.push('Likes');
    }
    if (payload.personalityDislikes !== undefined && payload.personalityDislikes !== null) {
      importedFields.push('Dislikes');
    }
    if (payload.conversationalGoals !== undefined && payload.conversationalGoals !== null) {
      importedFields.push('Conversational Goals');
    }
    if (payload.conversationalExamples !== undefined && payload.conversationalExamples !== null) {
      importedFields.push('Conversational Examples');
    }
    if (payload.customFields !== undefined && payload.customFields !== null) {
      importedFields.push('Custom Fields');
    }
    if (payload.avatarData !== undefined && payload.avatarData !== null) {
      importedFields.push('Avatar Data');
    }

    embed.addFields({ name: 'Imported Fields', value: importedFields.join(', '), inline: false });

    await interaction.editReply({ embeds: [embed] });

    logger.info(`[Personality Import] Imported personality: ${slug} by ${interaction.user.tag}`);
  } catch (error) {
    logger.error({ err: error }, 'Error importing personality');
    await interaction.editReply(
      '❌ An unexpected error occurred while importing the personality.\n' +
        'Check bot logs for details.'
    );
  }
}
