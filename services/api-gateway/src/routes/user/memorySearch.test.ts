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
  const isValidDate = (str: string): boolean => !Number.isNaN(new Date(str).getTime());
  const hasValue = (str: string | undefined): str is string => str !== undefined && str.length > 0;

  if (hasValue(dateFrom) && !isValidDate(dateFrom)) {
    return { error: 'dateFrom is not a valid date format' };
  }
  if (hasValue(dateTo) && !isValidDate(dateTo)) {
    return { error: 'dateTo is not a valid date format' };
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
      expect(result).toEqual({ error: 'dateFrom is not a valid date format' });
    });

    it('returns error for invalid dateTo', () => {
      const result = validateDateFilters('2024-01-15', 'not-a-date');
      expect(result).toEqual({ error: 'dateTo is not a valid date format' });
    });

    it('returns error for malformed dateFrom', () => {
      const result = validateDateFilters('2024-13-45', undefined);
      expect(result).toEqual({ error: 'dateFrom is not a valid date format' });
    });

    it('returns error for SQL injection attempts', () => {
      const result = validateDateFilters("'; DROP TABLE memories; --", undefined);
      expect(result).toEqual({ error: 'dateFrom is not a valid date format' });
    });

    it('accepts partial dates (JS parses as first of month)', () => {
      // JavaScript Date parses '2024-01' as Jan 1, 2024 which PostgreSQL also accepts
      const result = validateDateFilters('2024-01', undefined);
      expect(result).toEqual({ dateFrom: '2024-01', dateTo: undefined });
    });
  });
});
