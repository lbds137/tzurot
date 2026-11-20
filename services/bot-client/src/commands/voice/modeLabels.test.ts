/**
 * Tests for the shared Voice Response Mode labels.
 * Pins every cascade-source label and every mode-value label exactly —
 * `/voice view` and `/voice replies` both render these strings.
 */

import { describe, it, expect } from 'vitest';
import { voiceModeSourceLabel, voiceModeValueLabel } from './modeLabels.js';
import { type ConfigOverrideSource } from '@tzurot/common-types/schemas/api/configOverrides';

describe('voiceModeSourceLabel', () => {
  it('labels every cascade source', () => {
    const sources: ConfigOverrideSource[] = [
      'user-personality',
      'user-default',
      'personality',
      'channel',
      'admin',
      'hardcoded',
    ];
    expect(voiceModeSourceLabel(sources[0])).toBe('your override for this character');
    expect(voiceModeSourceLabel(sources[1])).toBe('your default for every character');
    expect(voiceModeSourceLabel(sources[2])).toBe("the character's default");
    expect(voiceModeSourceLabel(sources[3])).toBe("this channel's setting");
    expect(voiceModeSourceLabel(sources[4])).toBe('bot-wide setting');
    expect(voiceModeSourceLabel(sources[5])).toBe('built-in default');
  });
});

describe('voiceModeValueLabel', () => {
  it('labels every voice response mode value', () => {
    expect(voiceModeValueLabel('always')).toBe('Always');
    expect(voiceModeValueLabel('voice-only')).toBe('Only when you send voice');
    expect(voiceModeValueLabel('never')).toBe('Never');
  });
});
