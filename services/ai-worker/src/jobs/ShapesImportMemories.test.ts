/**
 * Tests for ShapesImportMemories
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { importMemories } from './ShapesImportMemories.js';

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
  };
});

// Mock PgvectorMemoryAdapter
const mockMemoryAdapter = {
  addMemory: vi.fn().mockResolvedValue(undefined),
};

// Mock Prisma
const mockPrisma = {
  memory: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  importJob: {
    update: vi.fn().mockResolvedValue({}),
  },
};

describe('importMemories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.memory.findMany.mockResolvedValue([]);
  });

  it('should import all memories when none exist', async () => {
    const memories = [
      { text: 'Memory one', senders: ['user-1'], createdAt: 1700000000000 },
      { text: 'Memory two', senders: ['user-2'], createdAt: 1700001000000 },
    ];

    const result = await importMemories({
      memoryAdapter: mockMemoryAdapter as never,
      prisma: mockPrisma as never,
      memories,
      personalityId: 'pers-id',
      personaId: 'persona-id',
      importJobId: 'job-id',
    });

    expect(result.imported).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(mockMemoryAdapter.addMemory).toHaveBeenCalledTimes(2);
  });

  it('should skip empty/whitespace memories', async () => {
    const memories = [
      { text: '', senders: [], createdAt: 1700000000000 },
      { text: '   ', senders: [], createdAt: 1700001000000 },
      { text: 'Real memory', senders: ['user-1'], createdAt: 1700002000000 },
    ];

    const result = await importMemories({
      memoryAdapter: mockMemoryAdapter as never,
      prisma: mockPrisma as never,
      memories,
      personalityId: 'pers-id',
      personaId: 'persona-id',
      importJobId: 'job-id',
    });

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0); // empty memories are skipped silently, not counted
    expect(mockMemoryAdapter.addMemory).toHaveBeenCalledTimes(1);
  });

  it('should deduplicate against existing memories', async () => {
    mockPrisma.memory.findMany.mockResolvedValue([{ content: 'Existing memory' }]);

    const memories = [
      { text: 'Existing memory', senders: ['user-1'], createdAt: 1700000000000 },
      { text: 'New memory', senders: ['user-2'], createdAt: 1700001000000 },
    ];

    const result = await importMemories({
      memoryAdapter: mockMemoryAdapter as never,
      prisma: mockPrisma as never,
      memories,
      personalityId: 'pers-id',
      personaId: 'persona-id',
      importJobId: 'job-id',
    });

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
    expect(mockMemoryAdapter.addMemory).toHaveBeenCalledTimes(1);
    expect(mockMemoryAdapter.addMemory).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'New memory' })
    );
  });

  it('should count failed memories without aborting', async () => {
    mockMemoryAdapter.addMemory
      .mockRejectedValueOnce(new Error('Embedding failed'))
      .mockResolvedValueOnce(undefined);

    const memories = [
      { text: 'Will fail', senders: ['user-1'], createdAt: 1700000000000 },
      { text: 'Will succeed', senders: ['user-2'], createdAt: 1700001000000 },
    ];

    const result = await importMemories({
      memoryAdapter: mockMemoryAdapter as never,
      prisma: mockPrisma as never,
      memories,
      personalityId: 'pers-id',
      personaId: 'persona-id',
      importJobId: 'job-id',
    });

    expect(result.imported).toBe(1);
    expect(result.failed).toBe(1);
  });

  it('should pass correct metadata to memory adapter', async () => {
    const memories = [
      { text: 'Test memory', senders: ['user-1', 'user-2'], createdAt: 1700000000000 },
    ];

    await importMemories({
      memoryAdapter: mockMemoryAdapter as never,
      prisma: mockPrisma as never,
      memories,
      personalityId: 'pers-id',
      personaId: 'persona-id',
      importJobId: 'job-id',
    });

    expect(mockMemoryAdapter.addMemory).toHaveBeenCalledWith({
      text: 'Test memory',
      metadata: {
        personaId: 'persona-id',
        personalityId: 'pers-id',
        canonScope: 'global',
        createdAt: 1700000000000,
        senders: ['user-1', 'user-2'],
      },
    });
  });

  it('should update progress periodically', async () => {
    // Create 26 memories to trigger one progress update (at imported=25)
    const memories = Array.from({ length: 26 }, (_, i) => ({
      text: `Memory ${i}`,
      senders: ['user-1'],
      createdAt: 1700000000000 + i * 1000,
    }));

    await importMemories({
      memoryAdapter: mockMemoryAdapter as never,
      prisma: mockPrisma as never,
      memories,
      personalityId: 'pers-id',
      personaId: 'persona-id',
      importJobId: 'job-id',
    });

    // Should have one progress update (at imported=25)
    expect(mockPrisma.importJob.update).toHaveBeenCalledTimes(1);
    expect(mockPrisma.importJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-id' },
        data: expect.objectContaining({
          memoriesImported: 25,
        }),
      })
    );
  });

  it('should return zero counts for empty input', async () => {
    const result = await importMemories({
      memoryAdapter: mockMemoryAdapter as never,
      prisma: mockPrisma as never,
      memories: [],
      personalityId: 'pers-id',
      personaId: 'persona-id',
      importJobId: 'job-id',
    });

    expect(result.imported).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
  });
});
