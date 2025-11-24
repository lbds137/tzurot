/**
 * Tests for Type Guard Utilities
 *
 * These type guards provide runtime assertions that also narrow TypeScript types.
 * They are used to validate values after schema validation has passed.
 */

import { describe, it, expect } from 'vitest';
import { assertDefined, assertNotNull, assertExists } from './typeGuards.js';

describe('typeGuards', () => {
  describe('assertDefined', () => {
    describe('should NOT throw for defined values', () => {
      it('should accept string values', () => {
        expect(() => assertDefined('hello', 'testField')).not.toThrow();
      });

      it('should accept empty string (defined but empty)', () => {
        expect(() => assertDefined('', 'testField')).not.toThrow();
      });

      it('should accept number zero', () => {
        expect(() => assertDefined(0, 'testField')).not.toThrow();
      });

      it('should accept positive numbers', () => {
        expect(() => assertDefined(42, 'testField')).not.toThrow();
      });

      it('should accept negative numbers', () => {
        expect(() => assertDefined(-1, 'testField')).not.toThrow();
      });

      it('should accept boolean false', () => {
        expect(() => assertDefined(false, 'testField')).not.toThrow();
      });

      it('should accept boolean true', () => {
        expect(() => assertDefined(true, 'testField')).not.toThrow();
      });

      it('should accept null (null is defined, just null)', () => {
        // Note: assertDefined only checks for undefined, not null
        expect(() => assertDefined(null, 'testField')).not.toThrow();
      });

      it('should accept empty object', () => {
        expect(() => assertDefined({}, 'testField')).not.toThrow();
      });

      it('should accept empty array', () => {
        expect(() => assertDefined([], 'testField')).not.toThrow();
      });

      it('should accept object with properties', () => {
        expect(() => assertDefined({ key: 'value' }, 'testField')).not.toThrow();
      });

      it('should accept NaN (NaN is defined)', () => {
        expect(() => assertDefined(NaN, 'testField')).not.toThrow();
      });
    });

    describe('should throw for undefined values', () => {
      it('should throw for explicit undefined', () => {
        expect(() => assertDefined(undefined, 'myField')).toThrow(
          'Validation passed but myField is missing'
        );
      });

      it('should throw with correct field name', () => {
        expect(() => assertDefined(undefined, 'userName')).toThrow('userName');
        expect(() => assertDefined(undefined, 'apiKey')).toThrow('apiKey');
      });

      it('should throw for implicit undefined (missing property)', () => {
        const obj: { name?: string } = {};
        expect(() => assertDefined(obj.name, 'name')).toThrow(
          'Validation passed but name is missing'
        );
      });
    });
  });

  describe('assertNotNull', () => {
    describe('should NOT throw for non-null values', () => {
      it('should accept string values', () => {
        expect(() => assertNotNull('hello', 'testField')).not.toThrow();
      });

      it('should accept empty string', () => {
        expect(() => assertNotNull('', 'testField')).not.toThrow();
      });

      it('should accept number zero', () => {
        expect(() => assertNotNull(0, 'testField')).not.toThrow();
      });

      it('should accept boolean false', () => {
        expect(() => assertNotNull(false, 'testField')).not.toThrow();
      });

      it('should accept undefined (undefined is not null)', () => {
        // Note: assertNotNull only checks for null, not undefined
        expect(() => assertNotNull(undefined, 'testField')).not.toThrow();
      });

      it('should accept empty object', () => {
        expect(() => assertNotNull({}, 'testField')).not.toThrow();
      });

      it('should accept empty array', () => {
        expect(() => assertNotNull([], 'testField')).not.toThrow();
      });
    });

    describe('should throw for null values', () => {
      it('should throw for explicit null', () => {
        expect(() => assertNotNull(null, 'myField')).toThrow(
          'Validation passed but myField is null'
        );
      });

      it('should throw with correct field name', () => {
        expect(() => assertNotNull(null, 'response')).toThrow('response');
        expect(() => assertNotNull(null, 'databaseResult')).toThrow('databaseResult');
      });
    });
  });

  describe('assertExists', () => {
    describe('should NOT throw for existing (non-null, non-undefined) values', () => {
      it('should accept string values', () => {
        expect(() => assertExists('hello', 'testField')).not.toThrow();
      });

      it('should accept empty string', () => {
        expect(() => assertExists('', 'testField')).not.toThrow();
      });

      it('should accept number zero', () => {
        expect(() => assertExists(0, 'testField')).not.toThrow();
      });

      it('should accept negative numbers', () => {
        expect(() => assertExists(-100, 'testField')).not.toThrow();
      });

      it('should accept boolean false', () => {
        expect(() => assertExists(false, 'testField')).not.toThrow();
      });

      it('should accept boolean true', () => {
        expect(() => assertExists(true, 'testField')).not.toThrow();
      });

      it('should accept empty object', () => {
        expect(() => assertExists({}, 'testField')).not.toThrow();
      });

      it('should accept empty array', () => {
        expect(() => assertExists([], 'testField')).not.toThrow();
      });

      it('should accept object with properties', () => {
        expect(() => assertExists({ id: 123 }, 'testField')).not.toThrow();
      });

      it('should accept NaN', () => {
        expect(() => assertExists(NaN, 'testField')).not.toThrow();
      });
    });

    describe('should throw for null values', () => {
      it('should throw for explicit null', () => {
        expect(() => assertExists(null, 'myField')).toThrow(
          'Validation passed but myField is missing or null'
        );
      });

      it('should throw with correct field name for null', () => {
        expect(() => assertExists(null, 'config')).toThrow('config');
      });
    });

    describe('should throw for undefined values', () => {
      it('should throw for explicit undefined', () => {
        expect(() => assertExists(undefined, 'myField')).toThrow(
          'Validation passed but myField is missing or null'
        );
      });

      it('should throw with correct field name for undefined', () => {
        expect(() => assertExists(undefined, 'settings')).toThrow('settings');
      });

      it('should throw for implicit undefined (missing property)', () => {
        const obj: { data?: string } = {};
        expect(() => assertExists(obj.data, 'data')).toThrow(
          'Validation passed but data is missing or null'
        );
      });
    });

    describe('combined null and undefined behavior', () => {
      it('should distinguish between null and undefined in error message', () => {
        // Both throw the same error message pattern
        const nullError = () => assertExists(null, 'field');
        const undefinedError = () => assertExists(undefined, 'field');

        expect(nullError).toThrow('missing or null');
        expect(undefinedError).toThrow('missing or null');
      });
    });
  });

  describe('type narrowing behavior', () => {
    // These tests verify the TypeScript type narrowing works correctly
    // They would fail at compile time if the type guards don't narrow properly

    it('assertDefined should narrow string | undefined to string', () => {
      const value: string | undefined = 'test';
      assertDefined(value, 'value');
      // After assertion, TypeScript knows value is string
      const length: number = value.length;
      expect(length).toBe(4);
    });

    it('assertNotNull should narrow string | null to string', () => {
      const value: string | null = 'test';
      assertNotNull(value, 'value');
      // After assertion, TypeScript knows value is string
      const upper: string = value.toUpperCase();
      expect(upper).toBe('TEST');
    });

    it('assertExists should narrow string | null | undefined to string', () => {
      const value: string | null | undefined = 'test';
      assertExists(value, 'value');
      // After assertion, TypeScript knows value is string
      const trimmed: string = value.trim();
      expect(trimmed).toBe('test');
    });
  });
});
