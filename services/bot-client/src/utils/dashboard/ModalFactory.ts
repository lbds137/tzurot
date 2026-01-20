/**
 * Modal Factory
 *
 * Creates modals for dashboard section editing with pre-filled values.
 * Reusable across /character, /profile, /preset, etc.
 */

import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  type ModalActionRowComponentBuilder,
} from 'discord.js';
import {
  type DashboardConfig,
  type SectionDefinition,
  type FieldDefinition,
  type DashboardContext,
  buildDashboardCustomId,
  resolveContextAware,
} from './types.js';

/**
 * Default field constraints
 */
const DEFAULT_CONSTRAINTS = {
  SHORT_MAX_LENGTH: 100,
  PARAGRAPH_MAX_LENGTH: 4000,
  MIN_LENGTH: 0,
};

/**
 * Build a modal for editing a dashboard section
 *
 * @param config - Dashboard configuration
 * @param section - Section being edited
 * @param entityId - Entity ID
 * @param currentData - Current entity data for pre-filling
 * @param context - Optional dashboard context for resolving context-aware field properties
 */
export function buildSectionModal<T extends Record<string, unknown>>(
  config: DashboardConfig<T>,
  section: SectionDefinition<T>,
  entityId: string,
  currentData: T,
  context?: DashboardContext
): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(buildDashboardCustomId(config.entityType, 'modal', entityId, section.id))
    .setTitle(`Edit ${section.label.replace(/^[^\w\s]+\s*/, '')}`); // Remove leading emoji

  // Filter out hidden fields when context is provided
  let visibleFields = section.fields;
  if (context !== undefined) {
    visibleFields = section.fields.filter(
      field => !resolveContextAware(field.hidden, context, false)
    );
  }

  // Add fields (max 5 per Discord limit)
  const fieldsToAdd = visibleFields.slice(0, 5);

  for (const field of fieldsToAdd) {
    const textInput = buildTextInput(field, currentData);
    const row = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(textInput);
    modal.addComponents(row);
  }

  return modal;
}

/**
 * Build a text input component for a field
 */
function buildTextInput<T extends Record<string, unknown>>(
  field: FieldDefinition,
  currentData: T
): TextInputBuilder {
  const input = new TextInputBuilder()
    .setCustomId(field.id)
    .setLabel(field.label)
    .setStyle(field.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
    .setRequired(field.required ?? false);

  // Set placeholder if provided
  if (field.placeholder !== undefined && field.placeholder.length > 0) {
    input.setPlaceholder(field.placeholder);
  }

  // Set length constraints
  const maxLength =
    field.maxLength ??
    (field.style === 'paragraph'
      ? DEFAULT_CONSTRAINTS.PARAGRAPH_MAX_LENGTH
      : DEFAULT_CONSTRAINTS.SHORT_MAX_LENGTH);

  input.setMaxLength(maxLength);

  if (field.minLength !== undefined && field.minLength > 0) {
    input.setMinLength(field.minLength);
  }

  // Pre-fill with current value if it exists
  const currentValue = currentData[field.id];
  if (currentValue !== undefined && currentValue !== null && typeof currentValue === 'string') {
    // Discord modals require value to be within length constraints
    const truncatedValue = currentValue.slice(0, maxLength);
    input.setValue(truncatedValue);
  }

  return input;
}

/**
 * Build a simple modal with custom fields (not tied to a dashboard section)
 *
 * Useful for seed modals or one-off forms.
 */
export function buildSimpleModal(
  customId: string,
  title: string,
  fields: FieldDefinition[],
  initialValues?: Record<string, string>
): ModalBuilder {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title);

  // Add fields (max 5 per Discord limit)
  const fieldsToAdd = fields.slice(0, 5);

  for (const field of fieldsToAdd) {
    const input = new TextInputBuilder()
      .setCustomId(field.id)
      .setLabel(field.label)
      .setStyle(field.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(field.required ?? false);

    if (field.placeholder !== undefined && field.placeholder.length > 0) {
      input.setPlaceholder(field.placeholder);
    }

    const maxLength =
      field.maxLength ??
      (field.style === 'paragraph'
        ? DEFAULT_CONSTRAINTS.PARAGRAPH_MAX_LENGTH
        : DEFAULT_CONSTRAINTS.SHORT_MAX_LENGTH);

    input.setMaxLength(maxLength);

    if (field.minLength !== undefined && field.minLength > 0) {
      input.setMinLength(field.minLength);
    }

    // Pre-fill if initial value provided
    const initialValue = initialValues?.[field.id];
    if (initialValue !== undefined && initialValue.length > 0) {
      input.setValue(initialValue.slice(0, maxLength));
    }

    const row = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(input);
    modal.addComponents(row);
  }

  return modal;
}

/**
 * Extract field values from a modal submission
 */
export function extractModalValues(
  interaction: { fields: { getTextInputValue: (id: string) => string } },
  fieldIds: string[]
): Record<string, string> {
  const values: Record<string, string> = {};

  for (const fieldId of fieldIds) {
    try {
      const value = interaction.fields.getTextInputValue(fieldId);
      // Store empty strings as empty, let the caller decide how to handle
      values[fieldId] = value;
    } catch {
      // Field wasn't in the modal, skip it
    }
  }

  return values;
}

/**
 * Validate extracted modal values against field definitions
 */
export function validateModalValues(
  values: Record<string, string>,
  fields: FieldDefinition[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const field of fields) {
    const value = values[field.id];

    // Check required fields
    if (field.required === true && (value === undefined || value.trim().length === 0)) {
      errors.push(`${field.label} is required`);
      continue;
    }

    // Check min length (only if value is provided)
    if (
      value !== undefined &&
      value.length > 0 &&
      field.minLength !== undefined &&
      field.minLength > 0 &&
      value.length < field.minLength
    ) {
      errors.push(`${field.label} must be at least ${field.minLength} characters`);
    }

    // Check max length (only if value is provided)
    if (
      value !== undefined &&
      value.length > 0 &&
      field.maxLength !== undefined &&
      field.maxLength > 0 &&
      value.length > field.maxLength
    ) {
      errors.push(`${field.label} must be at most ${field.maxLength} characters`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
