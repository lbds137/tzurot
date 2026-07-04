/**
 * Tests for resolveRagVisionAuth — the RAG-path cross-provider vision-auth helper.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { resolveRagVisionAuth } from './ragVisionAuth.js';
import type { ApiKeyResolver } from '../ApiKeyResolver.js';

const { mockResolveVisionConfig } = vi.hoisted(() => ({
  mockResolveVisionConfig: vi.fn(),
}));

vi.mock('./visionAuthResolver.js', () => ({
  resolveVisionConfig: mockResolveVisionConfig,
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

const PERSONALITY = {
  id: 'p1',
  name: 'Bot',
  model: 'z-ai/glm-5.2',
} as unknown as LoadedPersonality;
// A non-null sentinel — resolveVisionConfig is mocked, so the resolver is never actually invoked.
const RESOLVER = {} as unknown as ApiKeyResolver;

describe('resolveRagVisionAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the resolved vision key/provider/model on a resolved config', async () => {
    mockResolveVisionConfig.mockResolvedValue({
      kind: 'resolved',
      config: {
        apiKey: 'vision-key',
        provider: AIProvider.OpenRouter,
        model: 'google/gemma-4-31b-it',
        source: 'user',
        isGuestMode: false,
      },
    });

    const result = await resolveRagVisionAuth({
      personality: PERSONALITY,
      userId: 'user-1',
      isGuestMode: false,
      mainApiKey: 'main-z.ai-key',
      mainProvider: AIProvider.ZaiCoding,
      apiKeyResolver: RESOLVER,
    });

    expect(result).toEqual({
      userApiKey: 'vision-key',
      visionProvider: AIProvider.OpenRouter,
      model: 'google/gemma-4-31b-it',
    });
    expect(mockResolveVisionConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        personality: PERSONALITY,
        mainProvider: AIProvider.ZaiCoding,
        mainApiKey: 'main-z.ai-key',
        userId: 'user-1',
        isGuestMode: false,
      })
    );
  });

  it('degrades to the main key when the resolver fail-fasts', async () => {
    mockResolveVisionConfig.mockResolvedValue({
      kind: 'failFast',
      provider: AIProvider.OpenRouter,
    });

    const result = await resolveRagVisionAuth({
      personality: PERSONALITY,
      userId: 'user-1',
      isGuestMode: false,
      mainApiKey: 'main-key',
      mainProvider: AIProvider.ZaiCoding,
      apiKeyResolver: RESOLVER,
    });

    expect(result).toEqual({ userApiKey: 'main-key' });
  });

  it('degrades to the main key when the resolver throws', async () => {
    mockResolveVisionConfig.mockRejectedValue(new Error('redis blip'));

    const result = await resolveRagVisionAuth({
      personality: PERSONALITY,
      userId: 'user-1',
      isGuestMode: false,
      mainApiKey: 'main-key',
      mainProvider: AIProvider.ZaiCoding,
      apiKeyResolver: RESOLVER,
    });

    expect(result).toEqual({ userApiKey: 'main-key' });
  });

  it('skips resolution and returns the main key when no apiKeyResolver is wired', async () => {
    const result = await resolveRagVisionAuth({
      personality: PERSONALITY,
      userId: 'user-1',
      isGuestMode: false,
      mainApiKey: 'main-key',
      mainProvider: AIProvider.ZaiCoding,
      // apiKeyResolver omitted
    });

    expect(result).toEqual({ userApiKey: 'main-key' });
    expect(mockResolveVisionConfig).not.toHaveBeenCalled();
  });

  it('skips resolution when there is no upstream main provider', async () => {
    const result = await resolveRagVisionAuth({
      personality: PERSONALITY,
      userId: 'user-1',
      isGuestMode: false,
      mainApiKey: 'main-key',
      mainProvider: undefined,
      apiKeyResolver: RESOLVER,
    });

    expect(result).toEqual({ userApiKey: 'main-key' });
    expect(mockResolveVisionConfig).not.toHaveBeenCalled();
  });
});
