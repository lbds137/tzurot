/**
 * Modal toolkit type vocabulary (design-system G4/D15).
 *
 * The discriminated `ModalItem` union describes everything a Label-based
 * modal can host: text inputs, string selects, radio groups, checkbox
 * groups, single checkboxes, file uploads, and non-interactive Text
 * Display prose blocks. Builders/extractors live in `toolkit.ts`.
 */

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
