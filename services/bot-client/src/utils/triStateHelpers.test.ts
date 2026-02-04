import { describe, it, expect } from 'vitest';
import {
  formatTriState,
  formatEffective,
  buildTriStateStatusMessage,
  buildTriStateUpdateMessage,
  EXTENDED_CONTEXT_DESCRIPTION,
} from './triStateHelpers.js';

describe('triStateHelpers', () => {
  describe('formatTriState', () => {
    it('returns "Auto" for null', () => {
      expect(formatTriState(null)).toBe('Auto');
    });

    it('returns "Auto" for undefined', () => {
      expect(formatTriState(undefined)).toBe('Auto');
    });

    it('returns "On" for true', () => {
      expect(formatTriState(true)).toBe('On');
    });

    it('returns "Off" for false', () => {
      expect(formatTriState(false)).toBe('Off');
    });
  });

  describe('formatEffective', () => {
    it('formats enabled state with source', () => {
      expect(formatEffective(true, 'personality')).toBe('**enabled** (from personality)');
      expect(formatEffective(true, 'user-personality')).toBe('**enabled** (from user-personality)');
      expect(formatEffective(true, 'user-default')).toBe('**enabled** (from user-default)');
    });

    it('formats disabled state with source', () => {
      expect(formatEffective(false, 'personality')).toBe('**disabled** (from personality)');
      expect(formatEffective(false, 'user-personality')).toBe(
        '**disabled** (from user-personality)'
      );
      expect(formatEffective(false, 'user-default')).toBe('**disabled** (from user-default)');
    });
  });

  describe('buildTriStateStatusMessage', () => {
    it('builds status message with Auto setting', () => {
      const message = buildTriStateStatusMessage({
        settingName: 'Extended Context',
        targetName: 'TestBot',
        currentValue: null,
        effectiveEnabled: true,
        source: 'user-default',
        description: 'Test description',
      });

      expect(message).toContain('**Extended Context for TestBot**');
      expect(message).toContain('Setting: **Auto**');
      expect(message).toContain('**enabled** (from user-default)');
      expect(message).toContain('Test description');
    });

    it('builds status message with On setting', () => {
      const message = buildTriStateStatusMessage({
        settingName: 'Extended Context',
        targetName: 'TestBot',
        currentValue: true,
        effectiveEnabled: true,
        source: 'personality',
        description: 'Test description',
      });

      expect(message).toContain('Setting: **On**');
      expect(message).toContain('**enabled** (from personality)');
    });

    it('builds status message with Off setting', () => {
      const message = buildTriStateStatusMessage({
        settingName: 'Extended Context',
        targetName: 'TestBot',
        currentValue: false,
        effectiveEnabled: false,
        source: 'personality',
        description: 'Test description',
      });

      expect(message).toContain('Setting: **Off**');
      expect(message).toContain('**disabled** (from personality)');
    });
  });

  describe('buildTriStateUpdateMessage', () => {
    it('builds update message for Auto with current status', () => {
      const message = buildTriStateUpdateMessage({
        settingName: 'Extended Context',
        targetName: 'TestBot',
        newValue: null,
        effectiveEnabled: true,
        source: 'user-default',
        targetType: 'character',
      });

      expect(message).toContain('**Extended Context set to Auto** for **TestBot**');
      expect(message).toContain('This will follow user-default settings');
      expect(message).toContain('Currently: **enabled**');
    });

    it('builds update message for On', () => {
      const message = buildTriStateUpdateMessage({
        settingName: 'Extended Context',
        targetName: 'TestBot',
        newValue: true,
        targetType: 'character',
      });

      expect(message).toContain('**Extended Context set to On** for **TestBot**');
      expect(message).toContain('Extended context is now always enabled for this character');
    });

    it('builds update message for Off', () => {
      const message = buildTriStateUpdateMessage({
        settingName: 'Extended Context',
        targetName: 'TestBot',
        newValue: false,
        targetType: 'character',
      });

      expect(message).toContain('**Extended Context set to Off** for **TestBot**');
      expect(message).toContain('Extended context is now always disabled for this character');
    });

    it('builds update message for channel target', () => {
      const message = buildTriStateUpdateMessage({
        settingName: 'Extended Context',
        targetName: 'this channel',
        newValue: true,
        targetType: 'channel',
      });

      expect(message).toContain('Extended context is now always enabled for this channel');
    });
  });

  describe('EXTENDED_CONTEXT_DESCRIPTION', () => {
    it('contains expected content', () => {
      expect(EXTENDED_CONTEXT_DESCRIPTION).toContain('Extended context allows');
      expect(EXTENDED_CONTEXT_DESCRIPTION).toContain('100');
      expect(EXTENDED_CONTEXT_DESCRIPTION).toContain('conversational awareness');
    });
  });
});
