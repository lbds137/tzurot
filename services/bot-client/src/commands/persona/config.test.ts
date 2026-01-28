/**
 * Tests for Persona Dashboard Configuration
 * Tests flatten/unflatten functions and dashboard config.
 */

import { describe, it, expect } from 'vitest';
import {
  flattenPersonaData,
  unflattenPersonaData,
  PERSONA_DASHBOARD_CONFIG,
  personaSeedFields,
} from './config.js';
import { SectionStatus } from '../../utils/dashboard/types.js';
import type { PersonaDetails } from './types.js';

describe('flattenPersonaData', () => {
  it('should flatten persona data with all fields', () => {
    const persona: PersonaDetails = {
      id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      name: 'Test Persona',
      description: 'Test description',
      preferredName: 'Tester',
      pronouns: 'they/them',
      content: 'About me',
      isDefault: true,
      shareLtmAcrossPersonalities: false,
    };

    const result = flattenPersonaData(persona);

    expect(result.id).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    expect(result.name).toBe('Test Persona');
    expect(result.description).toBe('Test description');
    expect(result.preferredName).toBe('Tester');
    expect(result.pronouns).toBe('they/them');
    expect(result.content).toBe('About me');
    expect(result.isDefault).toBe(true);
  });

  it('should handle null values by converting to empty strings', () => {
    const persona: PersonaDetails = {
      id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      name: 'Test',
      description: null,
      preferredName: null,
      pronouns: null,
      content: '',
      isDefault: false,
      shareLtmAcrossPersonalities: false,
    };

    const result = flattenPersonaData(persona);

    expect(result.description).toBe('');
    expect(result.preferredName).toBe('');
    expect(result.pronouns).toBe('');
    expect(result.content).toBe('');
  });
});

describe('unflattenPersonaData', () => {
  it('should convert non-empty name', () => {
    const result = unflattenPersonaData({ name: 'Test' });
    expect(result.name).toBe('Test');
  });

  it('should not include empty name', () => {
    const result = unflattenPersonaData({ name: '' });
    expect(result.name).toBeUndefined();
  });

  it('should convert non-empty description', () => {
    const result = unflattenPersonaData({ description: 'Desc' });
    expect(result.description).toBe('Desc');
  });

  it('should convert empty description to null', () => {
    const result = unflattenPersonaData({ description: '' });
    expect(result.description).toBeNull();
  });

  it('should convert non-empty preferredName', () => {
    const result = unflattenPersonaData({ preferredName: 'Tester' });
    expect(result.preferredName).toBe('Tester');
  });

  it('should convert empty preferredName to null', () => {
    const result = unflattenPersonaData({ preferredName: '' });
    expect(result.preferredName).toBeNull();
  });

  it('should convert non-empty pronouns', () => {
    const result = unflattenPersonaData({ pronouns: 'they/them' });
    expect(result.pronouns).toBe('they/them');
  });

  it('should convert empty pronouns to null', () => {
    const result = unflattenPersonaData({ pronouns: '' });
    expect(result.pronouns).toBeNull();
  });

  it('should convert non-empty content', () => {
    const result = unflattenPersonaData({ content: 'About me' });
    expect(result.content).toBe('About me');
  });

  it('should omit empty content (required field cannot be null)', () => {
    const result = unflattenPersonaData({ content: '' });
    // Content is required in the database - empty means "preserve existing value"
    expect(result.content).toBeUndefined();
  });

  it('should handle undefined values', () => {
    const result = unflattenPersonaData({});
    expect(Object.keys(result)).toHaveLength(0);
  });

  it('should convert all fields when provided', () => {
    const result = unflattenPersonaData({
      name: 'Test',
      description: 'Desc',
      preferredName: 'Tester',
      pronouns: 'she/her',
      content: 'About me',
    });

    expect(result.name).toBe('Test');
    expect(result.description).toBe('Desc');
    expect(result.preferredName).toBe('Tester');
    expect(result.pronouns).toBe('she/her');
    expect(result.content).toBe('About me');
  });
});

