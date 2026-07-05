/**
 * Tests for settingsInputParser — the modal text-input coercion helpers.
 */

import { describe, it, expect } from 'vitest';
import { CONFIG_WIRE_OFF } from '@tzurot/common-types/schemas/api/configOverrides';
import { parseNumericInputValue, parseDurationInputValue } from './settingsInputParser.js';

describe('parseNumericInputValue', () => {
  it('treats empty input as inherit (null)', () => {
    expect(parseNumericInputValue('', 1, 100)).toEqual({ value: null });
    expect(parseNumericInputValue('   ', 1, 100)).toEqual({ value: null });
  });

  it('treats "auto" (any case) as inherit (null)', () => {
    expect(parseNumericInputValue('auto', 1, 100)).toEqual({ value: null });
    expect(parseNumericInputValue('AUTO', 1, 100)).toEqual({ value: null });
  });

  it('parses a valid integer in range', () => {
    expect(parseNumericInputValue('50', 1, 100)).toEqual({ value: 50 });
  });

  it('parses a decimal (e.g. a 0-1 threshold)', () => {
    expect(parseNumericInputValue('0.5', 0, 1)).toEqual({ value: 0.5 });
  });

  it('rejects non-numeric input', () => {
    expect(parseNumericInputValue('abc', 1, 100).error).toContain('Invalid number');
  });

  it('rejects mixed numeric/alpha input like "50abc"', () => {
    expect(parseNumericInputValue('50abc', 1, 100).error).toContain('Invalid number');
  });

  it('rejects a value below the minimum', () => {
    expect(parseNumericInputValue('0', 1, 100).error).toContain('between 1 and 100');
  });

  it('rejects a value above the maximum', () => {
    expect(parseNumericInputValue('999', 1, 100).error).toContain('between 1 and 100');
  });
});

describe('parseDurationInputValue', () => {
  it('treats "auto" as inherit (null)', () => {
    expect(parseDurationInputValue('auto')).toEqual({ value: null });
  });

  it('treats "off"/"disabled" as the -1 sentinel', () => {
    expect(parseDurationInputValue('off')).toEqual({ value: CONFIG_WIRE_OFF });
    expect(parseDurationInputValue('disabled')).toEqual({ value: CONFIG_WIRE_OFF });
  });

  it('parses short-form durations to seconds', () => {
    expect(parseDurationInputValue('2h')).toEqual({ value: 7200 });
    expect(parseDurationInputValue('30m')).toEqual({ value: 1800 });
    expect(parseDurationInputValue('1d')).toEqual({ value: 86400 });
  });

  it('parses long-form durations to seconds', () => {
    expect(parseDurationInputValue('2 hours')).toEqual({ value: 7200 });
    expect(parseDurationInputValue('90 minutes')).toEqual({ value: 5400 });
    expect(parseDurationInputValue('1 day')).toEqual({ value: 86400 });
  });

  it('returns an error for an unparseable duration', () => {
    expect(parseDurationInputValue('abc').error).toBeDefined();
  });

  it('returns an error for a duration under the 1-minute floor', () => {
    expect(parseDurationInputValue('30s').error).toBeDefined();
  });
});
