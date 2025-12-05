/**
 * Character Command Group
 * Commands for managing AI characters (personalities)
 *
 * Uses the Dashboard pattern:
 * 1. /character create → Seed modal for minimal creation
 * 2. Dashboard embed shows character with edit menu
 * 3. Select menu → Section-specific modals with pre-filled values
 * 4. On submit → Dashboard refreshes with updated data
 */

import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  type ModalActionRowComponentBuilder,
  MessageFlags,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import type {
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  AutocompleteInteraction,
  StringSelectMenuInteraction,
  ButtonInteraction,
} from 'discord.js';
import {
  createLogger,
  getConfig,
  type EnvConfig,
  DISCORD_LIMITS,
  DISCORD_COLORS,
} from '@tzurot/common-types';
import { createSubcommandRouter } from '../../utils/subcommandRouter.js';
import {
  buildDashboardEmbed,
  buildDashboardComponents,
  buildDashboardCustomId,
  buildSectionModal,
  extractModalValues,
  getSessionManager,
  parseDashboardCustomId,
  isDashboardInteraction,
} from '../../utils/dashboard/index.js';
import { characterDashboardConfig, characterSeedFields, type CharacterData } from './config.js';
import { handleAutocomplete } from './autocomplete.js';
import { CharacterCustomIds } from '../../utils/customIds.js';
import { handleImport } from './import.js';
import { callGatewayApi } from '../../utils/userGatewayClient.js';

const logger = createLogger('character-command');

/**
 * Slash command definition
 */
