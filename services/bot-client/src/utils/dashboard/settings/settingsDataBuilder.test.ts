/**
 * Tests for Settings Data Builder
 *
 * Tests the shared utility for converting API responses to SettingsData format.
 */

import { describe, it, expect } from 'vitest';
import {
  HARDCODED_CONFIG_DEFAULTS,
  type ResolvedConfigOverrides,
} from '@tzurot/common-types/schemas/api/configOverrides';
import {
  buildSystemSettingsData,
  buildCascadeSettingsData,
  buildFallbackSettingsData,
  convertResolveDefaultsResponse,
  type ResolveDefaultsResponse,
} from './settingsDataBuilder.js';

describe('buildCascadeSettingsData', () => {
  it('should use resolved values and sources when resolved data is provided', () => {
    const resolved: ResolvedConfigOverrides = {
      maxMessages: 75,
      maxAge: 3600,
      maxImages: 15,
      memoryScoreThreshold: 0.7,
      memoryLimit: 30,
      crossChannelHistoryEnabled: false,
      shareLtmAcrossPersonalities: false,
      showModelFooter: true,
      voiceResponseMode: 'always' as const,
      voiceTranscriptionEnabled: true,
      shareHistoryAcrossPersonalities: 'always' as const,
      sources: {
        maxMessages: 'admin',
        maxAge: 'personality',
        maxImages: 'admin',
        memoryScoreThreshold: 'hardcoded',
        memoryLimit: 'channel',
        crossChannelHistoryEnabled: 'hardcoded',
        shareLtmAcrossPersonalities: 'hardcoded',
        showModelFooter: 'hardcoded',
        voiceResponseMode: 'hardcoded' as const,
        voiceTranscriptionEnabled: 'hardcoded' as const,
        shareHistoryAcrossPersonalities: 'hardcoded' as const,
      },
      parentValues: { ...HARDCODED_CONFIG_DEFAULTS },
    };

    const result = buildCascadeSettingsData(resolved, null, 'channel');

    expect(result.maxMessages.effectiveValue).toBe(75);
    expect(result.maxMessages.source).toBe('admin');
    expect(result.maxMessages.localValue).toBeNull();

    expect(result.maxAge.effectiveValue).toBe(3600);
    expect(result.maxAge.source).toBe('personality');
  });

  it('should populate localValue from localOverrides', () => {
    const resolved: ResolvedConfigOverrides = {
      maxMessages: 25,
      maxAge: null,
      maxImages: 10,
      memoryScoreThreshold: 0.5,
      memoryLimit: 20,
      crossChannelHistoryEnabled: false,
      shareLtmAcrossPersonalities: false,
      showModelFooter: true,
      voiceResponseMode: 'always' as const,
      voiceTranscriptionEnabled: true,
      shareHistoryAcrossPersonalities: 'always' as const,
      sources: {
        maxMessages: 'channel',
        maxAge: 'hardcoded',
        maxImages: 'hardcoded',
        memoryScoreThreshold: 'hardcoded',
        memoryLimit: 'hardcoded',
        crossChannelHistoryEnabled: 'hardcoded',
        shareLtmAcrossPersonalities: 'hardcoded',
        showModelFooter: 'hardcoded',
        voiceResponseMode: 'hardcoded' as const,
        voiceTranscriptionEnabled: 'hardcoded' as const,
        shareHistoryAcrossPersonalities: 'hardcoded' as const,
      },
      parentValues: { ...HARDCODED_CONFIG_DEFAULTS },
    };

    const localOverrides = { maxMessages: 25 };

    const result = buildCascadeSettingsData(resolved, localOverrides, 'channel');

    expect(result.maxMessages.localValue).toBe(25);
    expect(result.maxMessages.effectiveValue).toBe(25);
    expect(result.maxMessages.source).toBe('channel');

    // Fields without local overrides should have null localValue
    expect(result.maxImages.localValue).toBeNull();
  });

  it('should fall back to hardcoded defaults when no resolve data is available', () => {
    const result = buildCascadeSettingsData(null, null, 'admin');

    expect(result.maxMessages.effectiveValue).toBe(HARDCODED_CONFIG_DEFAULTS.maxMessages);
    expect(result.maxMessages.source).toBe('hardcoded');
    expect(result.maxMessages.localValue).toBeNull();

    expect(result.maxAge.effectiveValue).toBe(HARDCODED_CONFIG_DEFAULTS.maxAge);
    expect(result.maxAge.source).toBe('hardcoded');
  });

  it('should use local overrides as effective values when no resolve data is available', () => {
    const localOverrides = { maxMessages: 75, maxImages: 15 };

    const result = buildCascadeSettingsData(null, localOverrides, 'admin');

    expect(result.maxMessages.effectiveValue).toBe(75);
    expect(result.maxMessages.source).toBe('admin');
    expect(result.maxMessages.localValue).toBe(75);

    expect(result.maxImages.effectiveValue).toBe(15);
    expect(result.maxImages.source).toBe('admin');

    // Fields without local overrides fall back to hardcoded
    expect(result.maxAge.effectiveValue).toBe(HARDCODED_CONFIG_DEFAULTS.maxAge);
    expect(result.maxAge.source).toBe('hardcoded');
  });

  it('should handle mixed sources from resolved data', () => {
    const resolved: ResolvedConfigOverrides = {
      maxMessages: 20,
      maxAge: null,
      maxImages: 5,
      memoryScoreThreshold: 0.5,
      memoryLimit: 20,
      crossChannelHistoryEnabled: false,
      shareLtmAcrossPersonalities: false,
      showModelFooter: true,
      voiceResponseMode: 'always' as const,
      voiceTranscriptionEnabled: true,
      shareHistoryAcrossPersonalities: 'always' as const,
      sources: {
        maxMessages: 'admin',
        maxAge: 'hardcoded',
        maxImages: 'user-personality',
        memoryScoreThreshold: 'hardcoded',
        memoryLimit: 'hardcoded',
        crossChannelHistoryEnabled: 'hardcoded',
        shareLtmAcrossPersonalities: 'hardcoded',
        showModelFooter: 'hardcoded',
        voiceResponseMode: 'hardcoded' as const,
        voiceTranscriptionEnabled: 'hardcoded' as const,
        shareHistoryAcrossPersonalities: 'hardcoded' as const,
      },
      parentValues: { ...HARDCODED_CONFIG_DEFAULTS },
    };

    const localOverrides = { maxImages: 5 };

    const result = buildCascadeSettingsData(resolved, localOverrides, 'user-personality');

    // Admin-sourced field: not local
    expect(result.maxMessages.source).toBe('admin');
    expect(result.maxMessages.localValue).toBeNull();

    // User-personality-sourced field with local override
    expect(result.maxImages.source).toBe('user-personality');
    expect(result.maxImages.localValue).toBe(5);
    expect(result.maxImages.effectiveValue).toBe(5);
  });

  it('should include all 11 config fields', () => {
    const result = buildCascadeSettingsData(null, null, 'admin');

    const expectedFields = [
      'maxMessages',
      'maxAge',
      'maxImages',
      'memoryScoreThreshold',
      'memoryLimit',
      'crossChannelHistoryEnabled',
      'shareLtmAcrossPersonalities',
      'showModelFooter',
      'voiceResponseMode',
      'voiceTranscriptionEnabled',
    ];

    for (const field of expectedFields) {
      expect(result).toHaveProperty(field);
      expect(result[field as keyof typeof result]).toHaveProperty('localValue');
      expect(result[field as keyof typeof result]).toHaveProperty('effectiveValue');
      expect(result[field as keyof typeof result]).toHaveProperty('source');
    }
  });
});

