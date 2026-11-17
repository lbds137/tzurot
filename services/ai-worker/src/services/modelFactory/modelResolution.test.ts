/**
 * Tests for resolveModelName and resolveProvider: the model-name and provider
 * resolutions the factory, the cache key and the invocation log share.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  registerSystemSettings,
  resetSystemSettingsRegistration,
  type SystemSettingsService,
} from '@tzurot/common-types/services/SystemSettingsService';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { resolveModelName, resolveProvider } from './modelResolution.js';

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: { AI_PROVIDER: 'openrouter' as string },
}));

vi.mock('@tzurot/common-types/config/config', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/config/config')>(
    '@tzurot/common-types/config/config'
  );
  return { ...actual, getConfig: () => mockConfig };
});

function registerFallback(value: string): void {
  registerSystemSettings({
    get: (key: string) => (key === 'fallbackTextModel' ? value : undefined),
  } as unknown as SystemSettingsService);
}

describe('resolveModelName', () => {
  afterEach(() => {
    resetSystemSettingsRegistration();
  });

  it('returns a non-empty requested id unchanged, without consulting the fallback', () => {
    registerFallback('fallback/should-not-win');

    expect(resolveModelName('anthropic/claude-sonnet-4')).toBe('anthropic/claude-sonnet-4');
  });

  it('returns the fallbackTextModel setting for an empty-string id', () => {
    registerFallback('anthropic/fallback-model');

    expect(resolveModelName('')).toBe('anthropic/fallback-model');
  });

  it('returns the fallbackTextModel setting for an undefined id', () => {
    registerFallback('anthropic/fallback-model');

    expect(resolveModelName(undefined)).toBe('anthropic/fallback-model');
  });
});

describe('resolveProvider', () => {
  afterEach(() => {
    mockConfig.AI_PROVIDER = 'openrouter';
  });

  it('returns a set provider unchanged, without consulting the config default', () => {
    mockConfig.AI_PROVIDER = 'openrouter';

    expect(resolveProvider(AIProvider.ZaiCoding)).toBe(AIProvider.ZaiCoding);
  });

  it('returns the env-level AI_PROVIDER default for an undefined provider', () => {
    mockConfig.AI_PROVIDER = 'zai-coding';

    expect(resolveProvider(undefined)).toBe(AIProvider.ZaiCoding);
  });
});
