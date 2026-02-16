/**
 * Tests for shared formatting utilities
 */

import { describe, it, expect } from 'vitest';
import { formatDuration } from './formatting.js';

describe('formatDuration', () => {
  it('should format seconds', () => {
    expect(formatDuration(5000)).toBe('5s');
    expect(formatDuration(0)).toBe('0s');
  });

  it('should format minutes', () => {
    expect(formatDuration(60_000)).toBe('1m');
    expect(formatDuration(150_000)).toBe('2m');
  });

  it('should format hours and minutes', () => {
    expect(formatDuration(3_600_000)).toBe('1h 0m');
    expect(formatDuration(5_400_000)).toBe('1h 30m');
  });

  it('should format days and hours', () => {
    expect(formatDuration(86_400_000)).toBe('1d 0h');
    expect(formatDuration(90_000_000)).toBe('1d 1h');
    expect(formatDuration(302_400_000)).toBe('3d 12h');
  });
});
