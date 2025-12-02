/**
 * Tests for Persona Modal Builder
 */

import { describe, it, expect } from 'vitest';
import { TextInputStyle } from 'discord.js';
import { buildPersonaModalFields } from './modalBuilder.js';

describe('buildPersonaModalFields', () => {
  describe('default behavior', () => {
    it('should return 5 action rows by default (with name field)', () => {
      const rows = buildPersonaModalFields();
      expect(rows).toHaveLength(5);
    });

    it('should return 4 action rows when name field is excluded', () => {
      const rows = buildPersonaModalFields(null, { includeNameField: false });
      expect(rows).toHaveLength(4);
    });

    it('should create fields with correct customIds', () => {
      const rows = buildPersonaModalFields();

      // Extract components from rows
      const components = rows.map(row => row.components[0]);
      const customIds = components.map(c => c.data.custom_id);

      expect(customIds).toContain('personaName');
      expect(customIds).toContain('description');
      expect(customIds).toContain('preferredName');
      expect(customIds).toContain('pronouns');
      expect(customIds).toContain('content');
    });

    it('should set persona name as required', () => {
      const rows = buildPersonaModalFields();
      const nameRow = rows[0];
      const nameInput = nameRow.components[0];

      expect(nameInput.data.required).toBe(true);
    });

    it('should set other fields as not required', () => {
      const rows = buildPersonaModalFields();

      // Skip first row (name), check rest are not required
      for (let i = 1; i < rows.length; i++) {
        const input = rows[i].components[0];
        expect(input.data.required).toBe(false);
      }
    });

    it('should use paragraph style for content field', () => {
      const rows = buildPersonaModalFields();
      const contentRow = rows[rows.length - 1]; // Last row is content
      const contentInput = contentRow.components[0];

      expect(contentInput.data.style).toBe(TextInputStyle.Paragraph);
    });

    it('should use short style for other fields', () => {
      const rows = buildPersonaModalFields();

      // Check all except last (content)
      for (let i = 0; i < rows.length - 1; i++) {
        const input = rows[i].components[0];
        expect(input.data.style).toBe(TextInputStyle.Short);
      }
    });
  });

  describe('pre-filling with existing data', () => {
    it('should pre-fill all fields from existing data', () => {
      const existingData = {
        name: 'Work Persona',
        description: 'My work persona',
        preferredName: 'Alice',
        pronouns: 'she/her',
        content: 'I am a professional',
      };

      const rows = buildPersonaModalFields(existingData);
      const values = rows.map(row => row.components[0].data.value);

      expect(values[0]).toBe('Work Persona');
      expect(values[1]).toBe('My work persona');
      expect(values[2]).toBe('Alice');
      expect(values[3]).toBe('she/her');
      expect(values[4]).toBe('I am a professional');
    });

    it('should handle null values in existing data', () => {
      const existingData = {
        name: 'My Persona',
        description: null,
        preferredName: null,
        pronouns: null,
        content: null,
      };

      const rows = buildPersonaModalFields(existingData);
      const values = rows.map(row => row.components[0].data.value);

      expect(values[0]).toBe('My Persona');
      expect(values[1]).toBeUndefined();
      expect(values[2]).toBeUndefined();
      expect(values[3]).toBeUndefined();
      expect(values[4]).toBeUndefined();
    });

    it('should truncate long content to modal max length', () => {
      const longContent = 'x'.repeat(5000); // Exceeds 4000 limit
      const existingData = {
        name: 'Test',
        content: longContent,
      };

      const rows = buildPersonaModalFields(existingData);
      const contentValue = rows[rows.length - 1].components[0].data.value;

      expect(contentValue?.length).toBe(4000);
    });

    it('should not truncate content within limit', () => {
      const shortContent = 'x'.repeat(100);
      const existingData = {
        name: 'Test',
        content: shortContent,
      };

      const rows = buildPersonaModalFields(existingData);
      const contentValue = rows[rows.length - 1].components[0].data.value;

      expect(contentValue).toBe(shortContent);
    });

    it('should handle empty string content', () => {
      const existingData = {
        name: 'Test',
        content: '',
      };

      const rows = buildPersonaModalFields(existingData);
      const contentValue = rows[rows.length - 1].components[0].data.value;

      // Empty string should not be set
      expect(contentValue).toBeUndefined();
    });
  });

  describe('custom options', () => {
    it('should use custom placeholder for persona name', () => {
      const rows = buildPersonaModalFields(null, {
        namePlaceholder: 'Custom name placeholder',
      });

      const nameInput = rows[0].components[0];
      expect(nameInput.data.placeholder).toBe('Custom name placeholder');
    });

    it('should use custom label for preferred name', () => {
      const rows = buildPersonaModalFields(null, {
        preferredNameLabel: 'What should Lilith call you?',
      });

      const preferredNameInput = rows[2].components[0];
      expect(preferredNameInput.data.label).toBe('What should Lilith call you?');
    });

    it('should use custom placeholder for preferred name', () => {
      const rows = buildPersonaModalFields(null, {
        preferredNamePlaceholder: 'Enter your name for Lilith',
      });

      const preferredNameInput = rows[2].components[0];
      expect(preferredNameInput.data.placeholder).toBe('Enter your name for Lilith');
    });

    it('should use custom label for content', () => {
      const rows = buildPersonaModalFields(null, {
        contentLabel: 'About You (for Lilith)',
      });

      const contentInput = rows[rows.length - 1].components[0];
      expect(contentInput.data.label).toBe('About You (for Lilith)');
    });

    it('should use custom placeholder for content', () => {
      const rows = buildPersonaModalFields(null, {
        contentPlaceholder: 'Tell Lilith about yourself',
      });

      const contentInput = rows[rows.length - 1].components[0];
      expect(contentInput.data.placeholder).toBe('Tell Lilith about yourself');
    });

    it('should combine multiple custom options', () => {
      const rows = buildPersonaModalFields(null, {
        namePlaceholder: 'Custom name',
        preferredNameLabel: 'Custom preferred label',
        contentLabel: 'Custom content label',
        contentPlaceholder: 'Custom content placeholder',
      });

      expect(rows[0].components[0].data.placeholder).toBe('Custom name');
      expect(rows[2].components[0].data.label).toBe('Custom preferred label');
      expect(rows[rows.length - 1].components[0].data.label).toBe('Custom content label');
      expect(rows[rows.length - 1].components[0].data.placeholder).toBe(
        'Custom content placeholder'
      );
    });
  });

  describe('excluding name field', () => {
    it('should not include personaName when includeNameField is false', () => {
      const rows = buildPersonaModalFields(null, { includeNameField: false });

      const customIds = rows.map(row => row.components[0].data.custom_id);
      expect(customIds).not.toContain('personaName');
      expect(customIds).toContain('description');
      expect(customIds).toContain('preferredName');
      expect(customIds).toContain('pronouns');
      expect(customIds).toContain('content');
    });

    it('should have description as first field when name excluded', () => {
      const rows = buildPersonaModalFields(null, { includeNameField: false });

      expect(rows[0].components[0].data.custom_id).toBe('description');
    });
  });
});