export const data = new SlashCommandBuilder()
  .setName('character')
  .setDescription('Manage AI characters')
  .addSubcommand(subcommand =>
    subcommand.setName('create').setDescription('Create a new AI character')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('edit')
      .setDescription('Edit an existing AI character')
      .addStringOption(option =>
        option
          .setName('character')
          .setDescription('Character to edit')
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('view')
      .setDescription('View character details')
      .addStringOption(option =>
        option
          .setName('character')
          .setDescription('Character to view')
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand(subcommand => subcommand.setName('list').setDescription('List your characters'))
  .addSubcommand(subcommand =>
    subcommand
      .setName('avatar')
      .setDescription('Upload or change a character avatar')
      .addStringOption(option =>
        option
          .setName('character')
          .setDescription('Character to update')
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addAttachmentOption(option =>
        option
          .setName('image')
          .setDescription('Avatar image (PNG, JPG, GIF, WebP)')
          .setRequired(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('import')
      .setDescription('Import a character from JSON file (owner only)')
      .addAttachmentOption(option =>
        option
          .setName('file')
          .setDescription('JSON file containing character data')
          .setRequired(true)
      )
  );

/**
 * Show the seed modal for character creation
 */
async function handleCreate(interaction: ChatInputCommandInteraction): Promise<void> {
  const modal = new ModalBuilder()
    .setCustomId(buildDashboardCustomId('character', 'seed'))
    .setTitle('Create New Character');

  for (const field of characterSeedFields) {
    const input = new TextInputBuilder()
      .setCustomId(field.id)
      .setLabel(field.label)
      .setPlaceholder(field.placeholder ?? '')
      .setStyle(field.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(field.required ?? false)
      .setMaxLength(field.maxLength ?? DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH);

    const row = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(input);
    modal.addComponents(row);
  }

  await interaction.showModal(modal);
}

/**
 * Handle the edit subcommand - show dashboard for selected character
 */
async function handleEdit(
  interaction: ChatInputCommandInteraction,
  config: EnvConfig
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const slug = interaction.options.getString('character', true);

  try {
    // Fetch character data from API
    const character = await fetchCharacter(slug, config, interaction.user.id);
    if (!character) {
      await interaction.editReply(`❌ Character \`${slug}\` not found or not accessible.`);
      return;
    }

    // Check ownership/permissions (API already verifies access, but check edit permission)
    const canEdit = canUserEditCharacter(interaction.user.id, character, config);
    if (!canEdit) {
      await interaction.editReply(
        `❌ You don't have permission to edit \`${slug}\`.\n` +
          'You can only edit characters you own.'
      );
      return;
    }

    // Build and send dashboard
    const embed = buildDashboardEmbed(characterDashboardConfig, character);
    const components = buildDashboardComponents(characterDashboardConfig, character.id, character, {
      showClose: true,
      showRefresh: true,
    });

    const reply = await interaction.editReply({ embeds: [embed], components });

    // Create session for tracking
    const sessionManager = getSessionManager();
    sessionManager.set(
      interaction.user.id,
      'character',
      character.id,
      character,
      reply.id,
      interaction.channelId
    );

    logger.info(
      { userId: interaction.user.id, characterId: character.id },
      'Character dashboard opened'
    );
  } catch (error) {
    logger.error({ err: error, slug }, 'Failed to open character dashboard');
    await interaction.editReply('❌ Failed to load character. Please try again.');
  }
}

/**
 * Handle view subcommand - show character info without edit controls
 */
async function handleView(
  interaction: ChatInputCommandInteraction,
  config: EnvConfig
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const slug = interaction.options.getString('character', true);

  try {
    const character = await fetchCharacter(slug, config, interaction.user.id);
    if (!character) {
      await interaction.editReply(`❌ Character \`${slug}\` not found or not accessible.`);
      return;
    }

    // Just show the embed without edit controls
    const embed = buildDashboardEmbed(characterDashboardConfig, character);
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    logger.error({ err: error, slug }, 'Failed to view character');
    await interaction.editReply('❌ Failed to load character. Please try again.');
  }
}

/** Characters per page for pagination */
const CHARACTERS_PER_PAGE = 15;

/**
 * Escape markdown special characters in a string
 */
function escapeMarkdown(text: string): string {
  return text.replace(/\*/g, '\\*');
}

/**
 * Format a character line for the list
 */
function formatCharacterLine(
  c: CharacterData,
  creatorNames?: Map<string, string>,
  showCreator = false
): string {
  const visibility = c.isPublic ? '🌐' : '🔒';
  const displayName = escapeMarkdown(c.displayName ?? c.name);

  if (showCreator && creatorNames) {
    const creatorName = c.ownerId !== null ? (creatorNames.get(c.ownerId) ?? 'Unknown') : 'System';
    return `${visibility} **${displayName}** (\`${c.slug}\`) — by ${creatorName}`;
  }

  return `${visibility} **${displayName}** (\`${c.slug}\`)`;
}

/**
 * Build pagination buttons for character list
 */
function buildListPaginationButtons(
  currentPage: number,
  totalPages: number
): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(CharacterCustomIds.listPage(currentPage - 1))
      .setLabel('◀ Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage === 0),
    new ButtonBuilder()
      .setCustomId(CharacterCustomIds.listInfo())
      .setLabel(`Page ${currentPage + 1} of ${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(CharacterCustomIds.listPage(currentPage + 1))
      .setLabel('Next ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage >= totalPages - 1)
  );

  return row;
}

/**
 * Build the paginated character list embed and components
 */
function buildCharacterListPage(
  ownCharacters: CharacterData[],
  publicCharacters: CharacterData[],
  creatorNames: Map<string, string>,
  userId: string,
  page: number
): { embed: EmbedBuilder; components: ActionRowBuilder<ButtonBuilder>[]; totalPages: number } {
  // Combine all characters with a marker for which section they're in
  const allItems: { char: CharacterData; isOwn: boolean }[] = [
    ...ownCharacters.map(c => ({ char: c, isOwn: true })),
    ...publicCharacters.filter(c => c.ownerId !== userId).map(c => ({ char: c, isOwn: false })),
  ];

  const totalPages = Math.max(1, Math.ceil(allItems.length / CHARACTERS_PER_PAGE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);

  const startIdx = safePage * CHARACTERS_PER_PAGE;
  const endIdx = Math.min(startIdx + CHARACTERS_PER_PAGE, allItems.length);
  const pageItems = allItems.slice(startIdx, endIdx);

  // Build description with items on this page
  const lines: string[] = [];

  // Group by section on this page
  const ownOnPage = pageItems.filter(i => i.isOwn);
  const publicOnPage = pageItems.filter(i => !i.isOwn);

  if (ownOnPage.length > 0 || (safePage === 0 && ownCharacters.length === 0)) {
    if (safePage === 0) {
      lines.push(`**📝 Your Characters (${ownCharacters.length})**`);
    }
    if (ownCharacters.length === 0) {
      lines.push("_You don't have any characters yet._");
      lines.push('Use `/character create` to create your first one!');
    } else {
      for (const item of ownOnPage) {
        lines.push(formatCharacterLine(item.char));
      }
    }
  }

  if (publicOnPage.length > 0) {
    if (ownOnPage.length > 0) {
      lines.push(''); // Separator
    }
    const othersCount = publicCharacters.filter(c => c.ownerId !== userId).length;
    if (startIdx <= ownCharacters.length) {
      lines.push(`**🌍 Global Characters (${othersCount})**`);
    }
    for (const item of publicOnPage) {
      lines.push(formatCharacterLine(item.char, creatorNames, true));
    }
  }

  const embed = new EmbedBuilder()
    .setTitle('📚 Character List')
    .setDescription(lines.join('\n') || 'No characters found.')
    .setColor(DISCORD_COLORS.BLURPLE)
    .setFooter({ text: `Total: ${allItems.length} characters` });

  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (totalPages > 1) {
    components.push(buildListPaginationButtons(safePage, totalPages));
  }

  return { embed, components, totalPages };
}

/**
 * Handle list subcommand - show user's characters and global characters
 */
async function handleList(
  interaction: ChatInputCommandInteraction,
  config: EnvConfig
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // Fetch user's own characters and all public characters
    const [ownCharacters, publicCharacters] = await Promise.all([
      fetchUserCharacters(interaction.user.id, config),
      fetchPublicCharacters(interaction.user.id, config),
    ]);

    // Fetch creator usernames for public characters
    const othersPublic = publicCharacters.filter(c => c.ownerId !== interaction.user.id);
    const creatorIds = [...new Set(othersPublic.map(c => c.ownerId).filter(Boolean))] as string[];
    const creatorNames = await fetchUsernames(interaction.client, creatorIds);

    // Build first page
    const { embed, components } = buildCharacterListPage(
      ownCharacters,
      publicCharacters,
      creatorNames,
      interaction.user.id,
      0
    );

    await interaction.editReply({ embeds: [embed], components });
  } catch (error) {
    logger.error({ err: error }, 'Failed to list characters');
    await interaction.editReply('❌ Failed to load characters. Please try again.');
  }
}

/**
 * Handle list pagination button clicks
 */
async function handleListPagination(
  interaction: ButtonInteraction,
  page: number,
  config: EnvConfig
): Promise<void> {
  await interaction.deferUpdate();

  try {
    // Re-fetch character data
    const [ownCharacters, publicCharacters] = await Promise.all([
      fetchUserCharacters(interaction.user.id, config),
      fetchPublicCharacters(interaction.user.id, config),
    ]);

    // Fetch creator usernames for public characters
    const othersPublic = publicCharacters.filter(c => c.ownerId !== interaction.user.id);
    const creatorIds = [...new Set(othersPublic.map(c => c.ownerId).filter(Boolean))] as string[];
    const creatorNames = await fetchUsernames(interaction.client, creatorIds);

    // Build requested page
    const { embed, components } = buildCharacterListPage(
      ownCharacters,
      publicCharacters,
      creatorNames,
      interaction.user.id,
      page
    );

    await interaction.editReply({ embeds: [embed], components });
  } catch (error) {
    logger.error({ err: error, page }, 'Failed to load character list page');
    // Keep existing content on error - user can try again
  }
}

/**
 * Handle avatar upload subcommand
 */
async function handleAvatar(
  interaction: ChatInputCommandInteraction,
  config: EnvConfig
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const slug = interaction.options.getString('character', true);
  const attachment = interaction.options.getAttachment('image', true);

  // Validate attachment is an image
  const validTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  if (attachment.contentType === null || !validTypes.includes(attachment.contentType)) {
    await interaction.editReply(
      '❌ Invalid image format. Please upload a PNG, JPG, GIF, or WebP image.'
    );
    return;
  }

  // Check file size (max 8MB before processing)
  const MAX_SIZE_MB = 8;
  if (attachment.size > MAX_SIZE_MB * 1024 * 1024) {
    await interaction.editReply(
      `❌ Image too large. Please upload an image under ${MAX_SIZE_MB}MB.`
    );
    return;
  }

  try {
    // Check if user can edit this character
    const character = await fetchCharacter(slug, config, interaction.user.id);
    if (!character) {
      await interaction.editReply(`❌ Character \`${slug}\` not found or not accessible.`);
      return;
    }

    const canEdit = canUserEditCharacter(interaction.user.id, character, config);
    if (!canEdit) {
      await interaction.editReply(
        `❌ You don't have permission to edit \`${slug}\`.\n` +
          'You can only edit characters you own.'
      );
      return;
    }

    // Download the image
    const imageResponse = await fetch(attachment.url);
    if (!imageResponse.ok) {
      await interaction.editReply('❌ Failed to download the image. Please try again.');
      return;
    }

    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
    const base64Image = imageBuffer.toString('base64');

    // Update character with new avatar
    await updateCharacter(slug, { avatarData: base64Image }, interaction.user.id, config);

    await interaction.editReply(
      `✅ Avatar updated for **${character.displayName ?? character.name}**!`
    );

    logger.info({ slug, userId: interaction.user.id }, 'Character avatar updated');
  } catch (error) {
    logger.error({ err: error, slug }, 'Failed to update avatar');
    await interaction.editReply('❌ Failed to update avatar. Please try again.');
  }
}

/**
 * Create character router with config dependency
 */
function createCharacterRouter(
  config: EnvConfig
): (interaction: ChatInputCommandInteraction) => Promise<void> {
  return createSubcommandRouter(
    {
      create: handleCreate,
      edit: interaction => handleEdit(interaction, config),
      view: interaction => handleView(interaction, config),
      list: interaction => handleList(interaction, config),
      avatar: interaction => handleAvatar(interaction, config),
      import: interaction => handleImport(interaction, config),
    },
    { logger, logPrefix: '[Character]' }
  );
}

/**
 * Command execution router
 */
export async function execute(
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction
): Promise<void> {
  const config = getConfig();

  // Handle modal submissions
  if (interaction.isModalSubmit()) {
    await handleModalSubmit(interaction, config);
    return;
  }

  const router = createCharacterRouter(config);
  await router(interaction);
}

/**
 * Handle modal submissions for character creation and editing
 */
async function handleModalSubmit(
  interaction: ModalSubmitInteraction,
  config: EnvConfig
): Promise<void> {
  const customId = interaction.customId;

  // Handle seed modal (new character)
  // Format: character::seed
  if (customId === buildDashboardCustomId('character', 'seed')) {
    await handleSeedModalSubmit(interaction, config);
    return;
  }

  // Handle section edit modals
  // Format: character::modal::{entityId}::{sectionId}
  const parsed = parseDashboardCustomId(customId);
  if (
    parsed?.entityType === 'character' &&
    parsed.action === 'modal' &&
    parsed.entityId !== undefined &&
    parsed.sectionId !== undefined
  ) {
    await handleSectionModalSubmit(interaction, parsed.entityId, parsed.sectionId, config);
    return;
  }

  logger.warn({ customId }, 'Unknown modal submission');
  await interaction.reply({
    content: '❌ Unknown form submission.',
    flags: MessageFlags.Ephemeral,
  });
}

/**
 * Handle seed modal submission - create new character
 */
async function handleSeedModalSubmit(
  interaction: ModalSubmitInteraction,
  config: EnvConfig
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const values = extractModalValues(
    interaction,
    characterSeedFields.map(f => f.id)
  );

  // Validate slug format
  if (!/^[a-z0-9-]+$/.test(values.slug)) {
    await interaction.editReply(
      '❌ Invalid slug format. Use only lowercase letters, numbers, and hyphens.\n' +
        `Example: \`${values.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}\``
    );
    return;
  }

  try {
    // Create character via API
    const character = await createCharacter(
      {
        name: values.name,
        slug: values.slug,
        characterInfo: values.characterInfo,
        personalityTraits: values.personalityTraits,
        isPublic: false, // Default to private
      },
      interaction.user.id,
      config
    );

    // Build and send dashboard
    const embed = buildDashboardEmbed(characterDashboardConfig, character);
    const components = buildDashboardComponents(characterDashboardConfig, character.id, character, {
      showClose: true,
      showRefresh: true,
    });

    const reply = await interaction.editReply({ embeds: [embed], components });

    // Create session
    const sessionManager = getSessionManager();
    sessionManager.set(
      interaction.user.id,
      'character',
      character.id,
      character,
      reply.id,
      interaction.channelId ?? ''
    );

    logger.info(
      { userId: interaction.user.id, characterId: character.id },
      'Character created via seed modal'
    );
  } catch (error) {
    logger.error({ err: error }, 'Failed to create character');

    // Check for duplicate slug error
    if (error instanceof Error && error.message.includes('409')) {
      await interaction.editReply(
        `❌ A character with slug \`${values.slug}\` already exists.\n` +
          'Please choose a different slug.'
      );
      return;
    }

    await interaction.editReply('❌ Failed to create character. Please try again.');
  }
}

/**
 * Handle section modal submission - update character field
 */
async function handleSectionModalSubmit(
  interaction: ModalSubmitInteraction,
  entityId: string,
  sectionId: string,
  config: EnvConfig
): Promise<void> {
  await interaction.deferUpdate();

  const sessionManager = getSessionManager();
  const session = sessionManager.get<CharacterData>(interaction.user.id, 'character', entityId);

  if (!session) {
    // Session expired - try to refresh data and continue
    logger.warn({ entityId, sectionId }, 'Session not found for modal submit');
  }

  // Find the section config
  const section = characterDashboardConfig.sections.find(s => s.id === sectionId);
  if (!section) {
    logger.error({ sectionId }, 'Unknown section');
    return;
  }

  // Extract values from modal
  const values = extractModalValues(
    interaction,
    section.fields.map(f => f.id)
  );

  try {
    // Update character via API (entityId is the slug)
    const updated = await updateCharacter(entityId, values, interaction.user.id, config);

    // Update session
    if (session) {
      sessionManager.update<CharacterData>(interaction.user.id, 'character', entityId, updated);
    }

    // Refresh dashboard
    const embed = buildDashboardEmbed(characterDashboardConfig, updated);
    const components = buildDashboardComponents(characterDashboardConfig, updated.id, updated, {
      showClose: true,
      showRefresh: true,
    });

    await interaction.editReply({ embeds: [embed], components });

    logger.info({ characterId: entityId, sectionId }, 'Character section updated');
  } catch (error) {
    logger.error({ err: error, entityId, sectionId }, 'Failed to update character section');
    // Since we deferred update, we can't send a new error message easily
    // The dashboard will remain in its previous state
  }
}

/**
 * Handle select menu interactions for dashboard
 */
export async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  const config = getConfig();
  const parsed = parseDashboardCustomId(interaction.customId);
  if (parsed?.entityType !== 'character' || parsed.entityId === undefined) {
    return;
  }

  const value = interaction.values[0];
  const entityId = parsed.entityId;

  // Handle section edit selection
  if (value.startsWith('edit-')) {
    const sectionId = value.replace('edit-', '');
    const section = characterDashboardConfig.sections.find(s => s.id === sectionId);
    if (!section) {
      await interaction.reply({
        content: '❌ Unknown section.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Get current data from session or fetch
    const sessionManager = getSessionManager();
    const session = sessionManager.get<CharacterData>(interaction.user.id, 'character', entityId);
    let characterData: CharacterData;

    if (session !== null) {
      characterData = session.data;
    } else {
      // Fetch fresh data (entityId is the slug)
      const character = await fetchCharacter(entityId, config, interaction.user.id);
      if (!character) {
        await interaction.reply({
          content: '❌ Character not found.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      characterData = character;
      // Create new session
      sessionManager.set(
        interaction.user.id,
        'character',
        entityId,
        character,
        interaction.message.id,
        interaction.channelId
      );
    }

    // Build and show section modal
    const modal = buildSectionModal(characterDashboardConfig, section, entityId, characterData);
    await interaction.showModal(modal);
    return;
  }

  // Handle action selection
  if (value.startsWith('action-')) {
    const actionId = value.replace('action-', '');
    await handleAction(interaction, entityId, actionId, config);
    return;
  }
}

/**
 * Handle button interactions for dashboard and list pagination
 */
export async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const config = getConfig();
  const customId = interaction.customId;

  // Handle list pagination buttons using centralized customId parser
  const characterParsed = CharacterCustomIds.parse(customId);
  if (characterParsed?.action === 'list') {
    // Info button is disabled, shouldn't be clickable
    if (characterParsed.page === undefined) {
      return;
    }

    await handleListPagination(interaction, characterParsed.page, config);
    return;
  }

  // Handle dashboard buttons
  const parsed = parseDashboardCustomId(customId);
  if (parsed?.entityType !== 'character' || parsed.entityId === undefined) {
    return;
  }

  const entityId = parsed.entityId;
  const action = parsed.action;

  if (action === 'close') {
    // Delete the session and message
    const sessionManager = getSessionManager();
    sessionManager.delete(interaction.user.id, 'character', entityId);

    await interaction.update({
      content: '✅ Dashboard closed.',
      embeds: [],
      components: [],
    });
    return;
  }

  if (action === 'refresh') {
    await interaction.deferUpdate();

    // Fetch fresh data (entityId is the slug)
    const character = await fetchCharacter(entityId, config, interaction.user.id);
    if (!character) {
      await interaction.editReply({
        content: '❌ Character not found.',
        embeds: [],
        components: [],
      });
      return;
    }

    // Update session
    const sessionManager = getSessionManager();
    sessionManager.set(
      interaction.user.id,
      'character',
      entityId,
      character,
      interaction.message.id,
      interaction.channelId
    );

    // Refresh dashboard
    const embed = buildDashboardEmbed(characterDashboardConfig, character);
    const components = buildDashboardComponents(characterDashboardConfig, character.id, character, {
      showClose: true,
      showRefresh: true,
    });

    await interaction.editReply({ embeds: [embed], components });
    return;
  }
}

/**
 * Handle dashboard actions (visibility toggle, avatar upload, etc.)
 */
async function handleAction(
  interaction: StringSelectMenuInteraction,
  entityId: string,
  actionId: string,
  config: EnvConfig
): Promise<void> {
  if (actionId === 'visibility') {
    await interaction.deferUpdate();

    // Get current character (entityId is the slug)
    const character = await fetchCharacter(entityId, config, interaction.user.id);
    if (!character) {
      return;
    }

    // Toggle visibility using dedicated endpoint
    const result = await toggleVisibility(
      entityId,
      !character.isPublic,
      interaction.user.id,
      config
    );

    // Update character data with new visibility
    const updated: CharacterData = { ...character, isPublic: result.isPublic };

    // Update session
    const sessionManager = getSessionManager();
    sessionManager.update<CharacterData>(interaction.user.id, 'character', entityId, {
      isPublic: result.isPublic,
    });

    // Refresh dashboard
    const embed = buildDashboardEmbed(characterDashboardConfig, updated);
    const components = buildDashboardComponents(characterDashboardConfig, updated.id, updated, {
      showClose: true,
      showRefresh: true,
    });

    await interaction.editReply({ embeds: [embed], components });

    const status = result.isPublic ? '🌐 Public' : '🔒 Private';
    logger.info(
      { characterId: entityId, isPublic: result.isPublic },
      `Character visibility: ${status}`
    );
    return;
  }

  if (actionId === 'avatar') {
    // Avatar upload requires a different flow - prompt user to use /character avatar command
    // or we could create a follow-up message asking them to upload an attachment
    await interaction.reply({
      content:
        '🖼️ **Avatar Upload**\n\n' +
        'Please use `/character avatar` to upload a new avatar image.\n' +
        '(Discord modals cannot accept file uploads)',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  logger.warn({ actionId }, 'Unknown action');
}

/**
 * Autocomplete handler
 */
export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  await handleAutocomplete(interaction);
}

// ============================================================================
// API Client Functions
// ============================================================================

/**
 * API response type for personality endpoint
 */
interface PersonalityResponse {
  personality: CharacterData;
  canEdit: boolean;
}

/**
 * API response type for personality list endpoint
 */
interface PersonalityListResponse {
  personalities: {
    id: string;
    name: string;
    displayName: string | null;
    slug: string;
    isOwned: boolean;
    isPublic: boolean;
    ownerId: string | null;
    ownerDiscordId: string | null;
  }[];
}

/**
 * Fetch a character by slug
 * Uses the /user/personality/:slug endpoint which requires user authentication
 */
async function fetchCharacter(
  slugOrId: string,
  _config: EnvConfig,
  userId: string
): Promise<CharacterData | null> {
  const result = await callGatewayApi<PersonalityResponse>(`/user/personality/${slugOrId}`, {
    userId,
  });

  if (!result.ok) {
    if (result.status === 404 || result.status === 403) {
      return null;
    }
    throw new Error(`Failed to fetch character: ${result.status}`);
  }

  return result.data.personality;
}

/**
 * Fetch all characters visible to a user (owned + public)
 * Returns two arrays: user's owned characters and public characters from others
 */
async function fetchAllCharacters(
  userId: string,
  _config: EnvConfig
): Promise<{ owned: CharacterData[]; publicOthers: CharacterData[] }> {
  const result = await callGatewayApi<PersonalityListResponse>('/user/personality', {
    userId,
  });

  if (!result.ok) {
    throw new Error(`Failed to fetch characters: ${result.status}`);
  }

  const data = result.data;

  // The list endpoint returns summaries, but we need full data for the dashboard
  // For now, just return the summaries cast to CharacterData (we'll fetch full data when editing)
  const owned: CharacterData[] = [];
  const publicOthers: CharacterData[] = [];

  for (const p of data.personalities) {
    const charData = {
      id: p.id,
      name: p.name,
      displayName: p.displayName,
      slug: p.slug,
      isPublic: p.isPublic,
      ownerId: p.ownerDiscordId, // Use Discord ID for fetching display names
      // These fields are not in the list response, but needed for CharacterData interface
      characterInfo: '',
      personalityTraits: '',
      personalityTone: null,
      personalityAge: null,
      personalityAppearance: null,
      personalityLikes: null,
      personalityDislikes: null,
      conversationalGoals: null,
      conversationalExamples: null,
      errorMessage: null,
      birthMonth: null,
      birthDay: null,
      birthYear: null,
      voiceEnabled: false,
      imageEnabled: false,
      avatarData: null,
      createdAt: '',
      updatedAt: '',
    } as CharacterData;

    if (p.isOwned) {
      owned.push(charData);
    } else {
      publicOthers.push(charData);
    }
  }

  return { owned, publicOthers };
}

/**
 * Fetch characters owned by user (wrapper for fetchAllCharacters)
 */
async function fetchUserCharacters(userId: string, config: EnvConfig): Promise<CharacterData[]> {
  const { owned } = await fetchAllCharacters(userId, config);
  return owned;
}

/**
 * Fetch public characters from others (wrapper for fetchAllCharacters)
 */
async function fetchPublicCharacters(userId: string, config: EnvConfig): Promise<CharacterData[]> {
  const { publicOthers } = await fetchAllCharacters(userId, config);
  return publicOthers;
}

/**
 * Fetch Discord usernames for a list of user IDs
 */
async function fetchUsernames(
  client: ChatInputCommandInteraction['client'],
  userIds: string[]
): Promise<Map<string, string>> {
  const names = new Map<string, string>();

  await Promise.all(
    userIds.map(async id => {
      try {
        const user = await client.users.fetch(id);
        names.set(id, user.displayName ?? user.username);
      } catch {
        names.set(id, 'Unknown');
      }
    })
  );

  return names;
}

/**
 * Create a new character
 */
async function createCharacter(
  data: Partial<CharacterData> & {
    name: string;
    slug: string;
    characterInfo: string;
    personalityTraits: string;
  },
  userId: string,
  _config: EnvConfig
): Promise<CharacterData> {
  const result = await callGatewayApi<{ success: boolean; personality: CharacterData }>(
    '/user/personality',
    {
      method: 'POST',
      userId,
      body: data,
    }
  );

  if (!result.ok) {
    throw new Error(`Failed to create character: ${result.status} - ${result.error}`);
  }

  return result.data.personality;
}

/**
 * Update a character
 */
async function updateCharacter(
  slug: string,
  data: Partial<CharacterData>,
  userId: string,
  _config: EnvConfig
): Promise<CharacterData> {
  const result = await callGatewayApi<{ success: boolean; personality: CharacterData }>(
    `/user/personality/${slug}`,
    {
      method: 'PUT',
      userId,
      body: data,
    }
  );

  if (!result.ok) {
    throw new Error(`Failed to update character: ${result.status} - ${result.error}`);
  }

  return result.data.personality;
}

/**
 * Toggle character visibility
 */
async function toggleVisibility(
  slug: string,
  isPublic: boolean,
  userId: string,
  _config: EnvConfig
): Promise<{ id: string; slug: string; isPublic: boolean }> {
  const result = await callGatewayApi<{
    success: boolean;
    personality: { id: string; slug: string; isPublic: boolean };
  }>(`/user/personality/${slug}/visibility`, {
    method: 'PATCH',
    userId,
    body: { isPublic },
  });

  if (!result.ok) {
    throw new Error(`Failed to toggle visibility: ${result.status} - ${result.error}`);
  }

  return result.data.personality;
}

/**
 * Check if user can edit a character
 */
function canUserEditCharacter(
  userId: string,
  character: CharacterData,
  config: EnvConfig
): boolean {
  // Owner can always edit
  if (character.ownerId === userId) {
    return true;
  }

  // Bot owner can edit all
  if (userId === config.BOT_OWNER_ID) {
    return true;
  }

  // TODO: Check PersonalityOwner table for co-owners
  return false;
}

/**
 * Check if interaction is a character dashboard interaction
 */
export function isCharacterDashboardInteraction(customId: string): boolean {
  return isDashboardInteraction(customId, 'character');
}
