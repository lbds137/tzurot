import { describe, it, expect } from 'vitest';
import { mapTtsConfigFromDbWithName, type RawTtsConfigFromDb } from './TtsConfigMapper.js';

describe('mapTtsConfigFromDbWithName', () => {
  const baseRaw: RawTtsConfigFromDb = {
    name: 'test-config',
    provider: 'mistral',
    modelId: 'voxtral-mini-tts-2603',
    advancedParameters: null,
    isGlobal: false,
    isDefault: false,
    isFreeDefault: false,
  };

  it('maps a clean row to the app shape', () => {
    const mapped = mapTtsConfigFromDbWithName(baseRaw);
    expect(mapped.name).toBe('test-config');
    expect(mapped.provider).toBe('mistral');
    expect(mapped.modelId).toBe('voxtral-mini-tts-2603');
    expect(mapped.advancedParameters).toEqual({});
  });

  it('narrows provider strings to TtsProviderId', () => {
    expect(mapTtsConfigFromDbWithName({ ...baseRaw, provider: 'self-hosted' }).provider).toBe(
      'self-hosted'
    );
    expect(mapTtsConfigFromDbWithName({ ...baseRaw, provider: 'elevenlabs' }).provider).toBe(
      'elevenlabs'
    );
    expect(mapTtsConfigFromDbWithName({ ...baseRaw, provider: 'mistral' }).provider).toBe(
      'mistral'
    );
  });

  it('falls back to self-hosted on unknown provider strings', () => {
    expect(mapTtsConfigFromDbWithName({ ...baseRaw, provider: 'mystery' }).provider).toBe(
      'self-hosted'
    );
    expect(mapTtsConfigFromDbWithName({ ...baseRaw, provider: '' }).provider).toBe('self-hosted');
  });

  it('preserves modelId null for self-hosted-style rows', () => {
    const mapped = mapTtsConfigFromDbWithName({
      ...baseRaw,
      provider: 'self-hosted',
      modelId: null,
    });
    expect(mapped.modelId).toBeNull();
  });

  it('passes advancedParameters through when it is an object', () => {
    const params = { stability: 0.5, similarityBoost: 0.75 };
    const mapped = mapTtsConfigFromDbWithName({ ...baseRaw, advancedParameters: params });
    expect(mapped.advancedParameters).toEqual(params);
  });

  it('coerces non-object advancedParameters to {}', () => {
    expect(
      mapTtsConfigFromDbWithName({ ...baseRaw, advancedParameters: 'not-an-object' })
        .advancedParameters
    ).toEqual({});
    expect(
      mapTtsConfigFromDbWithName({ ...baseRaw, advancedParameters: 42 }).advancedParameters
    ).toEqual({});
  });
});
