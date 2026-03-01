/**
 * Tests for SettingsModalFactory
 */

import { describe, it, expect } from 'vitest';
import { TextInputStyle } from 'discord.js';
import {
  buildSettingEditModal,
  parseNumericInput,
  parseDurationInput,
} from './SettingsModalFactory.js';
import { type SettingDefinition, SettingType } from './types.js';

// Helper to extract component data from modal JSON
function getModalComponents(modal: ReturnType<typeof buildSettingEditModal>) {
  const json = modal.toJSON();
  return json.components ?? [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Discord.js modal component structure is untyped in test context
function getTextInput(modal: ReturnType<typeof buildSettingEditModal>): any {
  const components = getModalComponents(modal);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Discord.js modal component structure is untyped in test context
  return (components[0] as any)?.components?.[0];
}

describe('SettingsModalFactory', () => {
  describe('buildSettingEditModal', () => {
    const numericSetting: SettingDefinition = {
      id: 'maxMessages',
      label: 'Max Messages',
      emoji: '💬',
      type: SettingType.NUMERIC,
      description: 'Maximum messages to include',
      placeholder: 'Enter a number (1-100) or "auto"',
      min: 1,
      max: 100,
    };

    const durationSetting: SettingDefinition = {
      id: 'maxAge',
      label: 'Max Age',
      emoji: '⏱️',
      type: SettingType.DURATION,
      description: 'Maximum age of messages',
      placeholder: 'e.g., 2h, 30m, 1d, or "auto"',
    };

    it('should create a modal with correct custom ID and title', () => {
      const modal = buildSettingEditModal('global', 'admin', numericSetting, 50);
      const json = modal.toJSON();

      expect(json.custom_id).toBe('global::modal::admin::maxMessages');
      expect(json.title).toBe('Edit Max Messages');
    });

    it('should add text input with placeholder', () => {
      const modal = buildSettingEditModal('channel', 'chan-123', numericSetting, 25);
      const input = getTextInput(modal);

      expect(input.custom_id).toBe('value');
      expect(input.label).toBe('Max Messages');
      expect(input.style).toBe(TextInputStyle.Short);
      expect(input.placeholder).toBe('Enter a number (1-100) or "auto"');
      expect(input.required).toBe(false);
    });

    it('should pre-fill numeric value', () => {
      const modal = buildSettingEditModal('global', 'admin', numericSetting, 75);
      const input = getTextInput(modal);

      expect(input.value).toBe('75');
    });

    it('should pre-fill string value', () => {
      const modal = buildSettingEditModal('global', 'admin', durationSetting, '2h');
      const input = getTextInput(modal);

      expect(input.value).toBe('2h');
    });

    it('should not pre-fill null value', () => {
      const modal = buildSettingEditModal('global', 'admin', numericSetting, null);
      const input = getTextInput(modal);

      expect(input.value).toBeUndefined();
    });

    it('should not pre-fill undefined value', () => {
      const modal = buildSettingEditModal('global', 'admin', numericSetting, undefined);
      const input = getTextInput(modal);

      expect(input.value).toBeUndefined();
    });

    it('should set max length to 20', () => {
      const modal = buildSettingEditModal('global', 'admin', durationSetting, '30m');
      const input = getTextInput(modal);

      expect(input.max_length).toBe(20);
    });

    it('should work with different entity types', () => {
      const modal = buildSettingEditModal('personality-settings', 'aurora', numericSetting, 10);
      const json = modal.toJSON();

      expect(json.custom_id).toBe('personality-settings::modal::aurora::maxMessages');
    });
  });

  describe('parseNumericInput', () => {
    describe('auto/empty values', () => {
      it('should return auto for empty string', () => {
        const result = parseNumericInput('', 1, 100);
        expect(result).toEqual({ type: 'auto' });
      });

      it('should return auto for "auto" keyword', () => {
        const result = parseNumericInput('auto', 1, 100);
        expect(result).toEqual({ type: 'auto' });
      });

      it('should return auto for "AUTO" (case insensitive)', () => {
        const result = parseNumericInput('AUTO', 1, 100);
        expect(result).toEqual({ type: 'auto' });
      });

      it('should return auto for whitespace-only input', () => {
        const result = parseNumericInput('   ', 1, 100);
        expect(result).toEqual({ type: 'auto' });
      });

      it('should return auto for "  auto  " (with whitespace)', () => {
        const result = parseNumericInput('  auto  ', 1, 100);
        expect(result).toEqual({ type: 'auto' });
      });
    });

    describe('valid numbers', () => {
      it('should return value for valid number', () => {
        const result = parseNumericInput('50', 1, 100);
        expect(result).toEqual({ type: 'value', value: 50 });
      });

      it('should return value for minimum', () => {
        const result = parseNumericInput('1', 1, 100);
        expect(result).toEqual({ type: 'value', value: 1 });
      });

      it('should return value for maximum', () => {
        const result = parseNumericInput('100', 1, 100);
        expect(result).toEqual({ type: 'value', value: 100 });
      });

      it('should handle leading/trailing whitespace', () => {
        const result = parseNumericInput('  42  ', 1, 100);
        expect(result).toEqual({ type: 'value', value: 42 });
      });
    });

    describe('invalid inputs', () => {
      it('should return error for non-numeric input', () => {
        const result = parseNumericInput('abc', 1, 100);
        expect(result.type).toBe('error');
        if (result.type === 'error') {
          expect(result.message).toContain('Invalid number');
        }
      });

      it('should return error for value below minimum', () => {
        const result = parseNumericInput('0', 1, 100);
        expect(result.type).toBe('error');
        if (result.type === 'error') {
          expect(result.message).toContain('between 1 and 100');
        }
      });

      it('should return error for value above maximum', () => {
        const result = parseNumericInput('150', 1, 100);
        expect(result.type).toBe('error');
        if (result.type === 'error') {
          expect(result.message).toContain('between 1 and 100');
        }
      });

      it('should return error for negative number', () => {
        const result = parseNumericInput('-5', 0, 20);
        expect(result.type).toBe('error');
        if (result.type === 'error') {
          expect(result.message).toContain('between 0 and 20');
        }
      });

      it('should accept decimal numbers', () => {
        const result = parseNumericInput('5.7', 1, 100);
        expect(result).toEqual({ type: 'value', value: 5.7 });
      });

      it('should accept decimal in 0-1 range (memoryScoreThreshold)', () => {
        const result = parseNumericInput('0.5', 0, 1);
        expect(result).toEqual({ type: 'value', value: 0.5 });
      });

      it('should reject mixed input like 50abc', () => {
        const result = parseNumericInput('50abc', 1, 100);
        expect(result).toEqual({ type: 'error', message: 'Invalid number: "50abc"' });
      });
    });
  });

  describe('parseDurationInput', () => {
    describe('auto/empty values', () => {
      it('should return auto for empty string', () => {
        const result = parseDurationInput('');
        expect(result).toEqual({ type: 'auto' });
      });

      it('should return auto for "auto" keyword', () => {
        const result = parseDurationInput('auto');
        expect(result).toEqual({ type: 'auto' });
      });

      it('should return auto for "AUTO" (case insensitive)', () => {
        const result = parseDurationInput('AUTO');
        expect(result).toEqual({ type: 'auto' });
      });

      it('should return auto for whitespace-only input', () => {
        const result = parseDurationInput('   ');
        expect(result).toEqual({ type: 'auto' });
      });
    });

    describe('off/disabled values', () => {
      it('should return off for "off"', () => {
        const result = parseDurationInput('off');
        expect(result).toEqual({ type: 'off' });
      });

      it('should return off for "OFF" (case insensitive)', () => {
        const result = parseDurationInput('OFF');
        expect(result).toEqual({ type: 'off' });
      });

      it('should return off for "disabled"', () => {
        const result = parseDurationInput('disabled');
        expect(result).toEqual({ type: 'off' });
      });

      it('should return off for "none"', () => {
        const result = parseDurationInput('none');
        expect(result).toEqual({ type: 'off' });
      });
    });

    describe('valid durations - seconds', () => {
      it('should parse "60s"', () => {
        const result = parseDurationInput('60s');
        expect(result).toEqual({ type: 'value', seconds: 60 });
      });

      it('should parse "120sec"', () => {
        const result = parseDurationInput('120sec');
        expect(result).toEqual({ type: 'value', seconds: 120 });
      });

      it('should parse "90 seconds"', () => {
        const result = parseDurationInput('90seconds');
        expect(result).toEqual({ type: 'value', seconds: 90 });
      });
    });

    describe('valid durations - minutes', () => {
      it('should parse "5m"', () => {
        const result = parseDurationInput('5m');
        expect(result).toEqual({ type: 'value', seconds: 300 });
      });

      it('should parse "30min"', () => {
        const result = parseDurationInput('30min');
        expect(result).toEqual({ type: 'value', seconds: 1800 });
      });

      it('should parse "1minute"', () => {
        const result = parseDurationInput('1minute');
        expect(result).toEqual({ type: 'value', seconds: 60 });
      });

      it('should parse "15minutes"', () => {
        const result = parseDurationInput('15minutes');
        expect(result).toEqual({ type: 'value', seconds: 900 });
      });
    });

    describe('valid durations - hours', () => {
      it('should parse "2h"', () => {
        const result = parseDurationInput('2h');
        expect(result).toEqual({ type: 'value', seconds: 7200 });
      });

      it('should parse "1hr"', () => {
        const result = parseDurationInput('1hr');
        expect(result).toEqual({ type: 'value', seconds: 3600 });
      });

      it('should parse "4hours"', () => {
        const result = parseDurationInput('4hours');
        expect(result).toEqual({ type: 'value', seconds: 14400 });
      });
    });

    describe('valid durations - days', () => {
      it('should parse "1d"', () => {
        const result = parseDurationInput('1d');
        expect(result).toEqual({ type: 'value', seconds: 86400 });
      });

      it('should parse "7days"', () => {
        const result = parseDurationInput('7days');
        expect(result).toEqual({ type: 'value', seconds: 604800 });
      });
    });

    describe('case insensitivity', () => {
      it('should parse "2H" (uppercase)', () => {
        const result = parseDurationInput('2H');
        expect(result).toEqual({ type: 'value', seconds: 7200 });
      });

      it('should parse "30M" (uppercase)', () => {
        const result = parseDurationInput('30M');
        expect(result).toEqual({ type: 'value', seconds: 1800 });
      });
    });

    describe('invalid inputs', () => {
      it('should return error for invalid format', () => {
        const result = parseDurationInput('invalid');
        expect(result.type).toBe('error');
        if (result.type === 'error') {
          expect(result.message).toContain('Invalid duration');
        }
      });

      it('should return error for number without unit', () => {
        const result = parseDurationInput('30');
        expect(result.type).toBe('error');
        if (result.type === 'error') {
          expect(result.message).toContain('Invalid duration');
        }
      });

      it('should return error for duration less than 1 minute', () => {
        const result = parseDurationInput('30s');
        expect(result.type).toBe('error');
        if (result.type === 'error') {
          expect(result.message).toContain('at least 1 minute');
        }
      });

      it('should return error for 0 duration', () => {
        const result = parseDurationInput('0h');
        expect(result.type).toBe('error');
        if (result.type === 'error') {
          // Duration.parse('0h') throws because 0 seconds is invalid
          expect(result.message).toContain('Invalid duration');
        }
      });
    });
  });
});
