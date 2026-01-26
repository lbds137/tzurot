/**
 * Tests for Profile Sections
 * Tests the identity section status and preview functions.
 */

import { describe, it, expect } from 'vitest';
import { identitySection } from './profileSections.js';
import { SectionStatus } from '../../utils/dashboard/types.js';

describe('identitySection', () => {
  describe('getStatus', () => {
    it('should return EMPTY when name is missing', () => {
      const data = { name: '', preferredName: '', pronouns: '', content: '' };
      expect(identitySection.getStatus(data)).toBe(SectionStatus.EMPTY);
    });

    it('should return EMPTY when name is null-like', () => {
      const data = {
        name: undefined as unknown as string,
        preferredName: '',
        pronouns: '',
        content: '',
      };
      expect(identitySection.getStatus(data)).toBe(SectionStatus.EMPTY);
    });

    it('should return DEFAULT when only name is provided', () => {
      const data = { name: 'Test Profile', preferredName: '', pronouns: '', content: '' };
      expect(identitySection.getStatus(data)).toBe(SectionStatus.DEFAULT);
    });

    it('should return COMPLETE when name and preferredName are provided', () => {
      const data = { name: 'Test Profile', preferredName: 'Tester', pronouns: '', content: '' };
      expect(identitySection.getStatus(data)).toBe(SectionStatus.COMPLETE);
    });

    it('should return COMPLETE when name and pronouns are provided', () => {
      const data = { name: 'Test Profile', preferredName: '', pronouns: 'they/them', content: '' };
      expect(identitySection.getStatus(data)).toBe(SectionStatus.COMPLETE);
    });

    it('should return COMPLETE when name and content are provided', () => {
      const data = { name: 'Test Profile', preferredName: '', pronouns: '', content: 'About me' };
      expect(identitySection.getStatus(data)).toBe(SectionStatus.COMPLETE);
    });

    it('should return COMPLETE when all fields are provided', () => {
      const data = {
        name: 'Test Profile',
        preferredName: 'Tester',
        pronouns: 'she/her',
        content: 'About me',
      };
      expect(identitySection.getStatus(data)).toBe(SectionStatus.COMPLETE);
    });
  });

  describe('getPreview', () => {
    it('should return not configured when no data', () => {
      const data = { name: '', preferredName: '', pronouns: '', content: '' };
      expect(identitySection.getPreview(data)).toBe('_Not configured_');
    });

    it('should show name when provided', () => {
      const data = { name: 'Test Profile', preferredName: '', pronouns: '', content: '' };
      expect(identitySection.getPreview(data)).toContain('**Name:** Test Profile');
    });

    it('should show preferredName when provided', () => {
      const data = { name: 'Test', preferredName: 'Tester', pronouns: '', content: '' };
      const preview = identitySection.getPreview(data);
      expect(preview).toContain('**Name:** Test');
      expect(preview).toContain('**Called:** Tester');
    });

    it('should show pronouns when provided', () => {
      const data = { name: 'Test', preferredName: '', pronouns: 'they/them', content: '' };
      const preview = identitySection.getPreview(data);
      expect(preview).toContain('**Pronouns:** they/them');
    });

    it('should show content preview when provided', () => {
      const data = { name: 'Test', preferredName: '', pronouns: '', content: 'About me text' };
      const preview = identitySection.getPreview(data);
      expect(preview).toContain('**About:** About me text');
    });

    it('should truncate long content in preview', () => {
      const longContent = 'A'.repeat(150);
      const data = { name: 'Test', preferredName: '', pronouns: '', content: longContent };
      const preview = identitySection.getPreview(data);
      expect(preview).toContain('**About:** ' + 'A'.repeat(100) + '...');
    });

    it('should show all fields when provided', () => {
      const data = {
        name: 'Test Profile',
        preferredName: 'Tester',
        pronouns: 'she/her',
        content: 'About me',
      };
      const preview = identitySection.getPreview(data);
      expect(preview).toContain('**Name:** Test Profile');
      expect(preview).toContain('**Called:** Tester');
      expect(preview).toContain('**Pronouns:** she/her');
      expect(preview).toContain('**About:** About me');
    });
  });

  describe('section structure', () => {
    it('should have correct id', () => {
      expect(identitySection.id).toBe('identity');
    });

    it('should have correct label', () => {
      expect(identitySection.label).toBe('📝 Profile Info');
    });

    it('should have 5 field IDs', () => {
      expect(identitySection.fieldIds).toHaveLength(5);
      expect(identitySection.fieldIds).toContain('name');
      expect(identitySection.fieldIds).toContain('preferredName');
      expect(identitySection.fieldIds).toContain('pronouns');
      expect(identitySection.fieldIds).toContain('description');
      expect(identitySection.fieldIds).toContain('content');
    });

    it('should have 5 field definitions', () => {
      expect(identitySection.fields).toHaveLength(5);
    });

    it('should mark name as required', () => {
      const nameField = identitySection.fields.find(f => f.id === 'name');
      expect(nameField?.required).toBe(true);
    });

    it('should mark other fields as optional', () => {
      const optionalFields = identitySection.fields.filter(f => f.id !== 'name');
      optionalFields.forEach(field => {
        expect(field.required).toBe(false);
      });
    });

    it('should use paragraph style for content', () => {
      const contentField = identitySection.fields.find(f => f.id === 'content');
      expect(contentField?.style).toBe('paragraph');
    });
  });
});
