/**
 * Modal Factory
 *
 * Creates modals for dashboard section editing with pre-filled values.
 * Reusable across /character, /profile, /preset, etc.
 *
 * Rendering is delegated to the Label-based modal toolkit
 * (`utils/modal/toolkit.ts`): each text field renders inside a Label
 * component rather than the legacy ActionRow shape. Submission reading is
 * unchanged — `getTextInputValue` resolves by customId regardless of the
 * hosting component.
 */

import { type ModalBuilder } from 'discord.js';
import {
  buildToolkitModal,
  textFieldFromDefinition,
  truncateByCodePoints,
} from '../modal/toolkit.js';
import {
  type DashboardConfig,
  type SectionDefinition,
  type FieldDefinition,
  type DashboardContext,
  buildDashboardCustomId,
  resolveContextAware,
} from './types.js';

/** Discord caps modals at five top-level components. */
const MAX_MODAL_FIELDS = 5;

/** Collect string prefills for the given fields from an entity record. */
function collectInitialValues<T extends Record<string, unknown>>(
  fields: FieldDefinition[],
  currentData: T
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of fields) {
    const currentValue = currentData[field.id];
    if (currentValue !== undefined && currentValue !== null && typeof currentValue === 'string') {
      values[field.id] = truncateByCodePoints(currentValue, field.maxLength);
    }
  }
  return values;
}

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
  // Filter out hidden fields when context is provided
  let visibleFields = section.fields;
  if (context !== undefined) {
    visibleFields = section.fields.filter(
      field => !resolveContextAware(field.hidden, context, false)
    );
  }

  const fieldsToAdd = visibleFields.slice(0, MAX_MODAL_FIELDS);

  return buildToolkitModal({
    customId: buildDashboardCustomId(config.entityType, 'modal', entityId, section.id),
    title: `Edit ${section.label.replace(/^[^\w\s]+\s*/, '')}`, // Remove leading emoji
    items: fieldsToAdd.map(textFieldFromDefinition),
    initialValues: collectInitialValues(fieldsToAdd, currentData),
  });
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
  return buildToolkitModal({
    customId,
    title,
    items: fields.slice(0, MAX_MODAL_FIELDS).map(textFieldFromDefinition),
    initialValues,
  });
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

    // Check max length (only if value is provided). `maxLength > 0` guard
    // stays as defense against a `maxLength: 0` typo — the type requires
    // the field but doesn't range-check it.
    if (
      value !== undefined &&
      value.length > 0 &&
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
