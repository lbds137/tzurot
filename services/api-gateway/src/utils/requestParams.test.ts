/**
 * Tests for Request Parameter Utilities
 */

import { describe, it, expect } from 'vitest';
import { getParam, getRequiredParam, ParameterError } from './requestParams.js';

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

    it('should throw ParameterError for undefined', () => {
      expect(() => getRequiredParam(undefined, 'id')).toThrow(ParameterError);
      expect(() => getRequiredParam(undefined, 'id')).toThrow('Missing required parameter: id');
    });

    it('should throw ParameterError for empty string', () => {
      expect(() => getRequiredParam('', 'slug')).toThrow(ParameterError);
      expect(() => getRequiredParam('', 'slug')).toThrow('Missing required parameter: slug');
    });

    it('should throw ParameterError for empty array', () => {
      expect(() => getRequiredParam([], 'configId')).toThrow(ParameterError);
      expect(() => getRequiredParam([], 'configId')).toThrow(
        'Missing required parameter: configId'
      );
    });

    it('should include paramName in ParameterError', () => {
      try {
        getRequiredParam(undefined, 'testParam');
      } catch (error) {
        expect(error).toBeInstanceOf(ParameterError);
        expect((error as ParameterError).paramName).toBe('testParam');
      }
    });
  });

  describe('ParameterError', () => {
    it('should have correct name property', () => {
      const error = new ParameterError('testParam');
      expect(error.name).toBe('ParameterError');
    });

    it('should have correct message', () => {
      const error = new ParameterError('userId');
      expect(error.message).toBe('Missing required parameter: userId');
    });

    it('should store paramName', () => {
      const error = new ParameterError('configId');
      expect(error.paramName).toBe('configId');
    });

    it('should be instanceof Error', () => {
      const error = new ParameterError('test');
      expect(error).toBeInstanceOf(Error);
    });
  });
});
