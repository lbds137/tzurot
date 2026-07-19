/**
 * Label-based modal toolkit (design-system G4/D15).
 *
 * The component-era modal API hosts every input inside a Label — which
 * carries the field's title AND an optional description line (inline docs,
 * the D15 affordance the legacy ActionRow shape had no room for) — and
 * adds non-text field kinds: string selects, radio groups, checkbox
 * groups, single checkboxes, and file uploads. Plain Text Display blocks
 * interleave as section prose; they are NON-INTERACTIVE, so extraction
 * skips them.
 *
 * This module is the typed vocabulary over that API:
 *
 * - `ModalItem` — discriminated union of field kinds + display blocks.
 * - `buildToolkitModal` — items → a Label-based `ModalBuilder`.
 * - `extractSubmission` — kind-aware read of a submission into a value
 *   record (file uploads excluded: attachments aren't string-shaped —
 *   read them via `interaction.fields.getUploadedFiles`).
 * - `validateSubmission` — text-kind length/required rules, mirroring the
 *   dashboard ModalFactory's contract.
 *
 * The dashboard's `ModalFactory` (`buildSectionModal`/`buildSimpleModal`)
 * still renders the legacy ActionRow shape; it migrates onto this module
 * once Labels are runtime-proven on the create-modal exemplars.
 */

