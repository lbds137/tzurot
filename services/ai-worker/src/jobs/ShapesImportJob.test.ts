/**
 * Tests for ShapesImportJob
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { ShapesImportJobData } from '@tzurot/common-types';
import { processShapesImportJob } from './ShapesImportJob.js';

// Mock common-types
const { mockNormalizeSlugForUser, mockIsBotOwner } = vi.hoisted(() => ({
  mockNormalizeSlugForUser: vi.fn((slug: string) => slug),
  mockIsBotOwner: vi.fn().mockReturnValue(false),
}));
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
    normalizeSlugForUser: mockNormalizeSlugForUser,
    isBotOwner: mockIsBotOwner,
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
  ShapesRateLimitError: class ShapesRateLimitError extends Error {
    constructor() {
      super('Rate limited by shapes.inc');
      this.name = 'ShapesRateLimitError';
    }
  },
  ShapesServerError: class ShapesServerError extends Error {
    readonly status: number;
    constructor(status: number, msg: string) {
      super(msg);
      this.name = 'ShapesServerError';
      this.status = status;
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
    findFirst: vi.fn().mockResolvedValue(null),
  },
  llmConfig: {
    upsert: vi.fn().mockResolvedValue({}),
  },
  personalityDefaultConfig: {
    upsert: vi.fn().mockResolvedValue({}),
  },
  personalityOwner: {
    upsert: vi.fn().mockResolvedValue({}),
  },
  user: {
    findUnique: vi.fn().mockResolvedValue({
      username: 'testuser',
      discordId: 'discord-123',
      defaultPersonaId: 'default-persona-id',
    }),
  },
  memory: {
    count: vi.fn().mockResolvedValue(0),
    findMany: vi.fn().mockResolvedValue([]),
  },
};

// Mock MemoryAdapter
const mockMemoryAdapter = {
  addMemory: vi.fn().mockResolvedValue(undefined),
};

function createMockJob(
  overrides: Partial<ShapesImportJobData> = {},
  jobOpts: { attemptsMade?: number; attempts?: number } = {}
): Job<ShapesImportJobData> {
  return {
    id: 'test-job-id',
    attemptsMade: jobOpts.attemptsMade ?? 0,
    opts: { attempts: jobOpts.attempts ?? 3 },
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
          summary_type: 'automatic',
          deleted: false,
          metadata: {
            start_ts: 1700000000,
            end_ts: 1700001000,
            created_at: 1700001000,
            senders: ['user-1'],
            discord_channel_id: '123456',
            discord_guild_id: '789012',
            msg_ids: ['msg-1', 'msg-2'],
          },
        },
      ],
      stories: [],
      userPersonalization: null,
      stats: { memoriesCount: 1, storiesCount: 0, pagesTraversed: 1 },
    });

    // Default: user with username and default persona
    mockPrisma.user.findUnique.mockResolvedValue({
      username: 'testuser',
      discordId: 'discord-123',
      defaultPersonaId: 'default-persona-id',
    });

    // Default: slug passthrough (no suffix)
    mockNormalizeSlugForUser.mockImplementation((slug: string) => slug);

    // Default: no existing personality (ownership check passes)
    mockPrisma.personality.findFirst.mockResolvedValue(null);

    // Default: no existing memories (fresh import)
    mockPrisma.memory.count.mockResolvedValue(0);
    mockPrisma.memory.findMany.mockResolvedValue([]);
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

  it('should resolve personality by slug for memory_only import', async () => {
    mockPrisma.personality.findFirst.mockResolvedValue({
      id: 'found-pers-id',
      slug: 'test-shape',
    });

    const job = createMockJob({ importType: 'memory_only' });
    const result = await processShapesImportJob(job, {
      prisma: mockPrisma as never,
      memoryAdapter: mockMemoryAdapter as never,
    });

    expect(result.success).toBe(true);
    expect(result.personalityId).toBe('found-pers-id');
    expect(mockPrisma.personality.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.personality.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: 'test-shape' } })
    );
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

  it('should skip all memories if personality already has identical content', async () => {
    mockPrisma.memory.findMany.mockResolvedValue([{ content: 'Test memory content' }]);

    const job = createMockJob();
    const result = await processShapesImportJob(job, {
      prisma: mockPrisma as never,
      memoryAdapter: mockMemoryAdapter as never,
    });

    expect(result.success).toBe(true);
    expect(result.memoriesImported).toBe(0);
    expect(mockMemoryAdapter.addMemory).not.toHaveBeenCalled();
  });

  it('should import only new memories on partial re-import', async () => {
    // Simulate: first memory already exists, second is new
    mockPrisma.memory.findMany.mockResolvedValue([{ content: 'Test memory content' }]);

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
        {
          id: 'mem-2',
          shape_id: 'shape-uuid',
          senders: ['user-2'],
          result: 'New memory from retry',
          metadata: {
            start_ts: 1700002000,
            end_ts: 1700003000,
            created_at: 1700003000,
            senders: ['user-2'],
          },
        },
      ],
      stories: [],
      userPersonalization: null,
      stats: { memoriesCount: 2, storiesCount: 0, pagesTraversed: 1 },
    });

    const job = createMockJob();
    const result = await processShapesImportJob(job, {
      prisma: mockPrisma as never,
      memoryAdapter: mockMemoryAdapter as never,
    });

    expect(result.success).toBe(true);
    expect(result.memoriesImported).toBe(1);
    expect(mockMemoryAdapter.addMemory).toHaveBeenCalledTimes(1);
    expect(mockMemoryAdapter.addMemory).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'New memory from retry' })
    );
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

  it('should re-throw server errors for BullMQ retry when attempts remain', async () => {
    const { ShapesServerError } = await import('../services/shapes/ShapesDataFetcher.js');
    mockFetchShapeData.mockRejectedValueOnce(new ShapesServerError(502, 'Bad Gateway'));

    const job = createMockJob({}, { attemptsMade: 0, attempts: 3 });
    await expect(
      processShapesImportJob(job, {
        prisma: mockPrisma as never,
        memoryAdapter: mockMemoryAdapter as never,
      })
    ).rejects.toThrow('Bad Gateway');

    // Should mark in_progress but NOT failed
    const updateCalls = mockPrisma.importJob.update.mock.calls;
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0][0].data.status).toBe('in_progress');
  });

  it('should re-throw rate-limit errors for BullMQ retry when attempts remain', async () => {
    const { ShapesRateLimitError } = await import('../services/shapes/ShapesDataFetcher.js');
    mockFetchShapeData.mockRejectedValueOnce(new ShapesRateLimitError());

    const job = createMockJob({}, { attemptsMade: 0, attempts: 3 });
    await expect(
      processShapesImportJob(job, {
        prisma: mockPrisma as never,
        memoryAdapter: mockMemoryAdapter as never,
      })
    ).rejects.toThrow('Rate limited');

    // Should mark in_progress but NOT failed
    const updateCalls = mockPrisma.importJob.update.mock.calls;
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0][0].data.status).toBe('in_progress');
  });

  it('should mark as failed on final server error attempt', async () => {
    const { ShapesServerError } = await import('../services/shapes/ShapesDataFetcher.js');
    mockFetchShapeData.mockRejectedValueOnce(new ShapesServerError(504, 'Gateway Timeout'));

    const job = createMockJob({}, { attemptsMade: 2, attempts: 3 });
    const result = await processShapesImportJob(job, {
      prisma: mockPrisma as never,
      memoryAdapter: mockMemoryAdapter as never,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Gateway Timeout');

    const updateCalls = mockPrisma.importJob.update.mock.calls;
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[0][0].data.status).toBe('in_progress');
    expect(updateCalls[1][0].data.status).toBe('failed');
  });

  it('should include memoriesSkipped in result', async () => {
    // Simulate one existing memory that will be skipped
    mockPrisma.memory.findMany.mockResolvedValue([{ content: 'Test memory content' }]);

    const job = createMockJob();
    const result = await processShapesImportJob(job, {
      prisma: mockPrisma as never,
      memoryAdapter: mockMemoryAdapter as never,
    });

    expect(result.success).toBe(true);
    expect(result.memoriesSkipped).toBe(1);
    expect(result.memoriesImported).toBe(0);
  });

  it('should fail when user not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const job = createMockJob();
    const result = await processShapesImportJob(job, {
      prisma: mockPrisma as never,
      memoryAdapter: mockMemoryAdapter as never,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('user not found');
  });

  it('should fail when user has no default persona', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      username: 'testuser',
      discordId: 'discord-123',
      defaultPersonaId: null,
    });

    const job = createMockJob();
    const result = await processShapesImportJob(job, {
      prisma: mockPrisma as never,
      memoryAdapter: mockMemoryAdapter as never,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('no default persona');
  });

  it('should reject full import when personality owned by another user', async () => {
    // Existing personality owned by someone else
    mockPrisma.personality.findFirst.mockResolvedValue({
      id: 'existing-pers-id',
      ownerId: 'other-user-uuid',
    });
    mockIsBotOwner.mockReturnValue(false);

    const job = createMockJob({ importType: 'full' });
    const result = await processShapesImportJob(job, {
      prisma: mockPrisma as never,
      memoryAdapter: mockMemoryAdapter as never,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('owned by another user');
  });
});
