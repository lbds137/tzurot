/**
 * Tests for ShapesImportJob
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { ShapesImportJobData } from '@tzurot/common-types';
import { processShapesImportJob } from './ShapesImportJob.js';

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
    decryptApiKey: vi.fn().mockReturnValue('appSession.0=abc; appSession.1=def'),
    encryptApiKey: vi
      .fn()
      .mockReturnValue({ iv: 'new-iv', content: 'new-content', tag: 'new-tag' }),
  };
});

// Mock ShapesDataFetcher - use vi.hoisted to ensure mock fns exist before vi.mock hoisting
const { mockFetchShapeData, mockGetUpdatedCookie } = vi.hoisted(() => ({
  mockFetchShapeData: vi.fn(),
  mockGetUpdatedCookie: vi.fn().mockReturnValue('updated-cookie'),
}));
vi.mock('../services/shapes/ShapesDataFetcher.js', () => ({
  ShapesDataFetcher: vi.fn().mockImplementation(function () {
    return { fetchShapeData: mockFetchShapeData, getUpdatedCookie: mockGetUpdatedCookie };
  }),
  ShapesAuthError: class ShapesAuthError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = 'ShapesAuthError';
    }
  },
  ShapesNotFoundError: class ShapesNotFoundError extends Error {
    constructor(slug: string) {
      super(`Shape not found: ${slug}`);
      this.name = 'ShapesNotFoundError';
    }
  },
}));

// Mock PersonalityMapper
vi.mock('../services/shapes/ShapesPersonalityMapper.js', () => ({
  mapShapesConfigToPersonality: vi.fn().mockReturnValue({
    systemPrompt: { id: 'sp-id', name: 'sp-name', content: 'content' },
    personality: {
      id: 'pers-id',
      name: 'Test Shape',
      slug: 'test-shape',
      displayName: 'Test Shape',
      characterInfo: 'info',
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
      customFields: { importSource: 'shapes_inc' },
    },
    llmConfig: {
      id: 'llm-id',
      name: 'llm-name',
      description: 'desc',
      model: 'openai/gpt-4o',
      provider: 'openrouter',
      advancedParameters: {},
      memoryScoreThreshold: 0.3,
      memoryLimit: 5,
      contextWindowTokens: 128000,
      maxMessages: 20,
    },
  }),
}));

// Mock Prisma
const mockPrisma = {
  userCredential: {
    findFirst: vi.fn().mockResolvedValue({
      iv: 'iv',
      content: 'content',
      tag: 'tag',
    }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  importJob: {
    update: vi.fn().mockResolvedValue({}),
  },
  systemPrompt: {
    upsert: vi.fn().mockResolvedValue({}),
  },
  personality: {
    upsert: vi.fn().mockResolvedValue({ id: 'pers-id', slug: 'test-shape' }),
  },
  llmConfig: {
    upsert: vi.fn().mockResolvedValue({}),
  },
  personalityDefaultConfig: {
    upsert: vi.fn().mockResolvedValue({}),
  },
  memory: {
    count: vi.fn().mockResolvedValue(0),
  },
};

// Mock MemoryAdapter
const mockMemoryAdapter = {
  addMemory: vi.fn().mockResolvedValue(undefined),
};

function createMockJob(overrides: Partial<ShapesImportJobData> = {}): Job<ShapesImportJobData> {
  return {
    id: 'test-job-id',
    data: {
      userId: 'user-uuid-123',
      discordUserId: 'discord-123',
      sourceSlug: 'test-shape',
      importJobId: 'import-job-123',
      importType: 'full',
      ...overrides,
    },
  } as unknown as Job<ShapesImportJobData>;
}

describe('processShapesImportJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: successful fetch
    mockFetchShapeData.mockResolvedValue({
      config: {
        id: 'shape-uuid',
        name: 'Test Shape',
        username: 'test-shape',
        avatar: '',
        jailbreak: 'system prompt',
        user_prompt: 'char info',
        personality_traits: 'traits',
        engine_model: 'openai/gpt-4o',
        engine_temperature: 0.8,
        stm_window: 10,
        ltm_enabled: true,
        ltm_threshold: 0.3,
        ltm_max_retrieved_summaries: 5,
      },
      memories: [
        {
          id: 'mem-1',
          shape_id: 'shape-uuid',
          senders: ['user-1'],
          result: 'Test memory content',
          metadata: {
            start_ts: 1700000000,
            end_ts: 1700001000,
            created_at: 1700001000,
            senders: ['user-1'],
          },
        },
      ],
      stories: [],
      userPersonalization: null,
      stats: { memoriesCount: 1, storiesCount: 0, pagesTraversed: 1 },
    });

    // Default: no existing memories (fresh import)
    mockPrisma.memory.count.mockResolvedValue(0);
  });

  it('should update import job to in_progress', async () => {
    const job = createMockJob();
    await processShapesImportJob(job, {
      prisma: mockPrisma as never,
      memoryAdapter: mockMemoryAdapter as never,
    });

    expect(mockPrisma.importJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'import-job-123' },
        data: expect.objectContaining({ status: 'in_progress' }),
      })
    );
  });

  it('should decrypt session cookie', async () => {
    const job = createMockJob();
    await processShapesImportJob(job, {
      prisma: mockPrisma as never,
      memoryAdapter: mockMemoryAdapter as never,
    });

    expect(mockPrisma.userCredential.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-uuid-123',
          service: 'shapes_inc',
          credentialType: 'session_cookie',
        }),
      })
    );
  });

  it('should create personality with mapped data on full import', async () => {
    const job = createMockJob({ importType: 'full' });
    await processShapesImportJob(job, {
      prisma: mockPrisma as never,
      memoryAdapter: mockMemoryAdapter as never,
    });

    expect(mockPrisma.systemPrompt.upsert).toHaveBeenCalled();
    expect(mockPrisma.personality.upsert).toHaveBeenCalled();
    expect(mockPrisma.llmConfig.upsert).toHaveBeenCalled();
    expect(mockPrisma.personalityDefaultConfig.upsert).toHaveBeenCalled();
  });

  it('should import memories via memory adapter', async () => {
    const job = createMockJob();
    const result = await processShapesImportJob(job, {
      prisma: mockPrisma as never,
      memoryAdapter: mockMemoryAdapter as never,
    });

    expect(mockMemoryAdapter.addMemory).toHaveBeenCalledTimes(1);
    expect(result.memoriesImported).toBe(1);
    expect(result.memoriesFailed).toBe(0);
  });

  it('should mark import as completed on success', async () => {
    const job = createMockJob();
    const result = await processShapesImportJob(job, {
      prisma: mockPrisma as never,
      memoryAdapter: mockMemoryAdapter as never,
    });

    expect(result.success).toBe(true);
    expect(mockPrisma.importJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'completed' }),
      })
    );
  });

  it('should handle memory_only import without creating personality', async () => {
    const job = createMockJob({
      importType: 'memory_only',
      existingPersonalityId: 'existing-pers-id',
    });
    const result = await processShapesImportJob(job, {
      prisma: mockPrisma as never,
      memoryAdapter: mockMemoryAdapter as never,
    });

    expect(result.success).toBe(true);
    expect(result.importType).toBe('memory_only');
    // Should NOT create personality
    expect(mockPrisma.personality.upsert).not.toHaveBeenCalled();
  });

  it('should mark import as failed on error', async () => {
    mockFetchShapeData.mockRejectedValue(new Error('Network error'));

    const job = createMockJob();
    const result = await processShapesImportJob(job, {
      prisma: mockPrisma as never,
      memoryAdapter: mockMemoryAdapter as never,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Network error');
    expect(mockPrisma.importJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed' }),
      })
    );
  });

  it('should skip memory import if personality already has memories', async () => {
    mockPrisma.memory.count.mockResolvedValue(50);

    const job = createMockJob();
    const result = await processShapesImportJob(job, {
      prisma: mockPrisma as never,
      memoryAdapter: mockMemoryAdapter as never,
    });

    expect(result.success).toBe(true);
    expect(result.memoriesImported).toBe(0);
    expect(mockMemoryAdapter.addMemory).not.toHaveBeenCalled();
  });

  it('should count failed memories without failing the job', async () => {
    mockMemoryAdapter.addMemory.mockRejectedValueOnce(new Error('Embedding failed'));

    const job = createMockJob();
    const result = await processShapesImportJob(job, {
      prisma: mockPrisma as never,
      memoryAdapter: mockMemoryAdapter as never,
    });

    expect(result.success).toBe(true);
    expect(result.memoriesImported).toBe(0);
    expect(result.memoriesFailed).toBe(1);
  });
});