import {
  CheckboxBuilder,
  CheckboxGroupBuilder,
  CheckboxGroupOptionBuilder,
  FileUploadBuilder,
  LabelBuilder,
  ModalBuilder,
  RadioGroupBuilder,
  RadioGroupOptionBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { FieldDefinition } from '../dashboard/types.js';

/** One choice in a select / radio / checkbox-group field. */
export interface ModalChoice {
  label: string;
  value: string;
  description?: string;
  default?: boolean;
}

interface ModalFieldBase {
  /** Submission key; must be unique within the modal. */
  id: string;
  /** Label title shown above the input. */
  label: string;
  /** Inline docs rendered under the label (D15). */
  description?: string;
  required?: boolean;
}

export interface TextModalField extends ModalFieldBase {
  kind: 'text';
  style?: 'short' | 'paragraph';
  placeholder?: string;
  minLength?: number;
  /** Required — every text field caps its own length (Discord: 1–4000). */
  maxLength: number;
  /** Pre-filled value (truncated to maxLength). */
  initialValue?: string;
}

export interface SelectModalField extends ModalFieldBase {
  kind: 'select';
  options: ModalChoice[];
  placeholder?: string;
  minValues?: number;
  maxValues?: number;
}

export interface RadioModalField extends ModalFieldBase {
  kind: 'radio';
  options: ModalChoice[];
}

export interface CheckboxGroupModalField extends ModalFieldBase {
  kind: 'checkboxGroup';
  options: ModalChoice[];
  minValues?: number;
  maxValues?: number;
}

export interface CheckboxModalField extends ModalFieldBase {
  kind: 'checkbox';
  /** Pre-checked state. */
  default?: boolean;
}

export interface FileUploadModalField extends ModalFieldBase {
  kind: 'fileUpload';
  minFiles?: number;
  maxFiles?: number;
}

/** Non-interactive prose block between fields; skipped by extraction. */
export interface DisplayModalItem {
  kind: 'display';
  content: string;
}

export type ModalField =
  | TextModalField
  | SelectModalField
  | RadioModalField
  | CheckboxGroupModalField
  | CheckboxModalField
  | FileUploadModalField;

export type ModalItem = ModalField | DisplayModalItem;

export interface BuildToolkitModalOptions {
  customId: string;
  title: string;
  items: ModalItem[];
  /**
   * Text-field prefills by field id — overrides each field's own
   * `initialValue`. The preserve-input-on-validation-failure affordance
   * feeds resubmitted values back through here.
   */
  initialValues?: Record<string, string>;
}

/**
 * Adapt a dashboard `FieldDefinition` to a text field. Bridges existing
 * seed-field configs onto the toolkit without reshaping them; the
 * context-aware `hidden` flag is a dashboard-section concern and is not
 * carried (seed fields never use it).
 */
export function textFieldFromDefinition(field: FieldDefinition): TextModalField {
  return {
    kind: 'text',
    id: field.id,
    label: field.label,
    style: field.style,
    placeholder: field.placeholder,
    required: field.required,
    minLength: field.minLength,
    maxLength: field.maxLength,
  };
}

/** Structural shape shared by select/radio/checkbox-group option builders. */
interface OptionLikeBuilder {
  setLabel(label: string): this;
  setValue(value: string): this;
  setDescription(description: string): this;
  setDefault(isDefault: boolean): this;
}

/** Choice list → option builders (shared by select/radio/checkbox-group). */
function toOptionBuilders<TBuilder extends OptionLikeBuilder>(
  options: ModalChoice[],
  make: () => TBuilder
): TBuilder[] {
  return options.map(choice => {
    const builder = make().setLabel(choice.label).setValue(choice.value);
    if (choice.description !== undefined && choice.description.length > 0) {
      builder.setDescription(choice.description);
    }
    if (choice.default === true) {
      builder.setDefault(true);
    }
    return builder;
  });
}

function buildTextInput(
  field: TextModalField,
  initialValues?: Record<string, string>
): TextInputBuilder {
  const input = new TextInputBuilder()
    .setCustomId(field.id)
    .setStyle(field.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
    .setRequired(field.required ?? false)
    .setMaxLength(field.maxLength);
  if (field.placeholder !== undefined && field.placeholder.length > 0) {
    input.setPlaceholder(field.placeholder);
  }
  if (field.minLength !== undefined && field.minLength > 0) {
    input.setMinLength(field.minLength);
  }
  const value = initialValues?.[field.id] ?? field.initialValue;
  if (value !== undefined && value.length > 0) {
    input.setValue(value.slice(0, field.maxLength));
  }
  return input;
}

function buildSelect(field: SelectModalField): StringSelectMenuBuilder {
  const select = new StringSelectMenuBuilder()
    .setCustomId(field.id)
    .setRequired(field.required ?? false)
    .addOptions(toOptionBuilders(field.options, () => new StringSelectMenuOptionBuilder()));
  if (field.placeholder !== undefined && field.placeholder.length > 0) {
    select.setPlaceholder(field.placeholder);
  }
  if (field.minValues !== undefined) {
    select.setMinValues(field.minValues);
  }
  if (field.maxValues !== undefined) {
    select.setMaxValues(field.maxValues);
  }
  return select;
}

function buildCheckboxGroup(field: CheckboxGroupModalField): CheckboxGroupBuilder {
  const group = new CheckboxGroupBuilder()
    .setCustomId(field.id)
    .setRequired(field.required ?? false)
    .addOptions(toOptionBuilders(field.options, () => new CheckboxGroupOptionBuilder()));
  if (field.minValues !== undefined) {
    group.setMinValues(field.minValues);
  }
  if (field.maxValues !== undefined) {
    group.setMaxValues(field.maxValues);
  }
  return group;
}

function buildRadioGroup(field: RadioModalField): RadioGroupBuilder {
  return new RadioGroupBuilder()
    .setCustomId(field.id)
    .setRequired(field.required ?? false)
    .addOptions(toOptionBuilders(field.options, () => new RadioGroupOptionBuilder()));
}

function buildFileUpload(field: FileUploadModalField): FileUploadBuilder {
  const upload = new FileUploadBuilder().setCustomId(field.id).setRequired(field.required ?? false);
  if (field.minFiles !== undefined) {
    upload.setMinValues(field.minFiles);
  }
  if (field.maxFiles !== undefined) {
    upload.setMaxValues(field.maxFiles);
  }
  return upload;
}

/** Attach the field's component to its Label (kind dispatch). */
function attachComponent(
  label: LabelBuilder,
  field: ModalField,
  initialValues?: Record<string, string>
): void {
  switch (field.kind) {
    case 'text':
      label.setTextInputComponent(buildTextInput(field, initialValues));
      break;
    case 'select':
      label.setStringSelectMenuComponent(buildSelect(field));
      break;
    case 'radio':
      label.setRadioGroupComponent(buildRadioGroup(field));
      break;
    case 'checkboxGroup':
      label.setCheckboxGroupComponent(buildCheckboxGroup(field));
      break;
    case 'checkbox':
      label.setCheckboxComponent(
        new CheckboxBuilder().setCustomId(field.id).setDefault(field.default ?? false)
      );
      break;
    case 'fileUpload':
      label.setFileUploadComponent(buildFileUpload(field));
      break;
  }
}

/** Build a Label-based modal from typed items. */
export function buildToolkitModal(options: BuildToolkitModalOptions): ModalBuilder {
  const modal = new ModalBuilder().setCustomId(options.customId).setTitle(options.title);

  for (const item of options.items) {
    if (item.kind === 'display') {
      modal.addTextDisplayComponents(new TextDisplayBuilder().setContent(item.content));
      continue;
    }
    const label = new LabelBuilder().setLabel(item.label);
    if (item.description !== undefined && item.description.length > 0) {
      label.setDescription(item.description);
    }
    attachComponent(label, item, options.initialValues);
    modal.addLabelComponents(label);
  }

  return modal;
}

/**
 * Structural slice of `ModalSubmitFields` — lets tests stub submissions
 * without discord.js internals.
 */
export interface SubmissionFieldReader {
  getTextInputValue(customId: string): string;
  getStringSelectValues(customId: string): readonly string[];
  getRadioGroup(customId: string, required?: boolean): string | null;
  getCheckboxGroup(customId: string): readonly string[];
  getCheckbox(customId: string): boolean;
}

export type SubmissionValue = string | readonly string[] | boolean | null;

/**
 * Kind-aware read of a submission. Display blocks are skipped (they are
 * non-interactive); file uploads are excluded — read attachments via
 * `interaction.fields.getUploadedFiles(id)`. A field absent from the
 * submission (e.g. hidden by a future variant) is skipped, matching the
 * legacy `extractModalValues` contract.
 */
export function extractSubmission(
  items: ModalItem[],
  fields: SubmissionFieldReader
): Record<string, SubmissionValue> {
  const values: Record<string, SubmissionValue> = {};
  for (const item of items) {
    if (item.kind === 'display' || item.kind === 'fileUpload') {
      continue;
    }
    try {
      switch (item.kind) {
        case 'text':
          values[item.id] = fields.getTextInputValue(item.id);
          break;
        case 'select':
          values[item.id] = fields.getStringSelectValues(item.id);
          break;
        case 'radio':
          values[item.id] = fields.getRadioGroup(item.id, false);
          break;
        case 'checkboxGroup':
          values[item.id] = fields.getCheckboxGroup(item.id);
          break;
        case 'checkbox':
          values[item.id] = fields.getCheckbox(item.id);
          break;
      }
    } catch {
      // Field wasn't in the submission — skip it.
    }
  }
  return values;
}

/**
 * Validate text-kind values against their length/required rules. Discord
 * enforces these natively at submit time; this is the defense-in-depth
 * layer for values that reach the handler through other paths (retry
 * stashes, tests), mirroring the dashboard ModalFactory's contract.
 */
function validateTextField(item: TextModalField, value: SubmissionValue | undefined): string[] {
  const text = typeof value === 'string' ? value : undefined;
  if (item.required === true && (text === undefined || text.trim().length === 0)) {
    return [`${item.label} is required`];
  }
  if (text === undefined || text.length === 0) {
    return [];
  }
  const errors: string[] = [];
  if (item.minLength !== undefined && item.minLength > 0 && text.length < item.minLength) {
    errors.push(`${item.label} must be at least ${item.minLength} characters`);
  }
  if (item.maxLength > 0 && text.length > item.maxLength) {
    errors.push(`${item.label} must be at most ${item.maxLength} characters`);
  }
  return errors;
}

export function validateSubmission(
  values: Record<string, SubmissionValue>,
  items: ModalItem[]
): { valid: boolean; errors: string[] } {
  const errors = items
    .filter((item): item is TextModalField => item.kind === 'text')
    .flatMap(item => validateTextField(item, values[item.id]));
  return { valid: errors.length === 0, errors };
}
