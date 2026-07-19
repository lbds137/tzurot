/**
 * Tests for Persona Modal Builder
 */

import { describe, it, expect } from 'vitest';
import { buildPersonaModalFields } from './modalBuilder.js';
import { buildToolkitModal } from '../../../utils/modal/toolkit.js';

describe('buildPersonaModalFields', () => {
  describe('default behavior', () => {
    it('should return 5 fields by default (with name field)', () => {
      const fields = buildPersonaModalFields();
      expect(fields).toHaveLength(5);
    });

    it('should return 4 fields when name field is excluded', () => {
      const fields = buildPersonaModalFields(null, { includeNameField: false });
      expect(fields).toHaveLength(4);
    });

    it('should create fields with correct ids', () => {
      const ids = buildPersonaModalFields().map(f => f.id);

      expect(ids).toContain('personaName');
      expect(ids).toContain('description');
      expect(ids).toContain('preferredName');
      expect(ids).toContain('pronouns');
      expect(ids).toContain('content');
    });

    it('should set persona name as required', () => {
      const fields = buildPersonaModalFields();
      expect(fields[0].required).toBe(true);
    });

    it('should set optional fields as not required (description, preferredName, pronouns)', () => {
      const fields = buildPersonaModalFields();

      // Fields 1-3 are description, preferredName, pronouns — all optional.
      // Field 0 (name) and the last field (content) are required and tested
      // separately.
      for (let i = 1; i < fields.length - 1; i++) {
        expect(fields[i].required).toBe(false);
      }
    });

    it('should set content as required (matches PersonaCreateSchema.content.min(1))', () => {
      const fields = buildPersonaModalFields();
      expect(fields[fields.length - 1].required).toBe(true);
    });

    it('should use paragraph style for content field', () => {
      const fields = buildPersonaModalFields();
      expect(fields[fields.length - 1].style).toBe('paragraph');
    });

    it('should use short style for other fields', () => {
      const fields = buildPersonaModalFields();

      // Check all except last (content)
      for (let i = 0; i < fields.length - 1; i++) {
        expect(fields[i].style).toBe('short');
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

      const values = buildPersonaModalFields(existingData).map(f => f.initialValue);

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

      const values = buildPersonaModalFields(existingData).map(f => f.initialValue);

      expect(values[0]).toBe('My Persona');
      expect(values[1]).toBeUndefined();
      expect(values[2]).toBeUndefined();
      expect(values[3]).toBeUndefined();
      expect(values[4]).toBeUndefined();
    });

    it('should render long content truncated to the modal max length (toolkit contract)', () => {
      const longContent = 'x'.repeat(5000); // Exceeds 4000 limit
      const fields = buildPersonaModalFields({ name: 'Test', content: longContent });

      // Truncation is the toolkit's job now — pin it at the render seam so
      // an over-cap prefill can't reach Discord's value ≤ max_length check.
      const json = buildToolkitModal({ customId: 'x', title: 'T', items: fields }).toJSON();
      const contentInput = json.components[json.components.length - 1] as {
        component?: { value?: string };
      };
      expect(contentInput.component?.value).toHaveLength(4000);
    });

    it('should not truncate content within limit', () => {
      const shortContent = 'x'.repeat(100);
      const fields = buildPersonaModalFields({ name: 'Test', content: shortContent });

      expect(fields[fields.length - 1].initialValue).toBe(shortContent);
    });

    it('should handle empty string content', () => {
      const fields = buildPersonaModalFields({ name: 'Test', content: '' });

      // Empty string should not be set as a prefill
      expect(fields[fields.length - 1].initialValue).toBeUndefined();
    });
  });

  describe('custom options', () => {
    it('should use custom placeholder for persona name', () => {
      const fields = buildPersonaModalFields(null, {
        namePlaceholder: 'Custom name placeholder',
      });

      expect(fields[0].placeholder).toBe('Custom name placeholder');
    });

    it('should use custom label for preferred name', () => {
      const fields = buildPersonaModalFields(null, {
        preferredNameLabel: 'What should Lilith call you?',
      });

      expect(fields[2].label).toBe('What should Lilith call you?');
    });

    it('should use custom placeholder for preferred name', () => {
      const fields = buildPersonaModalFields(null, {
        preferredNamePlaceholder: 'Enter your name for Lilith',
      });

      expect(fields[2].placeholder).toBe('Enter your name for Lilith');
    });

    it('should use custom label for content', () => {
      const fields = buildPersonaModalFields(null, {
        contentLabel: 'About You (for Lilith)',
      });

      expect(fields[fields.length - 1].label).toBe('About You (for Lilith)');
    });

    it('should use custom placeholder for content', () => {
      const fields = buildPersonaModalFields(null, {
        contentPlaceholder: 'Tell Lilith about yourself',
      });

      expect(fields[fields.length - 1].placeholder).toBe('Tell Lilith about yourself');
    });

    it('should combine multiple custom options', () => {
      const fields = buildPersonaModalFields(null, {
        namePlaceholder: 'Custom name',
        preferredNameLabel: 'Custom preferred label',
        contentLabel: 'Custom content label',
        contentPlaceholder: 'Custom content placeholder',
      });

      expect(fields[0].placeholder).toBe('Custom name');
      expect(fields[2].label).toBe('Custom preferred label');
      expect(fields[fields.length - 1].label).toBe('Custom content label');
      expect(fields[fields.length - 1].placeholder).toBe('Custom content placeholder');
    });
  });

  describe('excluding name field', () => {
    it('should not include personaName when includeNameField is false', () => {
      const ids = buildPersonaModalFields(null, { includeNameField: false }).map(f => f.id);

      expect(ids).not.toContain('personaName');
      expect(ids).toContain('description');
      expect(ids).toContain('preferredName');
      expect(ids).toContain('pronouns');
      expect(ids).toContain('content');
    });

    it('should have description as first field when name excluded', () => {
      const fields = buildPersonaModalFields(null, { includeNameField: false });

      expect(fields[0].id).toBe('description');
    });
  });
});
