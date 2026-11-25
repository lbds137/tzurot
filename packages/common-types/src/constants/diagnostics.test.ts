import { describe, it, expect } from 'vitest';
import { DIAGNOSTIC_LOG_RETENTION_HOURS, DIAGNOSTIC_RETENTION_DAYS } from './diagnostics.js';

describe('DIAGNOSTIC_RETENTION_DAYS', () => {
  it('derives whole days from the retention hours, as an integer', () => {
    expect(Number.isInteger(DIAGNOSTIC_RETENTION_DAYS)).toBe(true);
    expect(DIAGNOSTIC_RETENTION_DAYS).toBe(7);
    expect(DIAGNOSTIC_RETENTION_DAYS).toBe(Math.ceil(DIAGNOSTIC_LOG_RETENTION_HOURS / 24));
  });
});
