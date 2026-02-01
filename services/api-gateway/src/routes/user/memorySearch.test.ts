/**
 * Tests for Memory Search Handler
 */

import { describe, expect, it } from 'vitest';

// Mirror the validateDateFilters logic for testing
// (it's a private helper in the module)
function validateDateFilters(
  dateFrom: string | undefined,
  dateTo: string | undefined
): { dateFrom?: string; dateTo?: string } | { error: string } {
  // Require full date format: YYYY-MM-DD with optional time component
  const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;

  const isValidDate = (str: string): boolean => {
    if (!ISO_DATE_REGEX.test(str)) {
      return false;
    }
    const date = new Date(str);
    if (Number.isNaN(date.getTime())) {
      return false;
    }
    // PostgreSQL-safe year range
    const year = date.getUTCFullYear();
    return year >= 1900 && year <= 2200;
  };

  const hasValue = (str: string | undefined): str is string => str !== undefined && str.length > 0;

  if (hasValue(dateFrom) && !isValidDate(dateFrom)) {
    return { error: 'dateFrom must be a valid ISO 8601 date (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)' };
  }
  if (hasValue(dateTo) && !isValidDate(dateTo)) {
    return { error: 'dateTo must be a valid ISO 8601 date (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)' };
  }

  return {
    dateFrom: hasValue(dateFrom) ? dateFrom : undefined,
    dateTo: hasValue(dateTo) ? dateTo : undefined,
  };
}

describe('memorySearch date validation', () => {
  describe('validateDateFilters', () => {
    it('returns undefined for both when inputs are undefined', () => {
      const result = validateDateFilters(undefined, undefined);
      expect(result).toEqual({ dateFrom: undefined, dateTo: undefined });
    });

    it('returns undefined for empty strings', () => {
      const result = validateDateFilters('', '');
      expect(result).toEqual({ dateFrom: undefined, dateTo: undefined });
    });

    it('accepts valid ISO 8601 dates', () => {
      const result = validateDateFilters('2024-01-15', '2024-02-15');
      expect(result).toEqual({ dateFrom: '2024-01-15', dateTo: '2024-02-15' });
    });

    it('accepts valid ISO 8601 datetime', () => {
      const result = validateDateFilters('2024-01-15T10:30:00Z', undefined);
      expect(result).toEqual({ dateFrom: '2024-01-15T10:30:00Z', dateTo: undefined });
    });

    it('accepts valid ISO 8601 datetime with timezone offset', () => {
      const result = validateDateFilters(undefined, '2024-01-15T10:30:00+05:00');
      expect(result).toEqual({ dateFrom: undefined, dateTo: '2024-01-15T10:30:00+05:00' });
    });

    it('returns error for invalid dateFrom', () => {
      const result = validateDateFilters('not-a-date', '2024-01-15');
      expect(result).toEqual({
        error: 'dateFrom must be a valid ISO 8601 date (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)',
      });
    });

    it('returns error for invalid dateTo', () => {
      const result = validateDateFilters('2024-01-15', 'not-a-date');
      expect(result).toEqual({
        error: 'dateTo must be a valid ISO 8601 date (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)',
      });
    });

    it('returns error for malformed dateFrom', () => {
      const result = validateDateFilters('2024-13-45', undefined);
      expect(result).toEqual({
        error: 'dateFrom must be a valid ISO 8601 date (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)',
      });
    });

    it('returns error for SQL injection attempts', () => {
      const result = validateDateFilters("'; DROP TABLE memories; --", undefined);
      expect(result).toEqual({
        error: 'dateFrom must be a valid ISO 8601 date (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)',
      });
    });

    it('rejects partial dates (requires full YYYY-MM-DD)', () => {
      // Partial dates like '2024-01' are now rejected to ensure consistent behavior
      const result = validateDateFilters('2024-01', undefined);
      expect(result).toEqual({
        error: 'dateFrom must be a valid ISO 8601 date (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)',
      });
    });

    it('rejects dates with years outside PostgreSQL-safe range', () => {
      // Year too far in past
      const pastResult = validateDateFilters('1800-01-01', undefined);
      expect(pastResult).toEqual({
        error: 'dateFrom must be a valid ISO 8601 date (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)',
      });

      // Year too far in future
      const futureResult = validateDateFilters('2300-01-01', undefined);
      expect(futureResult).toEqual({
        error: 'dateFrom must be a valid ISO 8601 date (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)',
      });
    });

    it('accepts dates within reasonable year range', () => {
      const result = validateDateFilters('1900-01-01', '2200-12-31');
      expect(result).toEqual({ dateFrom: '1900-01-01', dateTo: '2200-12-31' });
    });
  });
});