describe('buildCascadeSettingsData parentValue (3-branch rule)', () => {
  it('uses HARDCODED_CONFIG_DEFAULTS when resolved is null (admin dashboard — lowest tier)', () => {
    const result = buildCascadeSettingsData(null, { maxMessages: 75 }, 'admin');

    expect(result.maxMessages.source).toBe('admin');
    expect(result.maxMessages.parentValue).toBe(HARDCODED_CONFIG_DEFAULTS.maxMessages);
  });

  it("uses resolved.parentValues when THIS dashboard's tier is the winner", () => {
    const resolved: ResolvedConfigOverrides = {
      ...HARDCODED_CONFIG_DEFAULTS,
      maxAge: null,
      sources: {
        maxMessages: 'hardcoded',
        maxAge: 'user-default',
        maxImages: 'hardcoded',
        memoryScoreThreshold: 'hardcoded',
        memoryLimit: 'hardcoded',
        crossChannelHistoryEnabled: 'hardcoded',
        shareLtmAcrossPersonalities: 'hardcoded',
        showModelFooter: 'hardcoded',
        voiceResponseMode: 'hardcoded',
        voiceTranscriptionEnabled: 'hardcoded',
        shareHistoryAcrossPersonalities: 'hardcoded',
      },
      parentValues: {
        ...HARDCODED_CONFIG_DEFAULTS,
        maxAge: 2592000, // admin's 30-day value, one tier below the winning user-default tier
      },
    };

    const result = buildCascadeSettingsData(resolved, { maxAge: null }, 'user-default');

    expect(result.maxAge.effectiveValue).toBeNull();
    expect(result.maxAge.source).toBe('user-default');
    expect(result.maxAge.parentValue).toBe(2592000);
  });

  it('uses effectiveValue when a HIGHER tier outranks this dashboard (removing a non-winning tier changes nothing)', () => {
    const resolved: ResolvedConfigOverrides = {
      ...HARDCODED_CONFIG_DEFAULTS,
      maxAge: 999,
      sources: {
        maxMessages: 'hardcoded',
        maxAge: 'user-default', // a HIGHER tier than this dashboard's 'channel'
        maxImages: 'hardcoded',
        memoryScoreThreshold: 'hardcoded',
        memoryLimit: 'hardcoded',
        crossChannelHistoryEnabled: 'hardcoded',
        shareLtmAcrossPersonalities: 'hardcoded',
        showModelFooter: 'hardcoded',
        voiceResponseMode: 'hardcoded',
        voiceTranscriptionEnabled: 'hardcoded',
        shareHistoryAcrossPersonalities: 'hardcoded',
      },
      parentValues: { ...HARDCODED_CONFIG_DEFAULTS, maxAge: 111 },
    };

    // This dashboard is 'channel' but the resolved source for maxAge is 'user-default' —
    // a higher tier. Clearing the channel tier can't change the resolution.
    const result = buildCascadeSettingsData(resolved, { maxAge: 555 }, 'channel');

    expect(result.maxAge.source).toBe('user-default');
    expect(result.maxAge.effectiveValue).toBe(999);
    expect(result.maxAge.parentValue).toBe(999);
  });
});

