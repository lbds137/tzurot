import { describe, it, expect, vi } from 'vitest';
import { MESSAGE_LIMITS } from '@tzurot/common-types/constants/message';
import type { ConfigResolutionResult } from '@tzurot/common-types/types/configResolution';
import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import type { UserClient } from '@tzurot/clients';
import { resolveChatLlmConfig, buildExtendedContextSettings } from './chatConfigResolution.js';

vi.mock('@tzurot/common-types/utils/logger', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types/utils/logger')>();
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

const personality = { id: 'pers-1', model: 'openai/gpt-4o' } as LoadedPersonality;

function makeUserClient(resolveResult: unknown): UserClient {
  return {
    actor: 'actor-1',
    resolveUserLlmConfig: vi.fn().mockResolvedValue(resolveResult),
  } as unknown as UserClient;
}

describe('resolveChatLlmConfig', () => {
  it('returns the resolved cascade config on success', async () => {
    const data = {
      config: { model: 'resolved-model', maxMessages: 30 },
      source: 'user-default',
      overrides: undefined,
    };
    const userClient = makeUserClient({ ok: true, data });

    const result = await resolveChatLlmConfig(userClient, personality, 'chan-1');

    expect(userClient.resolveUserLlmConfig).toHaveBeenCalledWith({
      personalityId: 'pers-1',
      personalityConfig: personality,
      channelId: 'chan-1',
    });
    expect(result).toEqual(data);
  });

  it('falls back to HARDCODED defaults (no personality-column reads) when resolution fails', async () => {
    const userClient = makeUserClient({ ok: false, error: 'gateway down' });

    const result = await resolveChatLlmConfig(userClient, personality);

    // The fallback sources from defaults, NOT the retired LlmConfig columns.
    expect(result.source).toBe('hardcoded');
    expect(result.config.model).toBe('openai/gpt-4o');
    expect(result.config.maxMessages).toBe(MESSAGE_LIMITS.DEFAULT_MAX_MESSAGES);
    expect(result.config.maxAge).toBeNull();
    expect(result.config.maxImages).toBe(MESSAGE_LIMITS.DEFAULT_MAX_IMAGES);
  });
});

describe('buildExtendedContextSettings', () => {
  it('prefers per-field cascade overrides with their source attribution', () => {
    const resolved = {
      config: { model: 'm' },
      source: 'user-default',
      overrides: {
        maxMessages: 40,
        maxAge: 3600,
        maxImages: 8,
        sources: { maxMessages: 'user-personality', maxAge: 'channel', maxImages: 'admin' },
      },
    } as unknown as ConfigResolutionResult;

    expect(buildExtendedContextSettings(resolved)).toEqual({
      maxMessages: 40,
      maxAge: 3600,
      maxImages: 8,
      sources: { maxMessages: 'user-personality', maxAge: 'channel', maxImages: 'admin' },
    });
  });

  it('falls to config values under a single source label when no overrides present', () => {
    const resolved = {
      config: { model: 'm', maxMessages: 25, maxAge: null, maxImages: 5 },
      source: 'personality',
    } as unknown as ConfigResolutionResult;

    const out = buildExtendedContextSettings(resolved);

    expect(out).toEqual({
      maxMessages: 25,
      maxAge: null,
      maxImages: 5,
      sources: { maxMessages: 'personality', maxAge: 'personality', maxImages: 'personality' },
    });
  });

  it('narrows the TTS-only "free-default" source to "hardcoded" and uses defaults', () => {
    const resolved = {
      config: { model: 'm' },
      source: 'free-default',
    } as unknown as ConfigResolutionResult;

    const out = buildExtendedContextSettings(resolved);

    expect(out.maxMessages).toBe(MESSAGE_LIMITS.DEFAULT_MAX_MESSAGES);
    expect(out.maxImages).toBe(MESSAGE_LIMITS.DEFAULT_MAX_IMAGES);
    expect(out.sources).toEqual({
      maxMessages: 'hardcoded',
      maxAge: 'hardcoded',
      maxImages: 'hardcoded',
    });
  });
});
