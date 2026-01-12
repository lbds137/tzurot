/**
 * Tests for Validation Utilities
 */

import { describe, it, expect } from 'vitest';
import {
  validateUuid,
  validateSlug,
  validateCustomFields,
  validateRequired,
  validateStringLength,
} from './validators.js';

describe('validators', () => {
  describe('validateUuid', () => {
    it('should accept valid lowercase UUID', () => {
      const result = validateUuid('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
      expect(result.valid).toBe(true);
    });

    it('should accept valid uppercase UUID', () => {
      const result = validateUuid('A1B2C3D4-E5F6-7890-ABCD-EF1234567890');
      expect(result.valid).toBe(true);
    });

    it('should accept valid mixed case UUID', () => {
      const result = validateUuid('A1b2C3d4-E5f6-7890-AbCd-Ef1234567890');
      expect(result.valid).toBe(true);
    });

    it('should reject UUID without hyphens', () => {
      const result = validateUuid('a1b2c3d4e5f67890abcdef1234567890');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.message).toContain('Invalid ID format');
      }
    });

    it('should reject UUID with wrong segment lengths', () => {
      const result = validateUuid('a1b2c3d4-e5f6-7890-abcd-ef12345678901');
      expect(result.valid).toBe(false);
    });

    it('should reject empty string', () => {
      const result = validateUuid('');
      expect(result.valid).toBe(false);
    });

    it('should reject undefined', () => {
      const result = validateUuid(undefined);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.message).toContain('is required');
      }
    });

    it('should reject random string', () => {
      const result = validateUuid('not-a-uuid-at-all');
      expect(result.valid).toBe(false);
    });

    it('should reject UUID with invalid characters', () => {
      const result = validateUuid('g1b2c3d4-e5f6-7890-abcd-ef1234567890');
      expect(result.valid).toBe(false);
    });

    it('should use custom field name in error message', () => {
      const result = validateUuid('invalid', 'persona ID');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.message).toContain('Invalid persona ID format');
      }
    });
  });

  describe('validateSlug', () => {
    it('should accept valid lowercase slug', () => {
      const result = validateSlug('my-personality');
      expect(result.valid).toBe(true);
    });

    it('should accept slug with numbers', () => {
      const result = validateSlug('bot-v2');
      expect(result.valid).toBe(true);
    });

    it('should accept single character slug', () => {
      const result = validateSlug('a');
      expect(result.valid).toBe(true);
    });

    it('should accept slug at max length (64 chars)', () => {
      const result = validateSlug('a'.repeat(64));
      expect(result.valid).toBe(true);
    });

    it('should reject undefined slug', () => {
      const result = validateSlug(undefined);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.message).toContain('is required');
      }
    });

    it('should reject empty slug', () => {
      const result = validateSlug('');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.message).toContain('between 1 and 64');
      }
    });

    it('should reject slug exceeding 64 characters', () => {
      const result = validateSlug('a'.repeat(65));
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.message).toContain('between 1 and 64');
      }
    });

    it('should reject uppercase letters', () => {
      const result = validateSlug('MyPersonality');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.message).toContain('lowercase');
      }
    });

    it('should reject spaces', () => {
      const result = validateSlug('my personality');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.message).toContain('lowercase');
      }
    });

    it('should reject underscores', () => {
      const result = validateSlug('my_personality');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.message).toContain('lowercase');
      }
    });

    it('should reject special characters', () => {
      const result = validateSlug('my@personality!');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.message).toContain('lowercase');
      }
    });

    it('should reject reserved slug "admin"', () => {
      const result = validateSlug('admin');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.message).toContain('reserved name');
      }
    });

    it('should reject reserved slug "system"', () => {
      const result = validateSlug('system');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.message).toContain('reserved name');
      }
    });

    it('should reject reserved slug "default"', () => {
      const result = validateSlug('default');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.message).toContain('reserved name');
      }
    });

    it('should reject slug starting with hyphen', () => {
      const result = validateSlug('-myslug');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.message).toContain('cannot start with a hyphen');
      }
    });

    it('should reject slug ending with hyphen', () => {
      const result = validateSlug('myslug-');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.message).toContain('cannot end with a hyphen');
      }
    });

    it('should reject slug with consecutive hyphens', () => {
      const result = validateSlug('my--slug');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.message).toContain('consecutive hyphens');
      }
    });

    it('should accept slug with non-reserved similar name', () => {
      const result = validateSlug('admin-bot');
      expect(result.valid).toBe(true);
    });

    it('should accept slug with single hyphen in middle', () => {
      const result = validateSlug('my-slug');
      expect(result.valid).toBe(true);
    });
  });

  describe('validateCustomFields', () => {
    it('should accept undefined', () => {
      const result = validateCustomFields(undefined);
      expect(result.valid).toBe(true);
    });

    it('should accept null', () => {
      const result = validateCustomFields(null);
      expect(result.valid).toBe(true);
    });

    it('should accept empty object', () => {
      const result = validateCustomFields({});
      expect(result.valid).toBe(true);
    });

    it('should accept object with string values', () => {
      const result = validateCustomFields({ key: 'value', another: 'test' });
      expect(result.valid).toBe(true);
    });

    it('should accept object with mixed value types', () => {
      const result = validateCustomFields({
        string: 'value',
        number: 42,
        bool: true,
        nested: { a: 1 },
      });
      expect(result.valid).toBe(true);
    });

    it('should reject non-object values (string)', () => {
      const result = validateCustomFields('not an object');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.message).toContain('Invalid customFields');
      }
    });

    it('should reject non-object values (number)', () => {
      const result = validateCustomFields(42);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.message).toContain('Invalid customFields');
      }
    });

    it('should reject non-object values (array)', () => {
      const result = validateCustomFields(['a', 'b']);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.message).toContain('Invalid customFields');
      }
    });
  });

  describe('validateRequired', () => {
    it('should accept non-empty string', () => {
      const result = validateRequired('value', 'fieldName');
      expect(result.valid).toBe(true);
    });

    it('should accept number zero', () => {
      const result = validateRequired(0, 'fieldName');
      expect(result.valid).toBe(true);
    });

    it('should accept false boolean', () => {
      const result = validateRequired(false, 'fieldName');
      expect(result.valid).toBe(true);
    });

    it('should accept object', () => {
      const result = validateRequired({ key: 'value' }, 'fieldName');
      expect(result.valid).toBe(true);
    });

    it('should reject undefined', () => {
      const result = validateRequired(undefined, 'myField');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.message).toContain('myField is required');
      }
    });

    it('should reject null', () => {
      const result = validateRequired(null, 'myField');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.message).toContain('myField is required');
      }
    });

    it('should reject empty string', () => {
      const result = validateRequired('', 'myField');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.message).toContain('myField is required');
      }
    });
  });

  describe('validateStringLength', () => {
    it('should accept string within bounds', () => {
      const result = validateStringLength('hello', 'name', 1, 10);
      expect(result.valid).toBe(true);
    });

    it('should accept string at minimum length', () => {
      const result = validateStringLength('a', 'name', 1, 10);
      expect(result.valid).toBe(true);
    });

    it('should accept string at maximum length', () => {
      const result = validateStringLength('a'.repeat(10), 'name', 1, 10);
      expect(result.valid).toBe(true);
    });

    it('should reject string below minimum', () => {
      const result = validateStringLength('', 'name', 1, 10);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.message).toContain('between 1 and 10');
      }
    });

    it('should reject string above maximum', () => {
      const result = validateStringLength('a'.repeat(11), 'name', 1, 10);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.message).toContain('between 1 and 10');
      }
    });

    it('should include field name in error message', () => {
      const result = validateStringLength('', 'displayName', 1, 100);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error.message).toContain('displayName');
      }
    });

    it('should handle zero minimum', () => {
      const result = validateStringLength('', 'optional', 0, 100);
      expect(result.valid).toBe(true);
    });
  });
});