describe('convertResolveDefaultsResponse', () => {
  it('should convert flat resolve-defaults response to ResolvedConfigOverrides', () => {
    const response: ResolveDefaultsResponse = {
      maxMessages: 75,
      maxAge: null,
      maxImages: 10,
      crossChannelHistoryEnabled: false,
      shareLtmAcrossPersonalities: false,
      memoryScoreThreshold: 0.5,
      memoryLimit: 20,
      showModelFooter: true,
      voiceResponseMode: 'always' as const,
      voiceTranscriptionEnabled: true,
      shareHistoryAcrossPersonalities: 'always' as const,
      sources: {
        maxMessages: 'admin',
        maxAge: 'hardcoded',
        maxImages: 'hardcoded',
        crossChannelHistoryEnabled: 'hardcoded',
        shareLtmAcrossPersonalities: 'hardcoded',
        memoryScoreThreshold: 'hardcoded',
        memoryLimit: 'hardcoded',
        showModelFooter: 'hardcoded',
        voiceResponseMode: 'hardcoded' as const,
        voiceTranscriptionEnabled: 'hardcoded' as const,
      },
      parentValues: { ...HARDCODED_CONFIG_DEFAULTS },
      userOverrides: { maxMessages: 30 },
    };

    const { resolved, userOverrides } = convertResolveDefaultsResponse(response);

    expect(resolved.maxMessages).toBe(75);
    expect(resolved.maxAge).toBeNull();
    expect(resolved.sources.maxMessages).toBe('admin');
    expect(resolved.sources.maxAge).toBe('hardcoded');
    expect(resolved.parentValues).toEqual(HARDCODED_CONFIG_DEFAULTS);
    expect(userOverrides).toEqual({ maxMessages: 30 });
  });

  it('should return null userOverrides when response has null', () => {
    const response: ResolveDefaultsResponse = {
      maxMessages: HARDCODED_CONFIG_DEFAULTS.maxMessages,
      maxAge: HARDCODED_CONFIG_DEFAULTS.maxAge,
      maxImages: HARDCODED_CONFIG_DEFAULTS.maxImages,
      crossChannelHistoryEnabled: false,
      shareLtmAcrossPersonalities: false,
      memoryScoreThreshold: 0.5,
      memoryLimit: 20,
      showModelFooter: true,
      voiceResponseMode: 'always' as const,
      voiceTranscriptionEnabled: true,
      shareHistoryAcrossPersonalities: 'always' as const,
      sources: {
        maxMessages: 'hardcoded',
        maxAge: 'hardcoded',
        maxImages: 'hardcoded',
        crossChannelHistoryEnabled: 'hardcoded',
        shareLtmAcrossPersonalities: 'hardcoded',
        memoryScoreThreshold: 'hardcoded',
        memoryLimit: 'hardcoded',
        showModelFooter: 'hardcoded',
        voiceResponseMode: 'hardcoded' as const,
        voiceTranscriptionEnabled: 'hardcoded' as const,
      },
      parentValues: { ...HARDCODED_CONFIG_DEFAULTS },
      userOverrides: null,
    };

    const { userOverrides } = convertResolveDefaultsResponse(response);

    expect(userOverrides).toBeNull();
  });
});

