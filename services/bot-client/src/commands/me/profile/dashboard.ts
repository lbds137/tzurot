/**
 * Profile Dashboard Interaction Handlers
 *
 * Handles all dashboard interactions:
 * - Select menu for editing sections
 * - Button clicks (close, refresh, delete)
 * - Modal submissions for section edits
 */

import {
  MessageFlags,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
} from 'discord.js';
import type {
  StringSelectMenuInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import {
  buildDashboardEmbed,
  buildDashboardComponents,
  buildSectionModal,
  extractModalValues,
  getSessionManager,
  parseDashboardCustomId,
  isDashboardInteraction,
  type ActionButtonOptions,
} from '../../../utils/dashboard/index.js';
import {
  PROFILE_DASHBOARD_CONFIG,
  type FlattenedProfileData,
  flattenProfileData,
  unflattenProfileData,
} from './config.js';
import { fetchProfile, updateProfile, deleteProfile, isDefaultProfile } from './api.js';

const logger = createLogger('profile-dashboard');

/**
 * Build dashboard button options for profiles.
 * Delete button only shown for non-default profiles.
 */
function buildProfileDashboardOptions(data: FlattenedProfileData): ActionButtonOptions {
  return {
    showClose: true,
    showRefresh: true,
    showDelete: !data.isDefault, // Can't delete default profile
  };
}

/**
 * Refresh the dashboard UI with updated data.
 */
async function refreshDashboardUI(
  interaction: ModalSubmitInteraction | ButtonInteraction,
  entityId: string,
  flattenedData: FlattenedProfileData
): Promise<void> {
  const embed = buildDashboardEmbed(PROFILE_DASHBOARD_CONFIG, flattenedData);
  const components = buildDashboardComponents(
    PROFILE_DASHBOARD_CONFIG,
    entityId,
    flattenedData,
    buildProfileDashboardOptions(flattenedData)
  );
  await interaction.editReply({ embeds: [embed], components });
}

/**
 * Handle modal submissions for profile editing
 */
export async function handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const customId = interaction.customId;
  const parsed = parseDashboardCustomId(customId);

  // Handle section edit modals
  // Format: profile::modal::{entityId}::{sectionId}
  if (
    parsed?.entityType === 'profile' &&
    parsed.action === 'modal' &&
    parsed.entityId !== undefined &&
    parsed.sectionId !== undefined
  ) {
    await handleSectionModalSubmit(interaction, parsed.entityId, parsed.sectionId);
    return;
  }

  logger.warn({ customId }, 'Unknown profile modal submission');
  await interaction.reply({
    content: '❌ Unknown form submission.',
    flags: MessageFlags.Ephemeral,
  });
}

/**
 * Handle section modal submission - update profile field
 */
