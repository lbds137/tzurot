/**
 * Tests for Request Parameter Utilities
 */

import { describe, it, expect } from 'vitest';
import { getParam, getRequiredParam } from './requestParams.js';

describe('requestParams', () => {
  describe('getParam', () => {
    it('should return undefined for undefined input', () => {
      expect(getParam(undefined)).toBeUndefined();
    });

    it('should return string as-is', () => {
      expect(getParam('test-value')).toBe('test-value');
    });

    it('should return first element of array', () => {
      expect(getParam(['first', 'second'])).toBe('first');
    });

    it('should return undefined for empty array', () => {
      expect(getParam([])).toBeUndefined();
    });

    it('should handle empty string', () => {
      expect(getParam('')).toBe('');
    });
  });

  describe('getRequiredParam', () => {
    it('should return string value', () => {
      expect(getRequiredParam('test-value', 'id')).toBe('test-value');
    });

    it('should return first element of array', () => {
      expect(getRequiredParam(['first', 'second'], 'id')).toBe('first');
    });

    it('should throw for undefined', () => {
      expect(() => getRequiredParam(undefined, 'id')).toThrow('Missing required parameter: id');
    });

    it('should throw for empty string', () => {
      expect(() => getRequiredParam('', 'slug')).toThrow('Missing required parameter: slug');
    });

    it('should throw for empty array', () => {
      expect(() => getRequiredParam([], 'configId')).toThrow(
        'Missing required parameter: configId'
      );
    });
  });
});