describe('buildFallbackSettingsData', () => {
  it('should return all hardcoded defaults with hardcoded source', () => {
    const result = buildFallbackSettingsData();

    expect(result.maxMessages.effectiveValue).toBe(HARDCODED_CONFIG_DEFAULTS.maxMessages);
    expect(result.maxMessages.source).toBe('hardcoded');
    expect(result.maxMessages.localValue).toBeNull();

    expect(result.maxAge.effectiveValue).toBe(HARDCODED_CONFIG_DEFAULTS.maxAge);
    expect(result.maxAge.source).toBe('hardcoded');
    expect(result.maxAge.localValue).toBeNull();

    expect(result.maxImages.effectiveValue).toBe(HARDCODED_CONFIG_DEFAULTS.maxImages);
    expect(result.crossChannelHistoryEnabled.effectiveValue).toBe(false);
    expect(result.shareLtmAcrossPersonalities.effectiveValue).toBe(false);
    expect(result.memoryScoreThreshold.effectiveValue).toBe(0.5);
    expect(result.memoryLimit.effectiveValue).toBe(20);
    expect(result.showModelFooter.effectiveValue).toBe(true);
  });

  it('carries the hardcoded default as parentValue for every field', () => {
    const result = buildFallbackSettingsData();

    for (const field of Object.keys(HARDCODED_CONFIG_DEFAULTS) as (keyof typeof result)[]) {
      expect(result[field].parentValue).toBe(
        HARDCODED_CONFIG_DEFAULTS[field as keyof typeof HARDCODED_CONFIG_DEFAULTS]
      );
    }
  });

  it('should have null localValue for all fields', () => {
    const result = buildFallbackSettingsData();

    expect(result.maxMessages.localValue).toBeNull();
    expect(result.maxAge.localValue).toBeNull();
    expect(result.maxImages.localValue).toBeNull();
    expect(result.crossChannelHistoryEnabled.localValue).toBeNull();
    expect(result.shareLtmAcrossPersonalities.localValue).toBeNull();
    expect(result.memoryScoreThreshold.localValue).toBeNull();
    expect(result.memoryLimit.localValue).toBeNull();
    expect(result.showModelFooter.localValue).toBeNull();
  });
});

describe('buildSystemSettingsData (non-cascading bag adapter)', () => {
  it('wraps each bag entry in the SettingValue display shape', () => {
    const data = buildSystemSettingsData({ extractionEnabled: true, zaiHeadroomPercent: 75 });
    expect(data.extractionEnabled).toEqual({
      localValue: true,
      hasLocalOverride: true,
      effectiveValue: true,
      source: 'admin',
      parentValue: true,
    });
    expect(data.zaiHeadroomPercent.effectiveValue).toBe(75);
  });

  it('returns an empty map for an empty bag (pre-seed DB)', () => {
    expect(buildSystemSettingsData({})).toEqual({});
  });
});
