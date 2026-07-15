import { describe, it, expect } from 'vitest';
import { isEmptyPersonalityConfig } from './personalityConfigShape.js';

const EMPTY = {
  personaId: null,
  llmConfigId: null,
  visionConfigId: null,
  ttsConfigId: null,
  configOverrides: null,
};

describe('isEmptyPersonalityConfig', () => {
  it('is true only when every slice is null', () => {
    expect(isEmptyPersonalityConfig(EMPTY)).toBe(true);
  });

  it('is false when any single slice is set', () => {
    expect(isEmptyPersonalityConfig({ ...EMPTY, personaId: 'p' })).toBe(false);
    expect(isEmptyPersonalityConfig({ ...EMPTY, llmConfigId: 'l' })).toBe(false);
    expect(isEmptyPersonalityConfig({ ...EMPTY, visionConfigId: 'v' })).toBe(false);
    expect(isEmptyPersonalityConfig({ ...EMPTY, ttsConfigId: 't' })).toBe(false);
    expect(
      isEmptyPersonalityConfig({ ...EMPTY, configOverrides: { focusModeEnabled: true } })
    ).toBe(false);
  });
});
