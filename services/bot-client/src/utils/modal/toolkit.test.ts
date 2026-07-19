/**
 * Tests for the Label-based modal toolkit.
 *
 * Build tests assert over `toJSON()` output so discord.js's own component
 * assertions run — a payload these tests accept is one the library would
 * actually serialize.
 */

import { describe, it, expect, vi } from 'vitest';
import { ComponentType } from 'discord.js';
import {
  buildToolkitModal,
  extractSubmission,
  textFieldFromDefinition,
  validateSubmission,
  type ModalItem,
  type SubmissionFieldReader,
} from './toolkit.js';

const ITEMS: ModalItem[] = [
  { kind: 'display', content: 'Pick your settings below.' },
  {
    kind: 'text',
    id: 'name',
    label: 'Name',
    description: 'Shown everywhere this entity appears.',
    required: true,
    maxLength: 100,
    placeholder: 'e.g. Lilith',
  },
  {
    kind: 'select',
    id: 'scope',
    label: 'Scope',
    placeholder: 'Choose a scope…',
    minValues: 1,
    maxValues: 1,
    options: [
      { label: 'Personal', value: 'user', default: true },
      { label: 'Global', value: 'global', description: 'Bot-owner only' },
    ],
  },
  {
    kind: 'radio',
    id: 'mode',
    label: 'Mode',
    required: true,
    options: [
      { label: 'Standard', value: 'standard' },
      { label: 'Strict', value: 'strict', default: true },
    ],
  },
  {
    kind: 'checkboxGroup',
    id: 'features',
    label: 'Features',
    options: [
      { label: 'Voice', value: 'voice' },
      { label: 'Images', value: 'images' },
    ],
    minValues: 0,
    maxValues: 2,
  },
  { kind: 'checkbox', id: 'public', label: 'Public', default: true },
  { kind: 'fileUpload', id: 'avatar', label: 'Avatar', minFiles: 1, maxFiles: 1 },
];

describe('buildToolkitModal', () => {
  it('renders fields as Labels (with descriptions) and display blocks as Text Display', () => {
    const modal = buildToolkitModal({
      customId: 'test::seed',
      title: 'Create Thing',
      items: ITEMS,
    });
    const json = modal.toJSON();

    expect(json.custom_id).toBe('test::seed');
    expect(json.title).toBe('Create Thing');
    expect(json.components).toHaveLength(ITEMS.length);

    const [display, nameLabel] = json.components as [
      { type: number; content?: string },
      { type: number; label?: string; description?: string; component?: { type: number } },
    ];
    expect(display.type).toBe(ComponentType.TextDisplay);
    expect(display.content).toBe('Pick your settings below.');
    expect(nameLabel.type).toBe(ComponentType.Label);
    expect(nameLabel.label).toBe('Name');
    expect(nameLabel.description).toBe('Shown everywhere this entity appears.');
    expect(nameLabel.component?.type).toBe(ComponentType.TextInput);
  });

  it('carries option metadata and per-kind knobs through to the payload', () => {
    const json = buildToolkitModal({ customId: 'x', title: 'T', items: ITEMS }).toJSON();
    const byLabel = new Map(
      (json.components as { label?: string; component?: Record<string, unknown> }[]).map(c => [
        c.label,
        c.component,
      ])
    );

    const select = byLabel.get('Scope') as {
      type: number;
      placeholder?: string;
      min_values?: number;
      max_values?: number;
      options: { value: string; default?: boolean; description?: string }[];
    };
    expect(select.type).toBe(ComponentType.StringSelect);
    expect(select.placeholder).toBe('Choose a scope…');
    expect(select.min_values).toBe(1);
    expect(select.max_values).toBe(1);
    expect(select.options[0].default).toBe(true);
    expect(select.options[1].description).toBe('Bot-owner only');

    const radio = byLabel.get('Mode') as {
      type: number;
      required?: boolean;
      options: { value: string; default?: boolean }[];
    };
    expect(radio.type).toBe(ComponentType.RadioGroup);
    expect(radio.required).toBe(true);
    expect(radio.options.map(o => o.value)).toEqual(['standard', 'strict']);
    expect(radio.options[1].default).toBe(true);

    const group = byLabel.get('Features') as {
      type: number;
      min_values?: number;
      max_values?: number;
      options: { value: string }[];
    };
    expect(group.type).toBe(ComponentType.CheckboxGroup);
    expect(group.min_values).toBe(0);
    expect(group.max_values).toBe(2);
    expect(group.options.map(o => o.value)).toEqual(['voice', 'images']);

    const checkbox = byLabel.get('Public') as { type: number; default?: boolean };
    expect(checkbox.type).toBe(ComponentType.Checkbox);
    expect(checkbox.default).toBe(true);

    const upload = byLabel.get('Avatar') as {
      type: number;
      min_values?: number;
      max_values?: number;
    };
    expect(upload.type).toBe(ComponentType.FileUpload);
    expect(upload.min_values).toBe(1);
    expect(upload.max_values).toBe(1);
  });

  it('adapts a dashboard FieldDefinition, carrying length bounds through to the payload', () => {
    const field = textFieldFromDefinition({
      id: 'name',
      label: 'Name',
      placeholder: 'e.g. Lilith',
      required: true,
      style: 'short',
      minLength: 2,
      maxLength: 50,
    });
    const json = buildToolkitModal({ customId: 'x', title: 'T', items: [field] }).toJSON();

    const input = (json.components as { component?: Record<string, unknown> }[])[0].component as {
      custom_id: string;
      min_length?: number;
      max_length?: number;
      required?: boolean;
    };
    expect(input.custom_id).toBe('name');
    expect(input.min_length).toBe(2);
    expect(input.max_length).toBe(50);
    expect(input.required).toBe(true);
  });

  it('prefers initialValues over a text field own initialValue and truncates to maxLength', () => {
    const items: ModalItem[] = [
      { kind: 'text', id: 'bio', label: 'Bio', maxLength: 5, initialValue: 'original' },
    ];

    const withOwn = buildToolkitModal({ customId: 'x', title: 'T', items }).toJSON();
    const withOverride = buildToolkitModal({
      customId: 'x',
      title: 'T',
      items,
      initialValues: { bio: 'resubmitted' },
    }).toJSON();

    const valueOf = (json: typeof withOwn): string | undefined =>
      (json.components as { component?: { value?: string } }[])[0].component?.value;
    expect(valueOf(withOwn)).toBe('origi');
    expect(valueOf(withOverride)).toBe('resub');
  });
});

