/**
 * Profile Modal Builder Utilities
 *
 * Shared utilities for building profile modals across commands.
 * Used by: create, edit, and override commands.
 */

import { TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { DISCORD_LIMITS } from '@tzurot/common-types';

/**
 * Existing profile data for pre-filling modal fields
 */
export interface PersonaModalData {
  name?: string | null;
  description?: string | null;
  preferredName?: string | null;
  pronouns?: string | null;
  content?: string | null;
}

/**
 * Options for customizing modal field labels and placeholders
 */
export interface PersonaModalOptions {
  /** Whether to include the profile name field (default: true) */
  includeNameField?: boolean;
  /** Custom placeholder for profile name */
  namePlaceholder?: string;
  /** Custom label for description field */
  descriptionLabel?: string;
  /** Custom placeholder for description field */
  descriptionPlaceholder?: string;
  /** Custom placeholder for preferred name */
  preferredNamePlaceholder?: string;
  /** Custom label for preferred name field */
  preferredNameLabel?: string;
  /** Custom label for content field */
  contentLabel?: string;
  /** Custom placeholder for content field */
  contentPlaceholder?: string;
}

const DEFAULT_OPTIONS: Required<PersonaModalOptions> = {
  includeNameField: true,
  namePlaceholder: 'A name for this profile (e.g., Default, Work, Creative)',
  descriptionLabel: 'Description (for your reference)',
  descriptionPlaceholder: 'A short note to help you remember this profile',
  preferredNamePlaceholder: 'What should AI call you?',
  preferredNameLabel: 'Preferred Name (what AI calls you)',
  contentLabel: 'About You',
  contentPlaceholder: 'Tell the AI about yourself: interests, personality, context...',
};

/**
 * Build profile modal input fields
 *
 * Creates standardized input fields for profile modals with optional pre-filling.
 * Ensures consistent field IDs across all profile-related modals.
 *
 * @param existingData - Existing profile data to pre-fill (optional)
 * @param options - Customization options for labels/placeholders
 * @returns Array of ActionRowBuilder components ready to add to a modal
 */
export function buildPersonaModalFields(
  existingData?: PersonaModalData | null,
  options?: PersonaModalOptions
): ActionRowBuilder<TextInputBuilder>[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const rows: ActionRowBuilder<TextInputBuilder>[] = [];

  // Profile Name input (optional, but required when included)
  if (opts.includeNameField) {
    const nameInput = new TextInputBuilder()
      .setCustomId('personaName')
      .setLabel('Profile Name')
      .setPlaceholder(opts.namePlaceholder)
      .setStyle(TextInputStyle.Short)
      .setMaxLength(100)
      .setRequired(true);

    if (
      existingData?.name !== null &&
      existingData?.name !== undefined &&
      existingData.name.length > 0
    ) {
      nameInput.setValue(existingData.name);
    }

    rows.push(new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput));
  }

  // Description input (short note for user's reference)
  const descriptionInput = new TextInputBuilder()
    .setCustomId('description')
    .setLabel(opts.descriptionLabel)
    .setPlaceholder(opts.descriptionPlaceholder)
    .setStyle(TextInputStyle.Short)
    .setMaxLength(255)
    .setRequired(false);

  if (
    existingData?.description !== null &&
    existingData?.description !== undefined &&
    existingData.description.length > 0
  ) {
    descriptionInput.setValue(existingData.description);
  }

  rows.push(new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput));

  // Preferred Name input
  const preferredNameInput = new TextInputBuilder()
    .setCustomId('preferredName')
    .setLabel(opts.preferredNameLabel)
    .setPlaceholder(opts.preferredNamePlaceholder)
    .setStyle(TextInputStyle.Short)
    .setMaxLength(255)
    .setRequired(false);

  if (
    existingData?.preferredName !== null &&
    existingData?.preferredName !== undefined &&
    existingData.preferredName.length > 0
  ) {
    preferredNameInput.setValue(existingData.preferredName);
  }

  rows.push(new ActionRowBuilder<TextInputBuilder>().addComponents(preferredNameInput));

  // Pronouns input
  const pronounsInput = new TextInputBuilder()
    .setCustomId('pronouns')
    .setLabel('Pronouns')
    .setPlaceholder('e.g., she/her, he/him, they/them')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(100)
    .setRequired(false);

  if (
    existingData?.pronouns !== null &&
    existingData?.pronouns !== undefined &&
    existingData.pronouns.length > 0
  ) {
    pronounsInput.setValue(existingData.pronouns);
  }

  rows.push(new ActionRowBuilder<TextInputBuilder>().addComponents(pronounsInput));

  // Content input (longer text)
  const contentInput = new TextInputBuilder()
    .setCustomId('content')
    .setLabel(opts.contentLabel)
    .setPlaceholder(opts.contentPlaceholder)
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH)
    .setRequired(false);

  if (
    existingData?.content !== null &&
    existingData?.content !== undefined &&
    existingData.content.length > 0
  ) {
    // Truncate if exceeds modal limit
    const truncatedContent =
      existingData.content.length > DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH
        ? existingData.content.substring(0, DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH)
        : existingData.content;
    contentInput.setValue(truncatedContent);
  }

  rows.push(new ActionRowBuilder<TextInputBuilder>().addComponents(contentInput));

  return rows;
}
