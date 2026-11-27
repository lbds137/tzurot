import { describe, it, expect } from 'vitest';
import { DIAGNOSTIC_RETENTION_DAYS } from './diagnostics.js';

describe('DIAGNOSTIC_RETENTION_DAYS', () => {
  it('is a whole number of days (7)', () => {
    expect(Number.isInteger(DIAGNOSTIC_RETENTION_DAYS)).toBe(true);
    expect(DIAGNOSTIC_RETENTION_DAYS).toBe(7);
  });
});
