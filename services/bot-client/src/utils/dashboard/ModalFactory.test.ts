/**
 * Tests for ModalFactory
 */

import { describe, it, expect, vi } from 'vitest';
import { TextInputStyle } from 'discord.js';
import {
  buildSectionModal,
  buildSimpleModal,
  extractModalValues,
  validateModalValues,
} from './ModalFactory.js';
import type {
  DashboardConfig,
  SectionDefinition,
  FieldDefinition,
  DashboardContext,
  SectionStatus,
} from './types.js';

// Factory to create test DashboardConfig with required properties
function createTestConfig<T>(
  entityType: string,
  overrides: Partial<DashboardConfig<T>> = {}
): DashboardConfig<T> {
  return {
    entityType,
    getTitle: () => `Test ${entityType}`,
    sections: [],
    ...overrides,
  };
}

// Factory to create test SectionDefinition with required properties
function createTestSection<T>(
  id: string,
  label: string,
  fields: FieldDefinition[],
  overrides: Partial<SectionDefinition<T>> = {}
): SectionDefinition<T> {
  return {
    id,
    label,
    fields,
    fieldIds: fields.map(f => f.id),
    getStatus: () => 'complete' as SectionStatus,
    getPreview: () => 'Preview',
    ...overrides,
  };
}

// Helper to extract component data from modal JSON
function getModalComponents(modal: ReturnType<typeof buildSectionModal>) {
  const json = modal.toJSON();
  return json.components ?? [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getTextInput(modal: ReturnType<typeof buildSectionModal>, index: number): any {
  const components = getModalComponents(modal);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (components[index] as any)?.components?.[0];
}

describe('ModalFactory', () => {
  describe('buildSectionModal', () => {
    it('should create a modal with correct custom ID and title', () => {
      const config = createTestConfig<{ name: string }>('character');

      const section = createTestSection<{ name: string }>('basic', '📝 Basic Info', [
        { id: 'name', label: 'Name', style: 'short' },
      ]);

      const modal = buildSectionModal(config, section, 'char-123', { name: 'Test' });
      const json = modal.toJSON();

      expect(json.custom_id).toBe('character::modal::char-123::basic');
      expect(json.title).toBe('Edit Basic Info'); // Emoji stripped
    });

    it('should add text input fields with pre-filled values', () => {
      const config = createTestConfig<{ description: string }>('profile');

      const section = createTestSection<{ description: string }>('details', 'Details', [
        {
          id: 'description',
          label: 'Description',
          style: 'paragraph',
          placeholder: 'Enter description...',
          required: true,
        },
      ]);

      const modal = buildSectionModal(config, section, 'prof-456', {
        description: 'Current description',
      });

      const components = getModalComponents(modal);
      expect(components).toHaveLength(1);

      const input = getTextInput(modal, 0);
      expect(input.custom_id).toBe('description');
      expect(input.label).toBe('Description');
      expect(input.style).toBe(TextInputStyle.Paragraph);
      expect(input.required).toBe(true);
      expect(input.value).toBe('Current description');
      expect(input.placeholder).toBe('Enter description...');
    });

    it('should limit fields to 5 (Discord limit)', () => {
      const config = createTestConfig<Record<string, string>>('test');

      const section = createTestSection<Record<string, string>>('many', 'Many Fields', [
        { id: 'f1', label: 'Field 1', style: 'short' },
        { id: 'f2', label: 'Field 2', style: 'short' },
        { id: 'f3', label: 'Field 3', style: 'short' },
        { id: 'f4', label: 'Field 4', style: 'short' },
        { id: 'f5', label: 'Field 5', style: 'short' },
        { id: 'f6', label: 'Field 6', style: 'short' }, // Should be excluded
        { id: 'f7', label: 'Field 7', style: 'short' }, // Should be excluded
      ]);

      const modal = buildSectionModal(config, section, 'test-1', {});

      expect(getModalComponents(modal)).toHaveLength(5);
    });

    it('should use default max lengths for short vs paragraph', () => {
      const config = createTestConfig<Record<string, string>>('test');

      const section = createTestSection<Record<string, string>>('mixed', 'Mixed', [
        { id: 'short', label: 'Short Field', style: 'short' },
        { id: 'para', label: 'Paragraph Field', style: 'paragraph' },
      ]);

      const modal = buildSectionModal(config, section, 'test-1', {});

      const shortInput = getTextInput(modal, 0);
      const paraInput = getTextInput(modal, 1);

      expect(shortInput.max_length).toBe(100); // DEFAULT_CONSTRAINTS.SHORT_MAX_LENGTH
      expect(paraInput.max_length).toBe(4000); // DEFAULT_CONSTRAINTS.PARAGRAPH_MAX_LENGTH
    });

    it('should respect custom max/min lengths', () => {
      const config = createTestConfig<Record<string, string>>('test');

      const section = createTestSection<Record<string, string>>('constrained', 'Constrained', [
        {
          id: 'limited',
          label: 'Limited',
          style: 'short',
          minLength: 5,
          maxLength: 50,
        },
      ]);

      const modal = buildSectionModal(config, section, 'test-1', {});

      const input = getTextInput(modal, 0);
      expect(input.min_length).toBe(5);
      expect(input.max_length).toBe(50);
    });

    it('should truncate pre-filled values to maxLength', () => {
      const config = createTestConfig<{ text: string }>('test');

      const section = createTestSection<{ text: string }>('truncate', 'Truncate', [
        { id: 'text', label: 'Text', style: 'short', maxLength: 10 },
      ]);

      const modal = buildSectionModal(config, section, 'test-1', {
        text: 'This is a very long string that exceeds maxLength',
      });

      const input = getTextInput(modal, 0);
      expect(input.value).toBe('This is a '); // Truncated to 10 chars
    });

    it('should not set value for non-string or undefined data', () => {
      const config = createTestConfig<{ num: number; missing: string }>('test');

      const section = createTestSection<{ num: number; missing: string }>('types', 'Types', [
        { id: 'num', label: 'Number', style: 'short' },
        { id: 'missing', label: 'Missing', style: 'short' },
      ]);

      // @ts-expect-error - intentionally passing wrong type for test
      const modal = buildSectionModal(config, section, 'test-1', { num: 42 });

      const numInput = getTextInput(modal, 0);
      const missingInput = getTextInput(modal, 1);

      expect(numInput.value).toBeUndefined();
      expect(missingInput.value).toBeUndefined();
    });

    describe('with context-aware hidden fields', () => {
      const adminContext: DashboardContext = { isAdmin: true, userId: 'admin-123' };
      const userContext: DashboardContext = { isAdmin: false, userId: 'user-456' };

      it('should show all fields when no context is provided (backward compatibility)', () => {
        const config = createTestConfig<Record<string, string>>('test');

        const section = createTestSection<Record<string, string>>('admin', 'Admin Section', [
          { id: 'visible', label: 'Visible', style: 'short' },
          {
            id: 'adminOnly',
            label: 'Admin Only',
            style: 'short',
            hidden: (ctx: DashboardContext) => !ctx.isAdmin,
          },
        ]);

        // No context provided - all fields visible
        const modal = buildSectionModal(config, section, 'test-1', {});
        expect(getModalComponents(modal)).toHaveLength(2);
      });

      it('should hide fields with static hidden: true', () => {
        const config = createTestConfig<Record<string, string>>('test');

        const section = createTestSection<Record<string, string>>('test', 'Test Section', [
          { id: 'visible', label: 'Visible', style: 'short' },
          { id: 'hidden', label: 'Hidden', style: 'short', hidden: true },
        ]);

        const modal = buildSectionModal(config, section, 'test-1', {}, adminContext);
        const components = getModalComponents(modal);

        expect(components).toHaveLength(1);
        expect(getTextInput(modal, 0).custom_id).toBe('visible');
      });

      it('should show fields with static hidden: false', () => {
        const config = createTestConfig<Record<string, string>>('test');

        const section = createTestSection<Record<string, string>>('test', 'Test Section', [
          { id: 'visible', label: 'Visible', style: 'short', hidden: false },
        ]);

        const modal = buildSectionModal(config, section, 'test-1', {}, adminContext);
        expect(getModalComponents(modal)).toHaveLength(1);
      });

      it('should show admin-only field to admins', () => {
        const config = createTestConfig<Record<string, string>>('test');

        const section = createTestSection<Record<string, string>>('admin', 'Admin Section', [
          { id: 'public', label: 'Public Field', style: 'short' },
          {
            id: 'adminOnly',
            label: 'Admin Only',
            style: 'short',
            hidden: (ctx: DashboardContext) => !ctx.isAdmin,
          },
        ]);

        const modal = buildSectionModal(config, section, 'test-1', {}, adminContext);
        const components = getModalComponents(modal);

        expect(components).toHaveLength(2);
        expect(getTextInput(modal, 0).custom_id).toBe('public');
        expect(getTextInput(modal, 1).custom_id).toBe('adminOnly');
      });

      it('should hide admin-only field from non-admins', () => {
        const config = createTestConfig<Record<string, string>>('test');

        const section = createTestSection<Record<string, string>>('admin', 'Admin Section', [
          { id: 'public', label: 'Public Field', style: 'short' },
          {
            id: 'adminOnly',
            label: 'Admin Only',
            style: 'short',
            hidden: (ctx: DashboardContext) => !ctx.isAdmin,
          },
        ]);

        const modal = buildSectionModal(config, section, 'test-1', {}, userContext);
        const components = getModalComponents(modal);

        expect(components).toHaveLength(1);
        expect(getTextInput(modal, 0).custom_id).toBe('public');
      });

      it('should respect Discord 5-field limit after filtering hidden fields', () => {
        const config = createTestConfig<Record<string, string>>('test');

        const section = createTestSection<Record<string, string>>('many', 'Many Fields', [
          { id: 'f1', label: 'Field 1', style: 'short' },
          { id: 'f2', label: 'Field 2', style: 'short', hidden: true },
          { id: 'f3', label: 'Field 3', style: 'short' },
          { id: 'f4', label: 'Field 4', style: 'short', hidden: true },
          { id: 'f5', label: 'Field 5', style: 'short' },
          { id: 'f6', label: 'Field 6', style: 'short' },
          { id: 'f7', label: 'Field 7', style: 'short' },
          { id: 'f8', label: 'Field 8', style: 'short' },
        ]);

        // After filtering, we have 6 visible fields, but should only show 5
        const modal = buildSectionModal(config, section, 'test-1', {}, adminContext);
        expect(getModalComponents(modal)).toHaveLength(5);
      });
    });
  });

  describe('buildSimpleModal', () => {
    it('should create a modal with given custom ID and title', () => {
      const modal = buildSimpleModal('my-modal', 'My Modal', [
        { id: 'field1', label: 'Field 1', style: 'short' },
      ]);
      const json = modal.toJSON();

      expect(json.custom_id).toBe('my-modal');
      expect(json.title).toBe('My Modal');
    });

    it('should add fields with initial values', () => {
      const fields: FieldDefinition[] = [
        { id: 'name', label: 'Name', style: 'short', required: true },
        { id: 'bio', label: 'Bio', style: 'paragraph', placeholder: 'Tell us about yourself' },
      ];

      const modal = buildSimpleModal('test', 'Test', fields, {
        name: 'John',
        bio: 'Developer',
      });

      const components = getModalComponents(modal);
      expect(components).toHaveLength(2);

      const nameInput = getTextInput(modal, 0);
      expect(nameInput.value).toBe('John');
      expect(nameInput.required).toBe(true);

      const bioInput = getTextInput(modal, 1);
      expect(bioInput.value).toBe('Developer');
      expect(bioInput.placeholder).toBe('Tell us about yourself');
    });

    it('should not set empty initial values', () => {
      const modal = buildSimpleModal(
        'test',
        'Test',
        [{ id: 'field', label: 'Field', style: 'short' }],
        { field: '' }
      );

      const input = getTextInput(modal, 0);
      expect(input.value).toBeUndefined();
    });

    it('should limit to 5 fields', () => {
      const fields: FieldDefinition[] = Array.from({ length: 7 }, (_, i) => ({
        id: `f${i}`,
        label: `Field ${i}`,
        style: 'short' as const,
      }));

      const modal = buildSimpleModal('test', 'Test', fields);

      expect(getModalComponents(modal)).toHaveLength(5);
    });
  });

  describe('extractModalValues', () => {
    it('should extract values for given field IDs', () => {
      const mockInteraction = {
        fields: {
          getTextInputValue: vi.fn((id: string) => {
            const values: Record<string, string> = {
              name: 'Test Name',
              description: 'Test Description',
            };
            return values[id] ?? '';
          }),
        },
      };

      const values = extractModalValues(mockInteraction, ['name', 'description']);

      expect(values).toEqual({
        name: 'Test Name',
        description: 'Test Description',
      });
    });

    it('should handle empty values', () => {
      const mockInteraction = {
        fields: {
          getTextInputValue: vi.fn(() => ''),
        },
      };

      const values = extractModalValues(mockInteraction, ['field']);

      expect(values).toEqual({ field: '' });
    });

    it('should skip fields that throw errors', () => {
      const mockInteraction = {
        fields: {
          getTextInputValue: vi.fn((id: string) => {
            if (id === 'missing') {
              throw new Error('Field not found');
            }
            return 'value';
          }),
        },
      };

      const values = extractModalValues(mockInteraction, ['present', 'missing']);

      expect(values).toEqual({ present: 'value' });
      expect(values.missing).toBeUndefined();
    });
  });

  describe('validateModalValues', () => {
    it('should return valid for correct values', () => {
      const fields: FieldDefinition[] = [
        { id: 'name', label: 'Name', style: 'short', required: true },
        { id: 'bio', label: 'Bio', style: 'paragraph' },
      ];

      const result = validateModalValues({ name: 'John', bio: 'Developer' }, fields);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail for missing required fields', () => {
      const fields: FieldDefinition[] = [
        { id: 'name', label: 'Name', style: 'short', required: true },
      ];

      const result = validateModalValues({ name: '' }, fields);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Name is required');
    });

    it('should fail for whitespace-only required fields', () => {
      const fields: FieldDefinition[] = [
        { id: 'name', label: 'Name', style: 'short', required: true },
      ];

      const result = validateModalValues({ name: '   ' }, fields);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Name is required');
    });

    it('should fail for values below minLength', () => {
      const fields: FieldDefinition[] = [
        { id: 'name', label: 'Name', style: 'short', minLength: 5 },
      ];

      const result = validateModalValues({ name: 'abc' }, fields);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Name must be at least 5 characters');
    });

    it('should fail for values above maxLength', () => {
      const fields: FieldDefinition[] = [
        { id: 'name', label: 'Name', style: 'short', maxLength: 10 },
      ];

      const result = validateModalValues({ name: 'This is way too long' }, fields);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Name must be at most 10 characters');
    });

    it('should not validate length for empty optional fields', () => {
      const fields: FieldDefinition[] = [
        { id: 'optional', label: 'Optional', style: 'short', minLength: 5 },
      ];

      const result = validateModalValues({ optional: '' }, fields);

      expect(result.valid).toBe(true);
    });

    it('should collect multiple errors', () => {
      const fields: FieldDefinition[] = [
        { id: 'name', label: 'Name', style: 'short', required: true },
        { id: 'code', label: 'Code', style: 'short', minLength: 3 },
      ];

      const result = validateModalValues({ name: '', code: 'ab' }, fields);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
    });
  });
});
