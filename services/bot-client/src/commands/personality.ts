/**
 * Personality Command Group
 * Commands for managing AI personalities
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import {
  getConfig,
  createLogger,
  requireBotOwner,
  DISCORD_LIMITS,
  DISCORD_COLORS,
  CONTENT_TYPES,
  TEXT_LIMITS,
} from '@tzurot/common-types';
import { processAvatarAttachment, AvatarProcessingError } from '../utils/avatarProcessor.js';

const logger = createLogger('personality-command');

export const data = new SlashCommandBuilder()
  .setName('personality')
  .setDescription('Manage AI personalities')
  .addSubcommand(subcommand =>
    subcommand
      .setName('create')
      .setDescription('Create a new AI personality')
      .addStringOption(option =>
        option.setName('name').setDescription('Display name of the personality').setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('slug')
          .setDescription('Unique identifier (lowercase, hyphens only)')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('character-info')
          .setDescription('Character background and description')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('personality-traits')
          .setDescription('Key personality traits and behaviors')
          .setRequired(true)
      )
      .addAttachmentOption(option =>
        option
          .setName('avatar')
          .setDescription('Profile picture (will be resized to 256x256, max 200KB)')
          .setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('display-name')
          .setDescription('Display name (different from internal name if desired)')
          .setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('tone')
          .setDescription('Conversational tone (e.g., friendly, professional, sarcastic)')
          .setRequired(false)
      )
      .addStringOption(option =>
        option.setName('age').setDescription('Apparent age').setRequired(false)
      )
      .addStringOption(option =>
        option.setName('likes').setDescription('Things this personality likes').setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('dislikes')
          .setDescription('Things this personality dislikes')
          .setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('edit')
      .setDescription('Edit an existing AI personality')
      .addStringOption(option =>
        option
          .setName('slug')
          .setDescription('Unique identifier of the personality to edit')
          .setRequired(true)
      )
      .addStringOption(option =>
        option.setName('name').setDescription('Display name of the personality').setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('character-info')
          .setDescription('Character background and description')
          .setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('personality-traits')
          .setDescription('Key personality traits and behaviors')
          .setRequired(false)
      )
      .addAttachmentOption(option =>
        option
          .setName('avatar')
          .setDescription('New profile picture (will be resized to 256x256, max 200KB)')
          .setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('display-name')
          .setDescription('Display name (different from internal name if desired)')
          .setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('tone')
          .setDescription('Conversational tone (e.g., friendly, professional, sarcastic)')
          .setRequired(false)
      )
      .addStringOption(option =>
        option.setName('age').setDescription('Apparent age').setRequired(false)
      )
      .addStringOption(option =>
        option.setName('likes').setDescription('Things this personality likes').setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('dislikes')
          .setDescription('Things this personality dislikes')
          .setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('import')
      .setDescription('Import a personality from JSON file')
      .addAttachmentOption(option =>
        option
          .setName('file')
          .setDescription('JSON file containing personality data')
          .setRequired(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('create-modal')
      .setDescription('Create a new AI personality using an interactive form')
  );

export async function execute(
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction
): Promise<void> {
  // Owner-only check
  if (!(await requireBotOwner(interaction))) {
    return;
  }

  const config = getConfig();

  // Handle modal submissions
  if (interaction.isModalSubmit()) {
    await handleModalSubmit(interaction, config);
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'create':
      await handleCreate(interaction, config);
      break;
    case 'edit':
      await handleEdit(interaction, config);
      break;
    case 'import':
      await handleImport(interaction, config);
      break;
    case 'create-modal':
      await handleCreateModal(interaction);
      break;
    default:
      await interaction.reply({
        content: '❌ Unknown subcommand',
        flags: MessageFlags.Ephemeral,
      });
  }
}

/**
 * Handle /personality create subcommand
 */
