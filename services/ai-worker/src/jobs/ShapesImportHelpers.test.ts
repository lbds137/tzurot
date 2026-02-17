/**
 * Tests for ShapesImportHelpers
 *
 * Direct unit tests for createFullPersonality and downloadAndStoreAvatar,
 * extracted from ShapesImportJob.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ShapesIncPersonalityConfig } from '@tzurot/common-types';
import { createFullPersonality, downloadAndStoreAvatar } from './ShapesImportHelpers.js';

// Mock common-types
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    SHAPES_USER_AGENT: 'test-user-agent',
  };
});

// Mock PersonalityMapper - use vi.hoisted to avoid TDZ (vi.mock is hoisted above module scope)
const { mockMapResult } = vi.hoisted(() => ({
  mockMapResult: {
    systemPrompt: { id: 'sp-id', name: 'sp-name', content: 'system prompt content' },
    personality: {
      id: 'pers-id',
      name: 'Test Shape',
      slug: 'test-shape',
      displayName: 'Test Shape',
      characterInfo: 'character info',
      personalityTraits: 'traits',
      personalityTone: null,
      personalityAge: null,
      personalityAppearance: null,
      personalityLikes: null,
      personalityDislikes: null,
      conversationalGoals: null,
      conversationalExamples: null,
      errorMessage: null,
      isPublic: false,
      voiceEnabled: false,
      imageEnabled: false,
      birthMonth: null,
      birthDay: null,
      birthYear: null,
      customFields: { importSource: 'shapes_inc' },
    },
    llmConfig: {
      id: 'llm-id',
      name: 'llm-name',
      description: 'desc',
      model: 'openai/gpt-4o',
      provider: 'openrouter',
      advancedParameters: { temperature: 0.8 },
      memoryScoreThreshold: 0.3,
      memoryLimit: 5,
      contextWindowTokens: 128000,
      maxMessages: 20,
    },
  },
}));

vi.mock('../services/shapes/ShapesPersonalityMapper.js', () => ({
  mapShapesConfigToPersonality: vi.fn().mockReturnValue(mockMapResult),
}));

// Mock Prisma
function createMockPrisma() {
  return {
    systemPrompt: { upsert: vi.fn().mockResolvedValue({}) },
    personality: {
      upsert: vi.fn().mockResolvedValue({ id: 'pers-id', slug: 'test-shape' }),
      update: vi.fn().mockResolvedValue({}),
    },
    llmConfig: { upsert: vi.fn().mockResolvedValue({}) },
    personalityDefaultConfig: { upsert: vi.fn().mockResolvedValue({}) },
    personalityOwner: { upsert: vi.fn().mockResolvedValue({}) },
  };
}

const MOCK_CONFIG = {
  id: 'shape-uuid',
  name: 'Test Shape',
  username: 'test-shape',
  avatar: 'https://example.com/avatar.png',
  jailbreak: 'system prompt',
  user_prompt: 'char info',
  personality_traits: 'traits',
} as unknown as ShapesIncPersonalityConfig;

describe('createFullPersonality', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = createMockPrisma();
  });

  it('should upsert system prompt, personality, llm config, default config, and owner', async () => {
    const result = await createFullPersonality(
      mockPrisma as never,
      MOCK_CONFIG,
      'test-shape',
      'owner-id'
    );

    expect(result).toEqual({ personalityId: 'pers-id', slug: 'test-shape' });
    expect(mockPrisma.systemPrompt.upsert).toHaveBeenCalledTimes(1);
    expect(mockPrisma.personality.upsert).toHaveBeenCalledTimes(1);
    expect(mockPrisma.llmConfig.upsert).toHaveBeenCalledTimes(1);
    expect(mockPrisma.personalityDefaultConfig.upsert).toHaveBeenCalledTimes(1);
    expect(mockPrisma.personalityOwner.upsert).toHaveBeenCalledTimes(1);
  });

  it('should pass ownerId to personality and llmConfig', async () => {
    await createFullPersonality(mockPrisma as never, MOCK_CONFIG, 'test-shape', 'owner-42');

    expect(mockPrisma.personality.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ ownerId: 'owner-42' }),
      })
    );
    expect(mockPrisma.llmConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ ownerId: 'owner-42' }),
      })
    );
  });

  it('should link personality to llm config via personalityDefaultConfig', async () => {
    await createFullPersonality(mockPrisma as never, MOCK_CONFIG, 'test-shape', 'owner-id');

    expect(mockPrisma.personalityDefaultConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { personalityId: 'pers-id' },
        create: { personalityId: 'pers-id', llmConfigId: 'llm-id' },
        update: { llmConfigId: 'llm-id' },
      })
    );
  });

  it('should create PersonalityOwner entry for importing user', async () => {
    await createFullPersonality(mockPrisma as never, MOCK_CONFIG, 'test-shape', 'owner-42');

    expect(mockPrisma.personalityOwner.upsert).toHaveBeenCalledWith({
      where: {
        personalityId_userId: {
          personalityId: 'pers-id',
          userId: 'owner-42',
        },
      },
      create: {
        personalityId: 'pers-id',
        userId: 'owner-42',
        role: 'owner',
      },
      update: {},
    });
  });

  it('should serialize customFields as JSON for personality upsert', async () => {
    await createFullPersonality(mockPrisma as never, MOCK_CONFIG, 'test-shape', 'owner-id');

    const upsertCall = mockPrisma.personality.upsert.mock.calls[0][0];
    expect(upsertCall.create.customFields).toEqual({ importSource: 'shapes_inc' });
    expect(upsertCall.update.customFields).toEqual({ importSource: 'shapes_inc' });
  });

  it('should serialize advancedParameters as JSON for llmConfig upsert', async () => {
    await createFullPersonality(mockPrisma as never, MOCK_CONFIG, 'test-shape', 'owner-id');

    const upsertCall = mockPrisma.llmConfig.upsert.mock.calls[0][0];
    expect(upsertCall.create.advancedParameters).toEqual({ temperature: 0.8 });
    expect(upsertCall.update.advancedParameters).toEqual({ temperature: 0.8 });
  });
});

describe('downloadAndStoreAvatar', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = createMockPrisma();
  });

  it('should fetch avatar and store in personality record', async () => {
    const imageData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(imageData.buffer),
      })
    );

    await downloadAndStoreAvatar(mockPrisma as never, 'pers-id', 'https://example.com/avatar.png');

    expect(fetch).toHaveBeenCalledWith('https://example.com/avatar.png', {
      headers: { 'User-Agent': 'test-user-agent' },
      signal: expect.any(AbortSignal),
    });
    expect(mockPrisma.personality.update).toHaveBeenCalledWith({
      where: { id: 'pers-id' },
      data: { avatarData: expect.any(Buffer) },
    });
  });

  it('should skip if HTTP response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    await downloadAndStoreAvatar(mockPrisma as never, 'pers-id', 'https://example.com/missing.png');

    expect(mockPrisma.personality.update).not.toHaveBeenCalled();
  });

  it('should skip if avatar exceeds 10MB size limit', async () => {
    const hugeData = new Uint8Array(11 * 1024 * 1024); // 11MB
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(hugeData.buffer),
      })
    );

    await downloadAndStoreAvatar(mockPrisma as never, 'pers-id', 'https://example.com/huge.png');

    expect(mockPrisma.personality.update).not.toHaveBeenCalled();
  });

  it('should not throw on fetch errors (non-fatal)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    // Should not throw
    await downloadAndStoreAvatar(mockPrisma as never, 'pers-id', 'https://example.com/avatar.png');

    expect(mockPrisma.personality.update).not.toHaveBeenCalled();
  });

  it('should pass AbortSignal to fetch for timeout protection', async () => {
    const imageData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(imageData.buffer),
      })
    );

    await downloadAndStoreAvatar(mockPrisma as never, 'pers-id', 'https://example.com/avatar.png');

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const fetchOptions = fetchCall[1] as RequestInit;
    expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);
  });

  it('should handle abort timeout gracefully', async () => {
    vi.useFakeTimers();

    // Simulate a fetch that never resolves
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, opts: RequestInit) =>
          new Promise((_resolve, reject) => {
            opts.signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          })
      )
    );

    const promise = downloadAndStoreAvatar(
      mockPrisma as never,
      'pers-id',
      'https://example.com/slow-avatar.png'
    );

    await vi.advanceTimersByTimeAsync(30_000);
    await promise;

    expect(mockPrisma.personality.update).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