async function handleSectionModalSubmit(
  interaction: ModalSubmitInteraction,
  entityId: string,
  sectionId: string
): Promise<void> {
  await interaction.deferUpdate();

  const sessionManager = getSessionManager();
  const session = await sessionManager.get<FlattenedProfileData>(
    interaction.user.id,
    'profile',
    entityId
  );

  if (session === null) {
    logger.warn({ entityId, sectionId }, 'Session not found for modal submit');
  }

  // Find the section config
  const section = PROFILE_DASHBOARD_CONFIG.sections.find(s => s.id === sectionId);
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
    // Merge with existing session data to preserve other fields
    const currentData = session?.data ?? {};
    const mergedFlat = { ...currentData, ...values } as Partial<FlattenedProfileData>;

    // Convert to API format
    const updatePayload = unflattenProfileData(mergedFlat);

    // Update profile via API
    const updatedProfile = await updateProfile(entityId, updatePayload, interaction.user.id);

    if (!updatedProfile) {
      await interaction.followUp({
        content: '❌ Failed to save profile. Please try again.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Flatten the response for dashboard display
    const flattenedData = flattenProfileData(updatedProfile);

    // Update session
    if (session) {
      await sessionManager.update<FlattenedProfileData>(
        interaction.user.id,
        'profile',
        entityId,
        flattenedData
      );
    }

    // Refresh dashboard
    await refreshDashboardUI(interaction, entityId, flattenedData);

    logger.info({ profileId: entityId, sectionId }, 'Profile section updated');
  } catch (error) {
    logger.error({ err: error, entityId, sectionId }, 'Failed to update profile section');
    // Dashboard will remain in its previous state since we deferred
  }
}

/**
 * Handle select menu interactions for dashboard
 */
export async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  const parsed = parseDashboardCustomId(interaction.customId);
  if (parsed?.entityType !== 'profile' || parsed.entityId === undefined) {
    return;
  }

  const value = interaction.values[0];
  const entityId = parsed.entityId;

  // Handle section edit selection
  if (value.startsWith('edit-')) {
    const sectionId = value.replace('edit-', '');
    const section = PROFILE_DASHBOARD_CONFIG.sections.find(s => s.id === sectionId);
    if (!section) {
      await interaction.reply({
        content: '❌ Unknown section.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Get current data from session or fetch
    const sessionManager = getSessionManager();
    const session = await sessionManager.get<FlattenedProfileData>(
      interaction.user.id,
      'profile',
      entityId
    );
    let profileData: FlattenedProfileData;

    if (session !== null) {
      profileData = session.data;
    } else {
      // Fetch fresh data
      const profile = await fetchProfile(entityId, interaction.user.id);
      if (!profile) {
        await interaction.reply({
          content: '❌ Profile not found.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      profileData = flattenProfileData(profile);
      // Create new session
      await sessionManager.set({
        userId: interaction.user.id,
        entityType: 'profile',
        entityId,
        data: profileData,
        messageId: interaction.message.id,
        channelId: interaction.channelId,
      });
    }

    // Build and show section modal
    const modal = buildSectionModal<FlattenedProfileData>(
      PROFILE_DASHBOARD_CONFIG,
      section,
      entityId,
      profileData
    );
    await interaction.showModal(modal);
    return;
  }
}

/**
 * Handle close button - delete session and close dashboard.
 */
async function handleCloseButton(interaction: ButtonInteraction, entityId: string): Promise<void> {
  const sessionManager = getSessionManager();
  await sessionManager.delete(interaction.user.id, 'profile', entityId);

  await interaction.update({
    content: '✅ Dashboard closed.',
    embeds: [],
    components: [],
  });
}

/**
 * Handle refresh button - fetch fresh data and update dashboard.
 */
async function handleRefreshButton(
  interaction: ButtonInteraction,
  entityId: string
): Promise<void> {
  await interaction.deferUpdate();

  const profile = await fetchProfile(entityId, interaction.user.id);

  if (!profile) {
    await interaction.editReply({
      content: '❌ Profile not found.',
      embeds: [],
      components: [],
    });
    return;
  }

  const flattenedData = flattenProfileData(profile);

  const sessionManager = getSessionManager();
  await sessionManager.set({
    userId: interaction.user.id,
    entityType: 'profile',
    entityId,
    data: flattenedData,
    messageId: interaction.message.id,
    channelId: interaction.channelId,
  });

  await refreshDashboardUI(interaction, entityId, flattenedData);
}

/**
 * Handle delete button - show confirmation dialog.
 */
async function handleDeleteButton(interaction: ButtonInteraction, entityId: string): Promise<void> {
  const sessionManager = getSessionManager();
  const session = await sessionManager.get<FlattenedProfileData>(
    interaction.user.id,
    'profile',
    entityId
  );

  if (!session) {
    await interaction.reply({
      content: '❌ Session expired. Please reopen the dashboard.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check if this is the default profile
  const isDefault = await isDefaultProfile(entityId, interaction.user.id);
  if (isDefault) {
    await interaction.reply({
      content:
        '❌ Cannot delete your default profile.\n\n' +
        'Use `/me profile default <other-profile>` to set a different default first.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Show confirmation dialog
  const confirmEmbed = new EmbedBuilder()
    .setTitle('🗑️ Delete Profile?')
    .setDescription(
      `Are you sure you want to delete **${session.data.name}**?\n\n` +
        'This action cannot be undone. Any personality-specific overrides using this profile will be cleared.'
    )
    .setColor(DISCORD_COLORS.WARNING);

  const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`profile::cancel-delete::${entityId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`profile::confirm-delete::${entityId}`)
      .setLabel('Delete')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🗑️')
  );

  await interaction.update({
    embeds: [confirmEmbed],
    components: [confirmRow],
  });
}

/**
 * Handle confirm-delete button - actually delete the profile.
 */
async function handleConfirmDeleteButton(
  interaction: ButtonInteraction,
  entityId: string
): Promise<void> {
  await interaction.deferUpdate();

  const sessionManager = getSessionManager();
  const session = await sessionManager.get<FlattenedProfileData>(
    interaction.user.id,
    'profile',
    entityId
  );

  const profileName = session?.data.name ?? 'Profile';

  const result = await deleteProfile(entityId, interaction.user.id);

  if (!result.success) {
    await interaction.editReply({
      content: `❌ Failed to delete profile: ${result.error}`,
      embeds: [],
      components: [],
    });
    return;
  }

  // Clean up session
  await sessionManager.delete(interaction.user.id, 'profile', entityId);

  // Show success
  await interaction.editReply({
    content: `✅ **${profileName}** has been deleted.`,
    embeds: [],
    components: [],
  });

  logger.info({ userId: interaction.user.id, entityId, profileName }, 'Profile deleted');
}

/**
 * Handle cancel-delete button - return to dashboard.
 */
async function handleCancelDeleteButton(
  interaction: ButtonInteraction,
  entityId: string
): Promise<void> {
  await interaction.deferUpdate();

  const sessionManager = getSessionManager();
  const session = await sessionManager.get<FlattenedProfileData>(
    interaction.user.id,
    'profile',
    entityId
  );

  if (!session) {
    await interaction.editReply({
      content: '❌ Session expired. Please reopen the dashboard.',
      embeds: [],
      components: [],
    });
    return;
  }

  // Refresh dashboard to return from confirmation view
  await refreshDashboardUI(interaction, entityId, session.data);
}

/**
 * Handle button interactions for dashboard
 */
export async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const parsed = parseDashboardCustomId(interaction.customId);
  if (parsed?.entityType !== 'profile' || parsed.entityId === undefined) {
    return;
  }

  const entityId = parsed.entityId;
  const action = parsed.action;

  switch (action) {
    case 'close':
      await handleCloseButton(interaction, entityId);
      break;
    case 'refresh':
      await handleRefreshButton(interaction, entityId);
      break;
    case 'delete':
      await handleDeleteButton(interaction, entityId);
      break;
    case 'confirm-delete':
      await handleConfirmDeleteButton(interaction, entityId);
      break;
    case 'cancel-delete':
      await handleCancelDeleteButton(interaction, entityId);
      break;
  }
}

/**
 * Check if interaction is a profile dashboard interaction
 */
export function isProfileDashboardInteraction(customId: string): boolean {
  return isDashboardInteraction(customId, 'profile');
}