async function handleCreate(
  interaction: ChatInputCommandInteraction,
  config: ReturnType<typeof getConfig>
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // Get required parameters
    const name = interaction.options.getString('name', true);
    const slug = interaction.options.getString('slug', true);
    const characterInfo = interaction.options.getString('character-info', true);
    const personalityTraits = interaction.options.getString('personality-traits', true);

    // Get optional parameters
    const displayName = interaction.options.getString('display-name');
    const tone = interaction.options.getString('tone');
    const age = interaction.options.getString('age');
    const likes = interaction.options.getString('likes');
    const dislikes = interaction.options.getString('dislikes');
    const avatarAttachment = interaction.options.getAttachment('avatar');

    // Validate slug format (lowercase, hyphens only)
    if (!/^[a-z0-9-]+$/.test(slug)) {
      await interaction.editReply(
        '❌ Invalid slug format. Use only lowercase letters, numbers, and hyphens.\n' +
          `Example: \`${name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}\``
      );
      return;
    }

    // Validate avatar if provided
    let avatarBase64: string | undefined;
    if (avatarAttachment) {
      try {
        avatarBase64 = await processAvatarAttachment(avatarAttachment, 'Personality Create');
      } catch (error) {
        if (error instanceof AvatarProcessingError) {
          await interaction.editReply(error.message);
        } else {
          await interaction.editReply('❌ Failed to process avatar image');
        }
        return;
      }
    }

    // Build request payload
    const payload = {
      name,
      slug,
      characterInfo,
      personalityTraits,
      displayName: displayName ?? undefined,
      personalityTone: tone ?? undefined,
      personalityAge: age ?? undefined,
      personalityLikes: likes ?? undefined,
      personalityDislikes: dislikes ?? undefined,
      avatarData: avatarBase64,
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

      // Check for common errors
      if (response.status === 409) {
        await interaction.editReply(
          `❌ A personality with the slug \`${slug}\` already exists.\n` +
            'Please choose a different slug.'
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

    // Build success embed
    const embed = new EmbedBuilder()
      .setColor(DISCORD_COLORS.SUCCESS)
      .setTitle('✅ Personality Created Successfully')
      .setDescription(`Created new personality: **${name}** (\`${slug}\`)`)
      .addFields(
        { name: 'Character Info', value: characterInfo.slice(0, DISCORD_LIMITS.EMBED_FIELD), inline: false },
        { name: 'Personality Traits', value: personalityTraits.slice(0, DISCORD_LIMITS.EMBED_FIELD), inline: false }
      )
      .setTimestamp();

    if (
      displayName !== undefined &&
      displayName !== null &&
      displayName.length > 0
    ) {
      embed.addFields({ name: 'Display Name', value: displayName, inline: true });
    }
    if (tone !== undefined && tone !== null && tone.length > 0) {
      embed.addFields({ name: 'Tone', value: tone, inline: true });
    }
    if (age !== undefined && age !== null && age.length > 0) {
      embed.addFields({ name: 'Age', value: age, inline: true });
    }
    if (avatarAttachment) {
      embed.addFields({ name: 'Avatar', value: '✅ Uploaded and processed', inline: true });
    }

    await interaction.editReply({ embeds: [embed] });

    logger.info(`[Personality Create] Created personality: ${slug} by ${interaction.user.tag}`);
  } catch (error) {
    logger.error({ err: error }, 'Error creating personality');
    await interaction.editReply(
      '❌ An unexpected error occurred while creating the personality.\n' +
        'Check bot logs for details.'
    );
  }
}

/**
 * Handle /personality edit subcommand
 */
async function handleEdit(
  interaction: ChatInputCommandInteraction,
  config: ReturnType<typeof getConfig>
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // Get required parameter
    const slug = interaction.options.getString('slug', true);

    // Get optional parameters (only update what's provided)
    const name = interaction.options.getString('name');
    const characterInfo = interaction.options.getString('character-info');
    const personalityTraits = interaction.options.getString('personality-traits');
    const displayName = interaction.options.getString('display-name');
    const tone = interaction.options.getString('tone');
    const age = interaction.options.getString('age');
    const likes = interaction.options.getString('likes');
    const dislikes = interaction.options.getString('dislikes');
    const avatarAttachment = interaction.options.getAttachment('avatar');

    // Validate at least one field is provided
    if (
      (name === undefined || name === null || name.length === 0) &&
      (characterInfo === undefined || characterInfo === null || characterInfo.length === 0) &&
      (personalityTraits === undefined ||
        personalityTraits === null ||
        personalityTraits.length === 0) &&
      (displayName === undefined || displayName === null || displayName.length === 0) &&
      (tone === undefined || tone === null || tone.length === 0) &&
      (age === undefined || age === null || age.length === 0) &&
      (likes === undefined || likes === null || likes.length === 0) &&
      (dislikes === undefined || dislikes === null || dislikes.length === 0) &&
      !avatarAttachment
    ) {
      await interaction.editReply(
        '❌ You must provide at least one field to update.\n' +
          'Use the command options to specify what you want to change.'
      );
      return;
    }

    // Validate avatar if provided
    let avatarBase64: string | undefined;
    if (avatarAttachment) {
      try {
        avatarBase64 = await processAvatarAttachment(avatarAttachment, 'Personality Edit');
      } catch (error) {
        if (error instanceof AvatarProcessingError) {
          await interaction.editReply(error.message);
        } else {
          await interaction.editReply('❌ Failed to process avatar image');
        }
        return;
      }
    }

    // Build request payload with only provided fields
    const payload: Record<string, unknown> = {
      slug,
      ownerId: interaction.user.id,
    };

    if (name !== null && name !== undefined && name.length > 0) {payload.name = name;}
    if (characterInfo !== null && characterInfo !== undefined && characterInfo.length > 0) {payload.characterInfo = characterInfo;}
    if (personalityTraits !== null && personalityTraits !== undefined && personalityTraits.length > 0) {payload.personalityTraits = personalityTraits;}
    if (displayName !== null && displayName !== undefined && displayName.length > 0) {payload.displayName = displayName;}
    if (tone !== null && tone !== undefined && tone.length > 0) {payload.personalityTone = tone;}
    if (age !== null && age !== undefined && age.length > 0) {payload.personalityAge = age;}
    if (likes !== null && likes !== undefined && likes.length > 0) {payload.personalityLikes = likes;}
    if (dislikes !== null && dislikes !== undefined && dislikes.length > 0) {payload.personalityDislikes = dislikes;}
    if (avatarBase64 !== undefined && avatarBase64 !== null && avatarBase64.length > 0) {payload.avatarData = avatarBase64;}

    // Call API Gateway to edit personality
    const gatewayUrl = config.GATEWAY_URL;
    const response = await fetch(`${gatewayUrl}/admin/personality/${slug}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': CONTENT_TYPES.JSON,
        'X-Owner-Id': interaction.user.id,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, error: errorText }, 'Failed to edit personality');

      // Check for common errors
      if (response.status === 404) {
        await interaction.editReply(
          `❌ Personality with slug \`${slug}\` not found.\n` + 'Check the slug and try again.'
        );
        return;
      }

      await interaction.editReply(
        `❌ Failed to edit personality (HTTP ${response.status}):\n` +
          `\`\`\`\n${errorText.slice(0, 1500)}\n\`\`\``
      );
      return;
    }

    await response.json();

    // Build success embed
    const embed = new EmbedBuilder()
      .setColor(DISCORD_COLORS.SUCCESS)
      .setTitle('✅ Personality Updated Successfully')
      .setDescription(`Updated personality: **${name ?? slug}** (\`${slug}\`)`)
      .setTimestamp();

    const updatedFields: string[] = [];
    if (name !== undefined && name !== null && name.length > 0) {updatedFields.push(`Name: ${name}`);}
    if (characterInfo !== undefined && characterInfo !== null && characterInfo.length > 0) {updatedFields.push('Character Info');}
    if (personalityTraits !== undefined && personalityTraits !== null && personalityTraits.length > 0) {updatedFields.push('Personality Traits');}
    if (displayName !== undefined && displayName !== null && displayName.length > 0) {updatedFields.push(`Display Name: ${displayName}`);}
    if (tone !== undefined && tone !== null && tone.length > 0) {updatedFields.push(`Tone: ${tone}`);}
    if (age !== undefined && age !== null && age.length > 0) {updatedFields.push(`Age: ${age}`);}
    if (likes !== undefined && likes !== null && likes.length > 0) {updatedFields.push('Likes');}
    if (dislikes !== undefined && dislikes !== null && dislikes.length > 0) {updatedFields.push('Dislikes');}
    if (avatarAttachment !== undefined && avatarAttachment !== null) {updatedFields.push('Avatar');}

    embed.addFields({ name: 'Updated Fields', value: updatedFields.join('\n'), inline: false });

    await interaction.editReply({ embeds: [embed] });

    logger.info(`[Personality Edit] Updated personality: ${slug} by ${interaction.user.tag}`);
  } catch (error) {
    logger.error({ err: error }, 'Error editing personality');
    await interaction.editReply(
      '❌ An unexpected error occurred while editing the personality.\n' +
        'Check bot logs for details.'
    );
  }
}