describe('PERSONA_DASHBOARD_CONFIG', () => {
  it('should have correct entityType', () => {
    expect(PERSONA_DASHBOARD_CONFIG.entityType).toBe('persona');
  });

  it('should have one section', () => {
    expect(PERSONA_DASHBOARD_CONFIG.sections).toHaveLength(1);
    expect(PERSONA_DASHBOARD_CONFIG.sections[0].id).toBe('identity');
  });

  it('should have empty actions array', () => {
    expect(PERSONA_DASHBOARD_CONFIG.actions).toHaveLength(0);
  });

  describe('getTitle', () => {
    it('should include persona name', () => {
      const data = { id: '', name: 'My Persona', isDefault: false };
      expect(PERSONA_DASHBOARD_CONFIG.getTitle(data)).toContain('My Persona');
    });
  });

  describe('getDescription', () => {
    it('should return empty string when no badges', () => {
      const data = { id: '', name: 'Test', isDefault: false };
      expect(PERSONA_DASHBOARD_CONFIG.getDescription(data)).toBe('');
    });

    it('should show default badge', () => {
      const data = { id: '', name: 'Test', isDefault: true };
      expect(PERSONA_DASHBOARD_CONFIG.getDescription(data)).toContain('Default');
    });

    it('should show preferred name badge', () => {
      const data = { id: '', name: 'Test', isDefault: false, preferredName: 'Tester' };
      expect(PERSONA_DASHBOARD_CONFIG.getDescription(data)).toContain('Tester');
    });

    it('should show pronouns badge', () => {
      const data = { id: '', name: 'Test', isDefault: false, pronouns: 'they/them' };
      expect(PERSONA_DASHBOARD_CONFIG.getDescription(data)).toContain('they/them');
    });

    it('should show all badges when present', () => {
      const data = {
        id: '',
        name: 'Test',
        isDefault: true,
        preferredName: 'Tester',
        pronouns: 'she/her',
      };
      const desc = PERSONA_DASHBOARD_CONFIG.getDescription(data);
      expect(desc).toContain('Default');
      expect(desc).toContain('Tester');
      expect(desc).toContain('she/her');
    });
  });

  describe('getFooter', () => {
    it('should return helpful message', () => {
      const footer = PERSONA_DASHBOARD_CONFIG.getFooter();
      expect(footer).toContain('section');
      expect(footer).toContain('edit');
    });
  });

  describe('identity section', () => {
    const section = PERSONA_DASHBOARD_CONFIG.sections[0];

    describe('getStatus', () => {
      it('should return EMPTY when name is missing', () => {
        const data = { id: '', name: '', isDefault: false };
        expect(section.getStatus(data)).toBe(SectionStatus.EMPTY);
      });

      it('should return DEFAULT when only name', () => {
        const data = { id: '', name: 'Test', isDefault: false };
        expect(section.getStatus(data)).toBe(SectionStatus.DEFAULT);
      });

      it('should return COMPLETE with extras', () => {
        const data = { id: '', name: 'Test', isDefault: false, preferredName: 'Tester' };
        expect(section.getStatus(data)).toBe(SectionStatus.COMPLETE);
      });
    });

    describe('getPreview', () => {
      it('should return not configured when no data', () => {
        const data = { id: '', name: '', isDefault: false };
        expect(section.getPreview(data)).toBe('_Not configured_');
      });

      it('should show name', () => {
        const data = { id: '', name: 'Test', isDefault: false };
        expect(section.getPreview(data)).toContain('**Name:** Test');
      });

      it('should truncate long content', () => {
        const longContent = 'A'.repeat(150);
        const data = { id: '', name: 'Test', isDefault: false, content: longContent };
        const preview = section.getPreview(data);
        expect(preview).toContain('...');
        expect(preview.length).toBeLessThan(200);
      });
    });
  });
});

describe('personaSeedFields', () => {
  it('should have 2 fields', () => {
    expect(personaSeedFields).toHaveLength(2);
  });

  it('should have name as first field', () => {
    expect(personaSeedFields[0].id).toBe('name');
    expect(personaSeedFields[0].required).toBe(true);
  });

  it('should have preferredName as second field', () => {
    expect(personaSeedFields[1].id).toBe('preferredName');
    expect(personaSeedFields[1].required).toBe(false);
  });
});
