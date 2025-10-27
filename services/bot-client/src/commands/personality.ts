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
  TextInputStyle
} from 'discord.js';
import { getConfig, createLogger } from '@tzurot/common-types';

const logger = createLogger('personality-command');

export const data = new SlashCommandBuilder()
  .setName('personality')
  .setDescription('Manage AI personalities')
  .addSubcommand(subcommand =>
    subcommand
      .setName('create')
      .setDescription('Create a new AI personality')
      .addStringOption(option =>
        option
          .setName('name')
          .setDescription('Display name of the personality')
          .setRequired(true)
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
        option
          .setName('age')
          .setDescription('Apparent age')
          .setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('likes')
          .setDescription('Things this personality likes')
          .setRequired(false)
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
        option
          .setName('name')
          .setDescription('Display name of the personality')
          .setRequired(false)
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
        option
          .setName('age')
          .setDescription('Apparent age')
          .setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('likes')
          .setDescription('Things this personality likes')
          .setRequired(false)
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

export async function execute(interaction: ChatInputCommandInteraction | ModalSubmitInteraction): Promise<void> {
  const config = getConfig();
  const ownerId = config.BOT_OWNER_ID;

  // Owner-only check
  if (!ownerId || interaction.user.id !== ownerId) {
    await interaction.reply({
      content: '❌ This command is only available to the bot owner.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

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
        flags: MessageFlags.Ephemeral
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
      // Check file type
      if (!avatarAttachment.contentType?.startsWith('image/')) {
        await interaction.editReply('❌ Avatar must be an image file (PNG, JPEG, etc.)');
        return;
      }

      // Check file size (10MB limit from Discord)
      if (avatarAttachment.size > 10 * 1024 * 1024) {
        await interaction.editReply('❌ Avatar file is too large (max 10MB)');
        return;
      }

      // Download and convert to base64
      try {
        const response = await fetch(avatarAttachment.url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // For now, store original - resize will be handled by API gateway
        avatarBase64 = buffer.toString('base64');

        logger.info(`[Personality Create] Downloaded avatar: ${avatarAttachment.name} (${(buffer.length / 1024).toFixed(2)} KB)`);

      } catch (error) {
        logger.error({ err: error }, 'Failed to download avatar');
        await interaction.editReply('❌ Failed to download avatar image');
        return;
      }
    }

    // Build request payload
    const payload = {
      name,
      slug,
      characterInfo,
      personalityTraits,
      displayName: displayName || undefined,
      personalityTone: tone || undefined,
      personalityAge: age || undefined,
      personalityLikes: likes || undefined,
      personalityDislikes: dislikes || undefined,
      avatarData: avatarBase64,
      ownerId: interaction.user.id
    };

    // Call API Gateway to create personality
    const gatewayUrl = config.GATEWAY_URL;
    const response = await fetch(`${gatewayUrl}/admin/personality`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Owner-Id': interaction.user.id
      },
      body: JSON.stringify(payload)
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
      .setColor(0x00FF00)
      .setTitle('✅ Personality Created Successfully')
      .setDescription(`Created new personality: **${name}** (\`${slug}\`)`)
      .addFields(
        { name: 'Character Info', value: characterInfo.slice(0, 1024), inline: false },
        { name: 'Personality Traits', value: personalityTraits.slice(0, 1024), inline: false }
      )
      .setTimestamp();

    if (displayName) {
      embed.addFields({ name: 'Display Name', value: displayName, inline: true });
    }
    if (tone) {
      embed.addFields({ name: 'Tone', value: tone, inline: true });
    }
    if (age) {
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
    if (!name && !characterInfo && !personalityTraits && !displayName && !tone && !age && !likes && !dislikes && !avatarAttachment) {
      await interaction.editReply(
        '❌ You must provide at least one field to update.\n' +
        'Use the command options to specify what you want to change.'
      );
      return;
    }

    // Validate avatar if provided
    let avatarBase64: string | undefined;
    if (avatarAttachment) {
      // Check file type
      if (!avatarAttachment.contentType?.startsWith('image/')) {
        await interaction.editReply('❌ Avatar must be an image file (PNG, JPEG, etc.)');
        return;
      }

      // Check file size (10MB limit from Discord)
      if (avatarAttachment.size > 10 * 1024 * 1024) {
        await interaction.editReply('❌ Avatar file is too large (max 10MB)');
        return;
      }

      // Download and convert to base64
      try {
        const response = await fetch(avatarAttachment.url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        avatarBase64 = buffer.toString('base64');

        logger.info(`[Personality Edit] Downloaded avatar: ${avatarAttachment.name} (${(buffer.length / 1024).toFixed(2)} KB)`);

      } catch (error) {
        logger.error({ err: error }, 'Failed to download avatar');
        await interaction.editReply('❌ Failed to download avatar image');
        return;
      }
    }

    // Build request payload with only provided fields
    const payload: Record<string, unknown> = {
      slug,
      ownerId: interaction.user.id
    };

    if (name !== null) payload.name = name;
    if (characterInfo !== null) payload.characterInfo = characterInfo;
    if (personalityTraits !== null) payload.personalityTraits = personalityTraits;
    if (displayName !== null) payload.displayName = displayName;
    if (tone !== null) payload.personalityTone = tone;
    if (age !== null) payload.personalityAge = age;
    if (likes !== null) payload.personalityLikes = likes;
    if (dislikes !== null) payload.personalityDislikes = dislikes;
    if (avatarBase64) payload.avatarData = avatarBase64;

    // Call API Gateway to edit personality
    const gatewayUrl = config.GATEWAY_URL;
    const response = await fetch(`${gatewayUrl}/admin/personality/${slug}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Owner-Id': interaction.user.id
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, error: errorText }, 'Failed to edit personality');

      // Check for common errors
      if (response.status === 404) {
        await interaction.editReply(
          `❌ Personality with slug \`${slug}\` not found.\n` +
          'Check the slug and try again.'
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
      .setColor(0x00FF00)
      .setTitle('✅ Personality Updated Successfully')
      .setDescription(`Updated personality: **${name || slug}** (\`${slug}\`)`)
      .setTimestamp();

    const updatedFields: string[] = [];
    if (name) updatedFields.push(`Name: ${name}`);
    if (characterInfo) updatedFields.push('Character Info');
    if (personalityTraits) updatedFields.push('Personality Traits');
    if (displayName) updatedFields.push(`Display Name: ${displayName}`);
    if (tone) updatedFields.push(`Tone: ${tone}`);
    if (age) updatedFields.push(`Age: ${age}`);
    if (likes) updatedFields.push('Likes');
    if (dislikes) updatedFields.push('Dislikes');
    if (avatarAttachment) updatedFields.push('Avatar');

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
    if (!fileAttachment.contentType?.includes('json') && !fileAttachment.name.endsWith('.json')) {
      await interaction.editReply('❌ File must be a JSON file (.json)');
      return;
    }

    // Validate file size (10MB limit from Discord)
    if (fileAttachment.size > 10 * 1024 * 1024) {
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
      personalityData = JSON.parse(text);

      logger.info(`[Personality Import] Downloaded JSON: ${fileAttachment.name} (${(text.length / 1024).toFixed(2)} KB)`);

    } catch (error) {
      logger.error({ err: error }, 'Failed to download or parse JSON');
      await interaction.editReply(
        '❌ Failed to parse JSON file.\n' +
        'Make sure the file is valid JSON format.'
      );
      return;
    }

    // Validate required fields
    const requiredFields = ['name', 'slug', 'characterInfo', 'personalityTraits'];
    const missingFields = requiredFields.filter(field => !personalityData[field]);

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
      displayName: personalityData.displayName || undefined,
      personalityTone: personalityData.personalityTone || undefined,
      personalityAge: personalityData.personalityAge || undefined,
      personalityAppearance: personalityData.personalityAppearance || undefined,
      personalityLikes: personalityData.personalityLikes || undefined,
      personalityDislikes: personalityData.personalityDislikes || undefined,
      conversationalGoals: personalityData.conversationalGoals || undefined,
      conversationalExamples: personalityData.conversationalExamples || undefined,
      customFields: personalityData.customFields || undefined,
      avatarData: personalityData.avatarData || undefined,
      ownerId: interaction.user.id
    };

    // Call API Gateway to create personality
    const gatewayUrl = config.GATEWAY_URL;
    const response = await fetch(`${gatewayUrl}/admin/personality`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Owner-Id': interaction.user.id
      },
      body: JSON.stringify(payload)
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
      .setColor(0x00FF00)
      .setTitle('✅ Personality Imported Successfully')
      .setDescription(`Imported personality: **${payload.name}** (\`${slug}\`)`)
      .setTimestamp();

    // Show what was imported
    const importedFields: string[] = [];
    if (payload.characterInfo) importedFields.push('Character Info');
    if (payload.personalityTraits) importedFields.push('Personality Traits');
    if (payload.displayName) importedFields.push('Display Name');
    if (payload.personalityTone) importedFields.push('Tone');
    if (payload.personalityAge) importedFields.push('Age');
    if (payload.personalityAppearance) importedFields.push('Appearance');
    if (payload.personalityLikes) importedFields.push('Likes');
    if (payload.personalityDislikes) importedFields.push('Dislikes');
    if (payload.conversationalGoals) importedFields.push('Conversational Goals');
    if (payload.conversationalExamples) importedFields.push('Conversational Examples');
    if (payload.customFields) importedFields.push('Custom Fields');
    if (payload.avatarData) importedFields.push('Avatar Data');

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
    .setMaxLength(4000);

  // Personality Traits input (required, paragraph style for long text)
  const personalityTraitsInput = new TextInputBuilder()
    .setCustomId('personalityTraits')
    .setLabel('Personality Traits')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Key traits, behaviors, and characteristics...')
    .setRequired(true)
    .setMaxLength(4000);

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
    new ActionRowBuilder<TextInputBuilder>().addComponents(displayNameInput)
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
      flags: MessageFlags.Ephemeral
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
      ownerId: interaction.user.id
    };

    // Call API Gateway to create personality
    const gatewayUrl = config.GATEWAY_URL;
    const response = await fetch(`${gatewayUrl}/admin/personality`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Owner-Id': interaction.user.id
      },
      body: JSON.stringify(payload)
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
      .setColor(0x00FF00)
      .setTitle('✅ Personality Created Successfully')
      .setDescription(`Created personality: **${name}** (\`${slug}\`)`)
      .addFields(
        { name: 'Character Info', value: `${characterInfo.substring(0, 200)}...`, inline: false },
        { name: 'Personality Traits', value: `${personalityTraits.substring(0, 200)}...`, inline: false }
      )
      .setFooter({ text: 'Use /personality edit to add more details (appearance, likes, etc.)' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    logger.info(`[Personality Create Modal] Created personality: ${slug} by ${interaction.user.tag}`);

  } catch (error) {
    logger.error({ err: error }, 'Error creating personality from modal');
    await interaction.editReply(
      '❌ An unexpected error occurred while creating the personality.\n' +
      'Check bot logs for details.'
    );
  }
}
