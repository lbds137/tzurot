/**
 * Tests for Settings Data Builder
 *
 * Tests the shared utility for converting API responses to SettingsData format.
 */

import { describe, it, expect } from 'vitest';
import { HARDCODED_CONFIG_DEFAULTS, type ResolvedConfigOverrides } from '@tzurot/common-types';
import {
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
      focusModeEnabled: true,
      crossChannelHistoryEnabled: false,
      shareLtmAcrossPersonalities: false,
      showModelFooter: true,
      voiceResponseMode: 'always' as const,
      voiceTranscriptionEnabled: true,
      sources: {
        maxMessages: 'admin',
        maxAge: 'personality',
        maxImages: 'admin',
        memoryScoreThreshold: 'hardcoded',
        memoryLimit: 'channel',
        focusModeEnabled: 'user-default',
        crossChannelHistoryEnabled: 'hardcoded',
        shareLtmAcrossPersonalities: 'hardcoded',
        showModelFooter: 'hardcoded',
        voiceResponseMode: 'hardcoded' as const,
        voiceTranscriptionEnabled: 'hardcoded' as const,
      },
    };

    const result = buildCascadeSettingsData(resolved, null, 'channel');

    expect(result.maxMessages.effectiveValue).toBe(75);
    expect(result.maxMessages.source).toBe('admin');
    expect(result.maxMessages.localValue).toBeNull();

    expect(result.maxAge.effectiveValue).toBe(3600);
    expect(result.maxAge.source).toBe('personality');

    expect(result.focusModeEnabled.effectiveValue).toBe(true);
    expect(result.focusModeEnabled.source).toBe('user-default');
  });

  it('should populate localValue from localOverrides', () => {
    const resolved: ResolvedConfigOverrides = {
      maxMessages: 25,
      maxAge: null,
      maxImages: 10,
      memoryScoreThreshold: 0.5,
      memoryLimit: 20,
      focusModeEnabled: false,
      crossChannelHistoryEnabled: false,
      shareLtmAcrossPersonalities: false,
      showModelFooter: true,
      voiceResponseMode: 'always' as const,
      voiceTranscriptionEnabled: true,
      sources: {
        maxMessages: 'channel',
        maxAge: 'hardcoded',
        maxImages: 'hardcoded',
        memoryScoreThreshold: 'hardcoded',
        memoryLimit: 'hardcoded',
        focusModeEnabled: 'hardcoded',
        crossChannelHistoryEnabled: 'hardcoded',
        shareLtmAcrossPersonalities: 'hardcoded',
        showModelFooter: 'hardcoded',
        voiceResponseMode: 'hardcoded' as const,
        voiceTranscriptionEnabled: 'hardcoded' as const,
      },
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
      focusModeEnabled: false,
      crossChannelHistoryEnabled: false,
      shareLtmAcrossPersonalities: false,
      showModelFooter: true,
      voiceResponseMode: 'always' as const,
      voiceTranscriptionEnabled: true,
      sources: {
        maxMessages: 'admin',
        maxAge: 'hardcoded',
        maxImages: 'user-personality',
        memoryScoreThreshold: 'hardcoded',
        memoryLimit: 'hardcoded',
        focusModeEnabled: 'hardcoded',
        crossChannelHistoryEnabled: 'hardcoded',
        shareLtmAcrossPersonalities: 'hardcoded',
        showModelFooter: 'hardcoded',
        voiceResponseMode: 'hardcoded' as const,
        voiceTranscriptionEnabled: 'hardcoded' as const,
      },
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
      'focusModeEnabled',
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

describe('convertResolveDefaultsResponse', () => {
  it('should convert flat resolve-defaults response to ResolvedConfigOverrides', () => {
    const response: ResolveDefaultsResponse = {
      maxMessages: 75,
      maxAge: null,
      maxImages: 10,
      focusModeEnabled: false,
      crossChannelHistoryEnabled: false,
      shareLtmAcrossPersonalities: false,
      memoryScoreThreshold: 0.5,
      memoryLimit: 20,
      showModelFooter: true,
      voiceResponseMode: 'always' as const,
      voiceTranscriptionEnabled: true,
      sources: {
        maxMessages: 'admin',
        maxAge: 'hardcoded',
        maxImages: 'hardcoded',
        focusModeEnabled: 'hardcoded',
        crossChannelHistoryEnabled: 'hardcoded',
        shareLtmAcrossPersonalities: 'hardcoded',
        memoryScoreThreshold: 'hardcoded',
        memoryLimit: 'hardcoded',
        showModelFooter: 'hardcoded',
        voiceResponseMode: 'hardcoded' as const,
        voiceTranscriptionEnabled: 'hardcoded' as const,
      },
      userOverrides: { maxMessages: 30 },
    };

    const { resolved, userOverrides } = convertResolveDefaultsResponse(response);

    expect(resolved.maxMessages).toBe(75);
    expect(resolved.maxAge).toBeNull();
    expect(resolved.sources.maxMessages).toBe('admin');
    expect(resolved.sources.maxAge).toBe('hardcoded');
    expect(userOverrides).toEqual({ maxMessages: 30 });
  });

  it('should return null userOverrides when response has null', () => {
    const response: ResolveDefaultsResponse = {
      maxMessages: HARDCODED_CONFIG_DEFAULTS.maxMessages,
      maxAge: HARDCODED_CONFIG_DEFAULTS.maxAge,
      maxImages: HARDCODED_CONFIG_DEFAULTS.maxImages,
      focusModeEnabled: false,
      crossChannelHistoryEnabled: false,
      shareLtmAcrossPersonalities: false,
      memoryScoreThreshold: 0.5,
      memoryLimit: 20,
      showModelFooter: true,
      voiceResponseMode: 'always' as const,
      voiceTranscriptionEnabled: true,
      sources: {
        maxMessages: 'hardcoded',
        maxAge: 'hardcoded',
        maxImages: 'hardcoded',
        focusModeEnabled: 'hardcoded',
        crossChannelHistoryEnabled: 'hardcoded',
        shareLtmAcrossPersonalities: 'hardcoded',
        memoryScoreThreshold: 'hardcoded',
        memoryLimit: 'hardcoded',
        showModelFooter: 'hardcoded',
        voiceResponseMode: 'hardcoded' as const,
        voiceTranscriptionEnabled: 'hardcoded' as const,
      },
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
    expect(result.focusModeEnabled.effectiveValue).toBe(false);
    expect(result.crossChannelHistoryEnabled.effectiveValue).toBe(false);
    expect(result.shareLtmAcrossPersonalities.effectiveValue).toBe(false);
    expect(result.memoryScoreThreshold.effectiveValue).toBe(0.5);
    expect(result.memoryLimit.effectiveValue).toBe(20);
    expect(result.showModelFooter.effectiveValue).toBe(true);
  });

  it('should have null localValue for all fields', () => {
    const result = buildFallbackSettingsData();

    expect(result.maxMessages.localValue).toBeNull();
    expect(result.maxAge.localValue).toBeNull();
    expect(result.maxImages.localValue).toBeNull();
    expect(result.focusModeEnabled.localValue).toBeNull();
    expect(result.crossChannelHistoryEnabled.localValue).toBeNull();
    expect(result.shareLtmAcrossPersonalities.localValue).toBeNull();
    expect(result.memoryScoreThreshold.localValue).toBeNull();
    expect(result.memoryLimit.localValue).toBeNull();
    expect(result.showModelFooter.localValue).toBeNull();
  });
});
