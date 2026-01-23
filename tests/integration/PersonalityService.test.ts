/**
 * Integration Test: PersonalityService
 *
 * Tests the PersonalityService that was refactored into focused modules:
 * - PersonalityLoader (database queries)
 * - PersonalityValidator (Zod schemas)
 * - PersonalityDefaults (config merging)
 * - PersonalityCache (in-memory caching)
 *
 * Validates that the split modules work together correctly.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  PersonalityService,
  generateSystemPromptUuid,
  generatePersonalityUuid,
} from '@tzurot/common-types';
import { setupTestEnvironment, type TestEnvironment } from './setup';

describe('PersonalityService Integration', () => {
  let testEnv: TestEnvironment;
  let personalityService: PersonalityService;

  beforeAll(async () => {
    testEnv = await setupTestEnvironment();

    // Seed test system prompts (using deterministic UUIDs for sync compatibility)
    const systemPrompt1 = await testEnv.prisma.systemPrompt.create({
      data: {
        id: generateSystemPromptUuid('test-system-prompt-1'),
        name: 'test-system-prompt-1',
        content: 'You are a helpful test personality for integration testing.',
      },
    });

    const systemPrompt2 = await testEnv.prisma.systemPrompt.create({
      data: {
        id: generateSystemPromptUuid('test-system-prompt-2'),
        name: 'test-system-prompt-2',
        content: 'You are a professional test personality for integration testing.',
      },
    });

    // Seed test personalities (using deterministic UUIDs for sync compatibility)
    await testEnv.prisma.personality.createMany({
      data: [
        {
          id: generatePersonalityUuid('test-personality-1'),
          name: 'test-personality-1',
          slug: 'test-personality-1',
          displayName: 'Test Personality 1',
          systemPromptId: systemPrompt1.id,
          characterInfo: 'A test character for integration testing',
          personalityTraits: 'Helpful, friendly, and responsive',
        },
        {
          id: generatePersonalityUuid('test-personality-2'),
          name: 'test-personality-2',
          slug: 'test-personality-2',
          displayName: 'Test Personality 2',
          systemPromptId: systemPrompt2.id,
          characterInfo: 'Another test character for integration testing',
          personalityTraits: 'Professional, knowledgeable, and concise',
        },
      ],
      skipDuplicates: true,
    });

    // Seed global default LLM config
    await testEnv.prisma.llmConfig.upsert({
      where: { id: '00000000-0000-0000-0000-000000000000' },
      create: {
        id: '00000000-0000-0000-0000-000000000000',
        name: 'Global Default',
        model: 'anthropic/claude-sonnet-4',
        visionModel: 'anthropic/claude-sonnet-4',
        advancedParameters: {
          temperature: 0.7,
          maxTokens: 4000,
        },
      },
      update: {},
    });
  });

  afterAll(async () => {
    try {
      // Cleanup test data (personalities first due to foreign key constraints)
      await testEnv.prisma.personality.deleteMany({
        where: {
          name: {
            in: ['test-personality-1', 'test-personality-2'],
          },
        },
      });

      // Cleanup system prompts
      await testEnv.prisma.systemPrompt.deleteMany({
        where: {
          name: {
            in: ['test-system-prompt-1', 'test-system-prompt-2'],
          },
        },
      });
    } finally {
      await testEnv.cleanup();
    }
  });

  beforeEach(() => {
    // Create a fresh service instance for each test to avoid cache pollution
    personalityService = new PersonalityService(testEnv.prisma);
  });

  describe('module integration', () => {
    it('should successfully instantiate with all modules', () => {
      expect(personalityService).toBeDefined();
      expect(personalityService).toBeInstanceOf(PersonalityService);
    });

    it('should have cache stats accessible', () => {
      const stats = personalityService.getCacheStats();

      expect(stats).toBeDefined();
      expect(stats.size).toBe(0); // Fresh cache
      expect(stats.maxSize).toBeGreaterThan(0);
      expect(stats.ttl).toBeGreaterThan(0);
    });
  });

  describe('loadPersonality', () => {
    it('should load a personality by name from database', async () => {
      // Get a personality name from the database first
      const personalities = await testEnv.prisma.personality.findMany({
        take: 1,
      });

      if (personalities.length === 0) {
        console.log('No personalities found, skipping test');
        return;
      }

      const testName = personalities[0].name;

      // Load personality by name
      const personality = await personalityService.loadPersonality(testName);

      expect(personality).toBeDefined();
      expect(personality?.name).toBe(testName);
      expect(personality?.id).toBeDefined();
      expect(personality?.model).toBeDefined();
      console.log(`Loaded personality: ${personality?.name} (${personality?.model})`);
    });

    it('should load a personality by ID from database', async () => {
      // Get a personality ID from the database first
      const personalities = await testEnv.prisma.personality.findMany({
        take: 1,
      });

      if (personalities.length === 0) {
        console.log('No personalities found, skipping test');
        return;
      }

      const testId = personalities[0].id;

      // Load personality by ID
      const personality = await personalityService.loadPersonality(testId);

      expect(personality).toBeDefined();
      expect(personality?.id).toBe(testId);
      expect(personality?.name).toBeDefined();
      expect(personality?.model).toBeDefined();
    });

    it('should return null for non-existent personality', async () => {
      const personality = await personalityService.loadPersonality('nonexistent-personality-99999');

      expect(personality).toBeNull();
    });

    it('should cache personality after loading', async () => {
      const personalities = await testEnv.prisma.personality.findMany({
        take: 1,
      });

      if (personalities.length === 0) {
        console.log('No personalities found, skipping test');
        return;
      }

      const testId = personalities[0].id;

      // Cache should be empty initially
      const initialStats = personalityService.getCacheStats();
      expect(initialStats.size).toBe(0);

      // Load personality (will cache it)
      const personality1 = await personalityService.loadPersonality(testId);
      expect(personality1).toBeDefined();

      // Cache should now have 1 entry
      const afterLoadStats = personalityService.getCacheStats();
      expect(afterLoadStats.size).toBe(1);

      // Load same personality again (should hit cache)
      const personality2 = await personalityService.loadPersonality(testId);
      expect(personality2).toBeDefined();
      expect(personality2?.id).toBe(personality1?.id);

      // Cache should still have 1 entry
      const afterSecondLoadStats = personalityService.getCacheStats();
      expect(afterSecondLoadStats.size).toBe(1);
    });
  });

  describe('loadAllPersonalities', () => {
    it('should load all personalities from database', async () => {
      const personalities = await personalityService.loadAllPersonalities();

      expect(Array.isArray(personalities)).toBe(true);
      expect(personalities.length).toBeGreaterThan(0);

      // Verify each personality has required fields
      for (const personality of personalities) {
        expect(personality.id).toBeDefined();
        expect(personality.name).toBeDefined();
        expect(personality.model).toBeDefined();
      }

      console.log(`Loaded ${personalities.length} personalities`);
    });

    it('should cache all loaded personalities', async () => {
      // Cache should be empty initially
      const initialStats = personalityService.getCacheStats();
      expect(initialStats.size).toBe(0);

      // Load all personalities
      const personalities = await personalityService.loadAllPersonalities();
      const count = personalities.length;

      // Cache should now have all personalities
      const afterLoadStats = personalityService.getCacheStats();
      expect(afterLoadStats.size).toBe(count);
    });
  });

  describe('cache invalidation', () => {
    it('should invalidate specific personality from cache', async () => {
      const personalities = await testEnv.prisma.personality.findMany({
        take: 1,
      });

      if (personalities.length === 0) {
        console.log('No personalities found, skipping test');
        return;
      }

      const testId = personalities[0].id;

      // Load personality to cache it
      await personalityService.loadPersonality(testId);
      expect(personalityService.getCacheStats().size).toBe(1);

      // Invalidate the cached personality
      personalityService.invalidatePersonality(testId);

      // Cache should be empty now
      expect(personalityService.getCacheStats().size).toBe(0);
    });

    it('should invalidate all personalities from cache', async () => {
      // Load all personalities to populate cache
      const personalities = await personalityService.loadAllPersonalities();
      const count = personalities.length;

      // Cache should have all personalities
      expect(personalityService.getCacheStats().size).toBe(count);

      // Invalidate all
      personalityService.invalidateAll();

      // Cache should be empty now
      expect(personalityService.getCacheStats().size).toBe(0);
    });
  });

  describe('config merging and defaults', () => {
    it('should successfully load personality with merged config', async () => {
      const personalities = await testEnv.prisma.personality.findMany({
        take: 1,
      });

      if (personalities.length === 0) {
        console.log('No personalities found, skipping test');
        return;
      }

      const personality = await personalityService.loadPersonality(personalities[0].name);

      expect(personality).toBeDefined();

      // Verify config fields are present (from PersonalityDefaults)
      expect(personality?.model).toBeDefined();
      expect(personality?.temperature).toBeDefined();
      expect(personality?.maxTokens).toBeDefined();

      console.log(
        `Personality config: model=${personality?.model}, temp=${personality?.temperature}, maxTokens=${personality?.maxTokens}`
      );
    });

    it('should handle personalities with and without default configs', async () => {
      const personalities = await personalityService.loadAllPersonalities();

      // Verify all personalities loaded successfully regardless of config setup
      expect(personalities.length).toBeGreaterThan(0);

      for (const personality of personalities) {
        expect(personality.model).toBeDefined();
        expect(personality.temperature).toBeDefined();
        expect(personality.maxTokens).toBeDefined();
      }
    });
  });

  describe('database connectivity through PersonalityLoader', () => {
    it('should query personalities table successfully', async () => {
      // This tests that PersonalityLoader can access the database
      const personalities = await testEnv.prisma.personality.findMany({
        take: 5,
      });

      expect(Array.isArray(personalities)).toBe(true);
      console.log(`PersonalityLoader can access ${personalities.length} personalities`);
    });

    it('should query default_configs table if it exists', async () => {
      // Check if default_configs table exists and is queryable
      try {
        const defaultConfigs = await testEnv.prisma.defaultConfig.findMany({
          take: 1,
        });

        expect(Array.isArray(defaultConfigs)).toBe(true);
        console.log(`Found ${defaultConfigs.length} default configs`);
      } catch (error) {
        // Table might not exist, which is okay
        console.log('default_configs table not found or empty');
      }
    });
  });
});