describe('extractSubmission', () => {
  function reader(overrides: Partial<SubmissionFieldReader> = {}): SubmissionFieldReader {
    return {
      getTextInputValue: vi.fn(() => 'Lilith'),
      getStringSelectValues: vi.fn(() => ['user']),
      getRadioGroup: vi.fn(() => 'strict'),
      getCheckboxGroup: vi.fn(() => ['voice']),
      getCheckbox: vi.fn(() => true),
      ...overrides,
    };
  }

  it('reads each interactive kind and skips display + file uploads', () => {
    const values = extractSubmission(ITEMS, reader());

    expect(values).toEqual({
      name: 'Lilith',
      scope: ['user'],
      mode: 'strict',
      features: ['voice'],
      public: true,
    });
    expect(values).not.toHaveProperty('avatar');
  });

  it('skips fields absent from the submission instead of throwing', () => {
    const values = extractSubmission(
      ITEMS,
      reader({
        getRadioGroup: vi.fn(() => {
          throw new Error('not present');
        }),
      })
    );

    expect(values).not.toHaveProperty('mode');
    expect(values.name).toBe('Lilith');
  });
});

describe('validateSubmission', () => {
  const items: ModalItem[] = [
    { kind: 'text', id: 'name', label: 'Name', required: true, maxLength: 10 },
    { kind: 'text', id: 'bio', label: 'Bio', minLength: 3, maxLength: 5 },
    { kind: 'checkbox', id: 'public', label: 'Public' },
  ];

  it('accepts valid values and ignores non-text kinds', () => {
    const result = validateSubmission({ name: 'Lilith', bio: 'abc', public: false }, items);
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it('accepts an empty optional text field without running length rules', () => {
    const result = validateSubmission({ name: 'ok', bio: '' }, items);
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it('flags required, min, and max violations with field labels', () => {
    const result = validateSubmission({ name: '  ', bio: 'toolong' }, items);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(['Name is required', 'Bio must be at most 5 characters']);

    expect(validateSubmission({ name: 'ok', bio: 'ab' }, items).errors).toEqual([
      'Bio must be at least 3 characters',
    ]);
  });
});
