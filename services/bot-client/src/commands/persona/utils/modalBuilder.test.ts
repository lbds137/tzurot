/**
 * Tests for Persona Modal Builder Utilities
 */

import { describe, it, expect } from 'vitest';
import { TextInputStyle } from 'discord.js';
import { buildPersonaInputFields } from './modalBuilder.js';

describe('buildPersonaInputFields', () => {
  it('should build three action rows with input fields', () => {
    const fields = buildPersonaInputFields();

    expect(fields).toHaveLength(3);
    expect(fields[0].components).toHaveLength(1);
    expect(fields[1].components).toHaveLength(1);
    expect(fields[2].components).toHaveLength(1);
  });

  it('should set correct customIds for each field', () => {
    const fields = buildPersonaInputFields();

    const nameInput = fields[0].components[0];
    const pronounsInput = fields[1].components[0];
    const contentInput = fields[2].components[0];

    expect(nameInput.toJSON().custom_id).toBe('preferredName');
    expect(pronounsInput.toJSON().custom_id).toBe('pronouns');
    expect(contentInput.toJSON().custom_id).toBe('content');
  });

  it('should use default placeholders when no options provided', () => {
    const fields = buildPersonaInputFields();

    const nameInput = fields[0].components[0].toJSON();
    const contentInput = fields[2].components[0].toJSON();

    expect(nameInput.placeholder).toBe('What should AI call you?');
    expect(contentInput.label).toBe('About You');
  });

  it('should pre-fill values from existing persona data', () => {
    const existingData = {
      preferredName: 'Alice',
      pronouns: 'she/her',
      content: 'I love coding',
    };

    const fields = buildPersonaInputFields(existingData);

    const nameInput = fields[0].components[0].toJSON();
    const pronounsInput = fields[1].components[0].toJSON();
    const contentInput = fields[2].components[0].toJSON();

    expect(nameInput.value).toBe('Alice');
    expect(pronounsInput.value).toBe('she/her');
    expect(contentInput.value).toBe('I love coding');
  });

  it('should handle null values in existing data', () => {
    const existingData = {
      preferredName: null,
      pronouns: null,
      content: null,
    };

    const fields = buildPersonaInputFields(existingData);

    const nameInput = fields[0].components[0].toJSON();
    const pronounsInput = fields[1].components[0].toJSON();
    const contentInput = fields[2].components[0].toJSON();

    expect(nameInput.value).toBeUndefined();
    expect(pronounsInput.value).toBeUndefined();
    expect(contentInput.value).toBeUndefined();
  });

  it('should handle undefined existing data', () => {
    const fields = buildPersonaInputFields(undefined);

    const nameInput = fields[0].components[0].toJSON();

    expect(nameInput.value).toBeUndefined();
  });

  it('should truncate content longer than modal max length', () => {
    const longContent = 'x'.repeat(5000); // Exceeds MODAL_INPUT_MAX_LENGTH (4000)
    const existingData = {
      preferredName: 'Test',
      pronouns: null,
      content: longContent,
    };

    const fields = buildPersonaInputFields(existingData);

    const contentInput = fields[2].components[0].toJSON();

    expect(contentInput.value).toHaveLength(4000);
    expect(contentInput.value).toBe('x'.repeat(4000));
  });

  it('should use custom options when provided', () => {
    const fields = buildPersonaInputFields(null, {
      namePlaceholder: 'What should Lilith call you?',
      contentLabel: 'About You (for Lilith)',
      contentPlaceholder: 'Tell Lilith about yourself...',
    });

    const nameInput = fields[0].components[0].toJSON();
    const contentInput = fields[2].components[0].toJSON();

    expect(nameInput.placeholder).toBe('What should Lilith call you?');
    expect(contentInput.label).toBe('About You (for Lilith)');
    expect(contentInput.placeholder).toBe('Tell Lilith about yourself...');
  });

  it('should set correct styles for each field', () => {
    const fields = buildPersonaInputFields();

    const nameInput = fields[0].components[0].toJSON();
    const pronounsInput = fields[1].components[0].toJSON();
    const contentInput = fields[2].components[0].toJSON();

    expect(nameInput.style).toBe(TextInputStyle.Short);
    expect(pronounsInput.style).toBe(TextInputStyle.Short);
    expect(contentInput.style).toBe(TextInputStyle.Paragraph);
  });

  it('should set all fields as not required', () => {
    const fields = buildPersonaInputFields();

    const nameInput = fields[0].components[0].toJSON();
    const pronounsInput = fields[1].components[0].toJSON();
    const contentInput = fields[2].components[0].toJSON();

    expect(nameInput.required).toBe(false);
    expect(pronounsInput.required).toBe(false);
    expect(contentInput.required).toBe(false);
  });

  it('should set correct max lengths', () => {
    const fields = buildPersonaInputFields();

    const nameInput = fields[0].components[0].toJSON();
    const pronounsInput = fields[1].components[0].toJSON();
    const contentInput = fields[2].components[0].toJSON();

    expect(nameInput.max_length).toBe(255);
    expect(pronounsInput.max_length).toBe(100);
    expect(contentInput.max_length).toBe(4000);
  });

  it('should handle partial existing data', () => {
    const existingData = {
      preferredName: 'Bob',
      // pronouns and content undefined
    };

    const fields = buildPersonaInputFields(existingData);

    const nameInput = fields[0].components[0].toJSON();
    const pronounsInput = fields[1].components[0].toJSON();

    expect(nameInput.value).toBe('Bob');
    expect(pronounsInput.value).toBeUndefined();
  });
});
