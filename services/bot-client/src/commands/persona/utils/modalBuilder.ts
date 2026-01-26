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
 * Check if a value is a non-empty string
 */
function hasValue(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && value.length > 0;
}

/**
 * Set input value if data exists
 */
function setValueIfExists(input: TextInputBuilder, value: string | null | undefined): void {
  if (hasValue(value)) {
    input.setValue(value);
  }
}

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

    setValueIfExists(nameInput, existingData?.name);
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

  setValueIfExists(descriptionInput, existingData?.description);
  rows.push(new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput));

  // Preferred Name input
  const preferredNameInput = new TextInputBuilder()
    .setCustomId('preferredName')
    .setLabel(opts.preferredNameLabel)
    .setPlaceholder(opts.preferredNamePlaceholder)
    .setStyle(TextInputStyle.Short)
    .setMaxLength(255)
    .setRequired(false);

  setValueIfExists(preferredNameInput, existingData?.preferredName);
  rows.push(new ActionRowBuilder<TextInputBuilder>().addComponents(preferredNameInput));

  // Pronouns input
  const pronounsInput = new TextInputBuilder()
    .setCustomId('pronouns')
    .setLabel('Pronouns')
    .setPlaceholder('e.g., she/her, he/him, they/them')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(100)
    .setRequired(false);

  setValueIfExists(pronounsInput, existingData?.pronouns);
  rows.push(new ActionRowBuilder<TextInputBuilder>().addComponents(pronounsInput));

  // Content input (longer text) - may need truncation
  const contentInput = new TextInputBuilder()
    .setCustomId('content')
    .setLabel(opts.contentLabel)
    .setPlaceholder(opts.contentPlaceholder)
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH)
    .setRequired(false);

  if (hasValue(existingData?.content)) {
    const truncatedContent =
      existingData.content.length > DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH
        ? existingData.content.substring(0, DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH)
        : existingData.content;
    contentInput.setValue(truncatedContent);
  }

  rows.push(new ActionRowBuilder<TextInputBuilder>().addComponents(contentInput));

  return rows;
}