/**
 * Handle /personality import subcommand
 */
async function handleImport(
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
    if (payload.characterInfo !== undefined && payload.characterInfo !== null) {importedFields.push('Character Info');}
    if (payload.personalityTraits !== undefined && payload.personalityTraits !== null) {importedFields.push('Personality Traits');}
    if (payload.displayName !== undefined && payload.displayName !== null) {importedFields.push('Display Name');}
    if (payload.personalityTone !== undefined && payload.personalityTone !== null) {importedFields.push('Tone');}
    if (payload.personalityAge !== undefined && payload.personalityAge !== null) {importedFields.push('Age');}
    if (payload.personalityAppearance !== undefined && payload.personalityAppearance !== null) {importedFields.push('Appearance');}
    if (payload.personalityLikes !== undefined && payload.personalityLikes !== null) {importedFields.push('Likes');}
    if (payload.personalityDislikes !== undefined && payload.personalityDislikes !== null) {importedFields.push('Dislikes');}
    if (payload.conversationalGoals !== undefined && payload.conversationalGoals !== null) {importedFields.push('Conversational Goals');}
    if (payload.conversationalExamples !== undefined && payload.conversationalExamples !== null) {importedFields.push('Conversational Examples');}
    if (payload.customFields !== undefined && payload.customFields !== null) {importedFields.push('Custom Fields');}
    if (payload.avatarData !== undefined && payload.avatarData !== null) {importedFields.push('Avatar Data');}

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

/**
 * Handle /personality create-modal subcommand
 * Shows a modal with text inputs for personality creation
 */
async function handleCreateModal(interaction: ChatInputCommandInteraction): Promise<void> {
  // Create modal with text inputs
  const modal = new ModalBuilder()
    .setCustomId('personality-create')
    .setTitle('Create New Personality');

  // Name input (required)
  const nameInput = new TextInputBuilder()
    .setCustomId('name')
    .setLabel('Name')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Lilith')
    .setRequired(true)
    .setMaxLength(255);

  // Slug input (required)
  const slugInput = new TextInputBuilder()
    .setCustomId('slug')
    .setLabel('Slug (lowercase, hyphens only)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('lilith')
    .setRequired(true)
    .setMaxLength(255);

  // Character Info input (required, paragraph style for long text)
  const characterInfoInput = new TextInputBuilder()
    .setCustomId('characterInfo')
    .setLabel('Character Info')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Background, description, and context for this personality...')
    .setRequired(true)
    .setMaxLength(DISCORD_LIMITS.EMBED_DESCRIPTION);

  // Personality Traits input (required, paragraph style for long text)
  const personalityTraitsInput = new TextInputBuilder()
    .setCustomId('personalityTraits')
    .setLabel('Personality Traits')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Key traits, behaviors, and characteristics...')
    .setRequired(true)
    .setMaxLength(DISCORD_LIMITS.EMBED_DESCRIPTION);

  // Display Name input (optional)
  const displayNameInput = new TextInputBuilder()
    .setCustomId('displayName')
    .setLabel('Display Name (optional)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Leave empty to use Name')
    .setRequired(false)
    .setMaxLength(255);

  // Add inputs to action rows (max 1 input per row)
  const rows = [
    new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(slugInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(characterInfoInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(personalityTraitsInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(displayNameInput),
  ];

  modal.addComponents(...rows);

  // Show modal to user
  await interaction.showModal(modal);
  logger.info(`[Personality Create Modal] Modal shown to ${interaction.user.tag}`);
}

/**
 * Handle modal submission for personality creation
 */
async function handleModalSubmit(
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
        { name: 'Character Info', value: `${characterInfo.substring(0, TEXT_LIMITS.PERSONALITY_PREVIEW)}...`, inline: false },
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
