/**
 * Tests for ShapesImportResolver
 *
 * Validates multi-strategy personality resolution for memory_only imports
 * and ownership guard for full imports.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolvePersonality, type ResolvePersonalityOpts } from './ShapesImportResolver.js';

const { mockIsBotOwner } = vi.hoisted(() => ({
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
    isBotOwner: mockIsBotOwner,
  };
});

const mockCreateFullPersonality = vi.fn().mockResolvedValue({
  personalityId: 'created-pers-id',
  slug: 'test-shape',
});
vi.mock('./ShapesImportHelpers.js', () => ({
  createFullPersonality: (...args: unknown[]) => mockCreateFullPersonality(...args),
}));

const mockPrisma = {
  personality: {
    findFirst: vi.fn().mockResolvedValue(null),
  },
};

const baseConfig = {
  id: 'shapes-uuid-123',
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
};

function createOpts(overrides: Partial<ResolvePersonalityOpts> = {}): ResolvePersonalityOpts {
  return {
    prisma: mockPrisma as never,
    config: baseConfig,
    sourceSlug: 'test-shape-user123',
    rawSourceSlug: 'test-shape',
    shapesId: 'shapes-uuid-123',
    internalUserId: 'user-uuid-123',
    discordUserId: 'discord-123',
    importType: 'full',
    ...overrides,
  };
}

describe('resolvePersonality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.personality.findFirst.mockResolvedValue(null);
  });

  describe('full import', () => {
    it('should create personality when no existing one found', async () => {
      const result = await resolvePersonality(createOpts());

      expect(mockCreateFullPersonality).toHaveBeenCalledWith(
        mockPrisma,
        baseConfig,
        'test-shape-user123',
        'user-uuid-123'
      );
      expect(result.personalityId).toBe('created-pers-id');
    });

    it('should reject when personality owned by another user', async () => {
      mockPrisma.personality.findFirst.mockResolvedValue({
        id: 'existing-id',
        ownerId: 'other-user-uuid',
      });

      await expect(resolvePersonality(createOpts())).rejects.toThrow('owned by another user');
    });

    it('should allow bot owner to overwrite any personality', async () => {
      mockPrisma.personality.findFirst.mockResolvedValue({
        id: 'existing-id',
        ownerId: 'other-user-uuid',
      });
      mockIsBotOwner.mockReturnValue(true);

      const result = await resolvePersonality(createOpts());
      expect(result.personalityId).toBe('created-pers-id');
    });

    it('should allow owner to reimport their own personality', async () => {
      mockPrisma.personality.findFirst.mockResolvedValue({
        id: 'existing-id',
        ownerId: 'user-uuid-123',
      });

      const result = await resolvePersonality(createOpts());
      expect(result.personalityId).toBe('created-pers-id');
    });
  });

  describe('memory_only import', () => {
    it('should resolve by normalized slug (strategy 1)', async () => {
      mockPrisma.personality.findFirst.mockResolvedValueOnce({
        id: 'pers-by-normalized',
        slug: 'test-shape-user123',
      });

      const result = await resolvePersonality(createOpts({ importType: 'memory_only' }));

      expect(result.personalityId).toBe('pers-by-normalized');
      expect(mockPrisma.personality.findFirst).toHaveBeenCalledTimes(1);
      expect(mockPrisma.personality.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { slug: 'test-shape-user123' } })
      );
    });

    it('should fall back to raw slug (strategy 2) when normalized not found', async () => {
      // Strategy 1: not found
      mockPrisma.personality.findFirst.mockResolvedValueOnce(null);
      // Strategy 2: found
      mockPrisma.personality.findFirst.mockResolvedValueOnce({
        id: 'pers-by-raw',
        slug: 'test-shape',
      });

      const result = await resolvePersonality(createOpts({ importType: 'memory_only' }));

      expect(result.personalityId).toBe('pers-by-raw');
      expect(mockPrisma.personality.findFirst).toHaveBeenCalledTimes(2);
      expect(mockPrisma.personality.findFirst).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ where: { slug: 'test-shape' } })
      );
    });

    it('should skip raw slug strategy when raw === normalized', async () => {
      // Same slugs (bot owner case)
      mockPrisma.personality.findFirst.mockResolvedValueOnce(null);
      // Strategy 3: found
      mockPrisma.personality.findFirst.mockResolvedValueOnce({
        id: 'pers-by-shapesid',
        slug: 'test-shape',
      });

      const result = await resolvePersonality(
        createOpts({
          importType: 'memory_only',
          sourceSlug: 'test-shape',
          rawSourceSlug: 'test-shape',
        })
      );

      expect(result.personalityId).toBe('pers-by-shapesid');
      // Should skip strategy 2 (raw === normalized), go straight to strategy 3
      expect(mockPrisma.personality.findFirst).toHaveBeenCalledTimes(2);
      expect(mockPrisma.personality.findFirst).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: { customFields: { path: ['shapesId'], equals: 'shapes-uuid-123' } },
        })
      );
    });

    it('should fall back to shapesId (strategy 3) when slug strategies fail', async () => {
      // Strategy 1: not found
      mockPrisma.personality.findFirst.mockResolvedValueOnce(null);
      // Strategy 2: not found
      mockPrisma.personality.findFirst.mockResolvedValueOnce(null);
      // Strategy 3: found
      mockPrisma.personality.findFirst.mockResolvedValueOnce({
        id: 'pers-by-shapesid',
        slug: 'some-other-slug',
      });

      const result = await resolvePersonality(createOpts({ importType: 'memory_only' }));

      expect(result.personalityId).toBe('pers-by-shapesid');
      expect(mockPrisma.personality.findFirst).toHaveBeenCalledTimes(3);
      expect(mockPrisma.personality.findFirst).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          where: { customFields: { path: ['shapesId'], equals: 'shapes-uuid-123' } },
        })
      );
    });

    it('should throw with all attempted values when no strategy succeeds', async () => {
      // All strategies fail
      mockPrisma.personality.findFirst.mockResolvedValue(null);

      await expect(resolvePersonality(createOpts({ importType: 'memory_only' }))).rejects.toThrow(
        /No personality found.*test-shape-user123.*test-shape.*shapes-uuid-123/
      );
    });

    it('should skip shapesId strategy when shapesId is empty', async () => {
      mockPrisma.personality.findFirst.mockResolvedValue(null);

      await expect(
        resolvePersonality(createOpts({ importType: 'memory_only', shapesId: '' }))
      ).rejects.toThrow('No personality found');

      // Only 2 calls: normalized slug + raw slug (no shapesId strategy)
      expect(mockPrisma.personality.findFirst).toHaveBeenCalledTimes(2);
    });
  });
});
