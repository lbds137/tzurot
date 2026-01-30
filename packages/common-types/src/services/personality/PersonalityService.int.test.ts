/**
 * Service Test: PersonalityService
 *
 * Tests personality loading with REAL database (PGlite in-memory PostgreSQL).
 * Service tests verify the "plumbing" - database interactions, queries, constraints.
 *
 * Key behaviors tested:
 * - Loading personality by name, ID, slug, or alias
 * - Access control (public vs private personalities)
 * - Caching behavior
 * - Global default config fallback
 * - Cache invalidation
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '../prisma.js';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { PersonalityService } from './PersonalityService.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load the pre-generated PGLite schema SQL.
 * This SQL is generated from Prisma schema using `prisma migrate diff`.
 */
function loadPGliteSchema(): string {
  // Path from packages/common-types/src/services/personality/ to tests/schema/
  const schemaPath = join(__dirname, '../../../../../tests/schema/pglite-schema.sql');
  try {
    return readFileSync(schemaPath, 'utf-8');
  } catch {
    throw new Error(
      `Failed to load PGLite schema from ${schemaPath}. ` +
        `Run pnpm generate:pglite to generate it.`
    );
  }
}

describe('PersonalityService', () => {
  let prisma: PrismaClient;
  let pglite: PGlite;
  let service: PersonalityService;

  // Test fixture IDs
  const testOwnerId = '00000000-0000-0000-0000-000000000001';
  const testOwnerDiscordId = '111111111111111111';
  const testPersonalityId = '00000000-0000-0000-0000-000000000010';
  const testPrivatePersonalityId = '00000000-0000-0000-0000-000000000011';
  const testSystemPromptId = '00000000-0000-0000-0000-000000000020';
  const testLlmConfigId = '00000000-0000-0000-0000-000000000030';
  const globalDefaultConfigId = '00000000-0000-0000-0000-000000000031';

  beforeAll(async () => {
    // Set up PGlite (in-memory Postgres via WASM) with pgvector extension
    pglite = new PGlite({
      extensions: { vector },
    });

    // Load and execute the pre-generated schema
    const schemaSql = loadPGliteSchema();
    await pglite.exec(schemaSql);

    // Create Prisma adapter for PGlite
    const adapter = new PrismaPGlite(pglite);

    // Create Prisma client with PGlite adapter
    prisma = new PrismaClient({ adapter }) as PrismaClient;

    // Seed test data
    // Owner user
    await prisma.user.create({
      data: {
        id: testOwnerId,
        discordId: testOwnerDiscordId,
        username: 'testowner',
      },
    });

    // System prompt
    await prisma.systemPrompt.create({
      data: {
        id: testSystemPromptId,
        name: 'Test Prompt',
        content: 'You are a helpful test bot.',
      },
    });

    // LLM configs - need owner_id in the actual schema
    await prisma.llmConfig.create({
      data: {
        id: testLlmConfigId,
        name: 'Test Config',
        model: 'anthropic/claude-sonnet-4',
        advancedParameters: { temperature: 0.9 },
        isGlobal: false,
        ownerId: testOwnerId,
      },
    });

    await prisma.llmConfig.create({
      data: {
        id: globalDefaultConfigId,
        name: 'Global Default',
        model: 'anthropic/claude-haiku-4.5',
        advancedParameters: { temperature: 0.7 },
        isGlobal: true,
        isDefault: true,
        ownerId: testOwnerId,
      },
    });

    // Public personality (with default config)
    await prisma.personality.create({
      data: {
        id: testPersonalityId,
        name: 'TestBot',
        slug: 'testbot',
        systemPromptId: testSystemPromptId,
        ownerId: testOwnerId,
        isPublic: true,
        characterInfo: 'A test bot',
        personalityTraits: 'Helpful and friendly',
      },
    });

    // Link the LLM config to this personality via PersonalityDefaultConfig
    await prisma.personalityDefaultConfig.create({
      data: {
        personalityId: testPersonalityId,
        llmConfigId: testLlmConfigId,
      },
    });

    // Private personality (owned by testOwner, no default config - should use global)
    await prisma.personality.create({
      data: {
        id: testPrivatePersonalityId,
        name: 'PrivateBot',
        slug: 'privatebot',
        systemPromptId: testSystemPromptId,
        ownerId: testOwnerId,
        isPublic: false,
        characterInfo: 'A private bot',
        personalityTraits: 'Secretive',
      },
    });

    // Alias for public personality
    await prisma.personalityAlias.create({
      data: {
        id: '00000000-0000-0000-0000-000000000040',
        alias: 'tb',
        personalityId: testPersonalityId,
      },
    });

    // Create service instance
    service = new PersonalityService(prisma);
  }, 30000);

  beforeEach(() => {
    // Clear cache between tests
    service.invalidateAll();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pglite.close();
  }, 30000);

  describe('loadPersonality', () => {
    it('should load personality by ID', async () => {
      const personality = await service.loadPersonality(testPersonalityId);

      expect(personality).not.toBeNull();
      expect(personality?.id).toBe(testPersonalityId);
      expect(personality?.name).toBe('TestBot');
      expect(personality?.model).toBe('anthropic/claude-sonnet-4');
      expect(personality?.temperature).toBe(0.9);
    });

    it('should load personality by name', async () => {
      const personality = await service.loadPersonality('TestBot');

      expect(personality).not.toBeNull();
      expect(personality?.name).toBe('TestBot');
    });

    it('should load personality by slug', async () => {
      const personality = await service.loadPersonality('testbot');

      expect(personality).not.toBeNull();
      expect(personality?.slug).toBe('testbot');
    });

    it('should load personality by alias', async () => {
      const personality = await service.loadPersonality('tb');

      expect(personality).not.toBeNull();
      expect(personality?.name).toBe('TestBot');
    });

    it('should return null for non-existent personality', async () => {
      const personality = await service.loadPersonality('nonexistent');
      expect(personality).toBeNull();
    });

    it('should use global default config when personality has none', async () => {
      const personality = await service.loadPersonality(testPrivatePersonalityId);

      // Private personality has no default_config_id, should use global default
      expect(personality).not.toBeNull();
      expect(personality?.temperature).toBe(0.7); // Global default temperature
    });

    it('should cache personality after loading', async () => {
      // First load
      await service.loadPersonality(testPersonalityId);

      // Check cache stats
      const stats = service.getCacheStats();
      expect(stats.size).toBe(1);
    });

    it('should return cached personality on subsequent loads (internal operations)', async () => {
      // First load
      const first = await service.loadPersonality(testPersonalityId);

      // Second load (should come from cache since no userId)
      const second = await service.loadPersonality(testPersonalityId);

      expect(first).toEqual(second);
    });
  });

  describe('access control', () => {
    it('should allow access to public personality for any user', async () => {
      const personality = await service.loadPersonality(testPersonalityId, 'any-user-id');

      expect(personality).not.toBeNull();
      expect(personality?.name).toBe('TestBot');
    });

    it('should allow owner to access private personality', async () => {
      const personality = await service.loadPersonality(
        testPrivatePersonalityId,
        testOwnerDiscordId
      );

      expect(personality).not.toBeNull();
      expect(personality?.name).toBe('PrivateBot');
    });

    it('should deny non-owner access to private personality', async () => {
      const personality = await service.loadPersonality(testPrivatePersonalityId, 'other-user-id');

      expect(personality).toBeNull();
    });

    it('should allow internal operations (no userId) to access private personality', async () => {
      const personality = await service.loadPersonality(testPrivatePersonalityId);

      expect(personality).not.toBeNull();
      expect(personality?.name).toBe('PrivateBot');
    });
  });

  describe('loadAllPersonalities', () => {
    it('should load all personalities (internal operation)', async () => {
      const personalities = await service.loadAllPersonalities();

      expect(personalities.length).toBeGreaterThanOrEqual(2);

      const names = personalities.map(p => p.name);
      expect(names).toContain('TestBot');
      expect(names).toContain('PrivateBot');
    });

    it('should cache all personalities after loading', async () => {
      await service.loadAllPersonalities();

      const stats = service.getCacheStats();
      expect(stats.size).toBeGreaterThanOrEqual(2);
    });
  });

  describe('cache invalidation', () => {
    it('should clear specific personality from cache', async () => {
      // Load to populate cache
      await service.loadPersonality(testPersonalityId);
      expect(service.getCacheStats().size).toBe(1);

      // Invalidate
      service.invalidatePersonality(testPersonalityId);

      // Cache should be empty
      expect(service.getCacheStats().size).toBe(0);
    });

    it('should clear all personalities from cache', async () => {
      // Load multiple to populate cache
      await service.loadAllPersonalities();
      expect(service.getCacheStats().size).toBeGreaterThan(0);

      // Invalidate all
      service.invalidateAll();

      // Cache should be empty
      expect(service.getCacheStats().size).toBe(0);
    });
  });

  describe('getCacheStats', () => {
    it('should return correct cache statistics', async () => {
      const stats = service.getCacheStats();

      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('maxSize');
      expect(stats).toHaveProperty('ttl');
      expect(stats.maxSize).toBe(100);
      expect(typeof stats.ttl).toBe('number');
    });
  });
});
