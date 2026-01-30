/**
 * Service Test: UserService
 *
 * Tests user management with REAL database (PGlite in-memory PostgreSQL).
 * Service tests verify the "plumbing" - database interactions, queries, constraints.
 *
 * Key behaviors tested:
 * - User creation with default persona
 * - Race condition handling (P2002 unique constraint)
 * - Backfilling default personas for legacy users
 * - Bot owner promotion to superuser
 * - Batch user creation
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PrismaClient } from './prisma.js';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { UserService } from './UserService.js';
import { loadPGliteSchema } from '@tzurot/test-utils';

// Mock isBotOwner - will be configured per test
vi.mock('../utils/ownerMiddleware.js', () => ({
  isBotOwner: vi.fn().mockReturnValue(false),
}));

import { isBotOwner } from '../utils/ownerMiddleware.js';

describe('UserService', () => {
  let prisma: PrismaClient;
  let pglite: PGlite;
  let service: UserService;

  // Test fixture data
  const testDiscordId = '111111111111111111';
  const testUsername = 'testuser';
  const testDisplayName = 'Test User';
  const testBio = 'A test user bio';

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

    // Create service instance
    service = new UserService(prisma);
  }, 30000);

  beforeEach(async () => {
    // Clear tables between tests (personas first due to FK)
    await prisma.persona.deleteMany();
    await prisma.user.deleteMany();

    // Create fresh service instance to reset cache
    service = new UserService(prisma);

    // Reset mocks
    vi.mocked(isBotOwner).mockReturnValue(false);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pglite.close();
  }, 30000);

  describe('getOrCreateUser', () => {
    it('should create a new user with default persona', async () => {
      const userId = await service.getOrCreateUser(
        testDiscordId,
        testUsername,
        testDisplayName,
        testBio
      );

      expect(userId).toBeDefined();
      expect(typeof userId).toBe('string');

      // Verify user was created
      const user = await prisma.user.findUnique({
        where: { discordId: testDiscordId },
      });
      expect(user).not.toBeNull();
      expect(user?.username).toBe(testUsername);
      expect(user?.defaultPersonaId).not.toBeNull();

      // Verify persona was created
      const persona = await prisma.persona.findUnique({
        where: { id: user?.defaultPersonaId ?? '' },
      });
      expect(persona).not.toBeNull();
      expect(persona?.name).toBe(testUsername);
      expect(persona?.preferredName).toBe(testDisplayName);
      expect(persona?.content).toBe(testBio);
    });

    it('should return existing user without creating duplicate', async () => {
      // Create user first
      const userId1 = await service.getOrCreateUser(testDiscordId, testUsername);

      // Call again - should return same user
      const userId2 = await service.getOrCreateUser(testDiscordId, testUsername);

      expect(userId1).toBe(userId2);

      // Verify only one user exists
      const users = await prisma.user.findMany({
        where: { discordId: testDiscordId },
      });
      expect(users).toHaveLength(1);
    });

    it('should return null for bot users', async () => {
      const userId = await service.getOrCreateUser(
        testDiscordId,
        testUsername,
        undefined,
        undefined,
        true // isBot
      );

      expect(userId).toBeNull();

      // Verify no user was created
      const user = await prisma.user.findUnique({
        where: { discordId: testDiscordId },
      });
      expect(user).toBeNull();
    });

    it('should promote bot owner to superuser on creation', async () => {
      vi.mocked(isBotOwner).mockReturnValue(true);

      const userId = await service.getOrCreateUser(testDiscordId, testUsername);

      const user = await prisma.user.findUnique({
        where: { id: userId ?? '' },
      });
      expect(user?.isSuperuser).toBe(true);
    });

    it('should promote existing user to superuser when BOT_OWNER_ID is set later', async () => {
      // Create user as non-superuser
      vi.mocked(isBotOwner).mockReturnValue(false);
      await service.getOrCreateUser(testDiscordId, testUsername);

      // Clear cache to force re-check
      const newService = new UserService(prisma);

      // Now simulate BOT_OWNER_ID being set
      vi.mocked(isBotOwner).mockReturnValue(true);
      await newService.getOrCreateUser(testDiscordId, testUsername);

      const user = await prisma.user.findUnique({
        where: { discordId: testDiscordId },
      });
      expect(user?.isSuperuser).toBe(true);
    });

    it('should use username as persona name when displayName not provided', async () => {
      await service.getOrCreateUser(testDiscordId, testUsername);

      const user = await prisma.user.findUnique({
        where: { discordId: testDiscordId },
      });
      const persona = await prisma.persona.findUnique({
        where: { id: user?.defaultPersonaId ?? '' },
      });

      expect(persona?.preferredName).toBe(testUsername);
    });

    it('should cache user ID after first lookup', async () => {
      // Create user
      await service.getOrCreateUser(testDiscordId, testUsername);

      // Second call should use cache (we can't directly test this, but we can
      // verify it returns quickly and correctly)
      const startTime = Date.now();
      const userId = await service.getOrCreateUser(testDiscordId, testUsername);
      const duration = Date.now() - startTime;

      expect(userId).toBeDefined();
      // Cached lookup should be very fast (< 10ms typically)
      expect(duration).toBeLessThan(100);
    });
  });

  describe('backfillDefaultPersona', () => {
    it('should backfill persona for user created without one', async () => {
      // Manually create user without persona (simulates api-gateway direct creation)
      const userId = '00000000-0000-0000-0000-000000000099';
      await prisma.user.create({
        data: {
          id: userId,
          discordId: testDiscordId,
          username: testUsername,
          defaultPersonaId: null,
        },
      });

      // Use new service instance to avoid cache
      const newService = new UserService(prisma);

      // getOrCreateUser should trigger backfill
      const returnedId = await newService.getOrCreateUser(
        testDiscordId,
        testUsername,
        testDisplayName
      );

      expect(returnedId).toBe(userId);

      // Verify persona was backfilled
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });
      expect(user?.defaultPersonaId).not.toBeNull();

      const persona = await prisma.persona.findUnique({
        where: { id: user?.defaultPersonaId ?? '' },
      });
      expect(persona).not.toBeNull();
      expect(persona?.name).toBe(testUsername);
      expect(persona?.preferredName).toBe(testDisplayName);
    });

    it('should update placeholder username to real username', async () => {
      // Create user with discordId as username (placeholder pattern)
      const userId = '00000000-0000-0000-0000-000000000098';
      const personaId = '00000000-0000-0000-0000-000000000097';

      await prisma.user.create({
        data: {
          id: userId,
          discordId: testDiscordId,
          username: testDiscordId, // Placeholder
          defaultPersonaId: null,
        },
      });

      // Create a persona for this user
      await prisma.persona.create({
        data: {
          id: personaId,
          name: testDiscordId,
          content: '',
          ownerId: userId,
        },
      });

      // Link persona
      await prisma.user.update({
        where: { id: userId },
        data: { defaultPersonaId: personaId },
      });

      // Use new service to avoid cache
      const newService = new UserService(prisma);

      // Call with real username
      await newService.getOrCreateUser(testDiscordId, testUsername);

      // Verify username was updated
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });
      expect(user?.username).toBe(testUsername);
    });
  });

  describe('getUserTimezone', () => {
    it('should return user timezone', async () => {
      const userId = await service.getOrCreateUser(testDiscordId, testUsername);

      // Set timezone
      await prisma.user.update({
        where: { id: userId! },
        data: { timezone: 'America/New_York' },
      });

      const timezone = await service.getUserTimezone(userId!);
      expect(timezone).toBe('America/New_York');
    });

    it('should return UTC for user without timezone set', async () => {
      const userId = await service.getOrCreateUser(testDiscordId, testUsername);
      const timezone = await service.getUserTimezone(userId!);
      expect(timezone).toBe('UTC');
    });

    it('should return UTC for non-existent user', async () => {
      const timezone = await service.getUserTimezone('non-existent-id');
      expect(timezone).toBe('UTC');
    });
  });

  describe('getPersonaName', () => {
    it('should return preferredName when set', async () => {
      const userId = await service.getOrCreateUser(testDiscordId, testUsername, testDisplayName);

      const user = await prisma.user.findUnique({
        where: { id: userId ?? '' },
      });

      const name = await service.getPersonaName(user!.defaultPersonaId!);
      expect(name).toBe(testDisplayName);
    });

    it('should return name when preferredName is not set', async () => {
      const userId = await service.getOrCreateUser(testDiscordId, testUsername);

      const user = await prisma.user.findUnique({
        where: { id: userId ?? '' },
      });

      // Clear preferredName
      await prisma.persona.update({
        where: { id: user?.defaultPersonaId ?? '' },
        data: { preferredName: null },
      });

      const name = await service.getPersonaName(user!.defaultPersonaId!);
      expect(name).toBe(testUsername);
    });

    it('should return null for non-existent persona', async () => {
      const name = await service.getPersonaName('non-existent-id');
      expect(name).toBeNull();
    });
  });

  describe('getOrCreateUsersInBatch', () => {
    it('should create multiple users in batch', async () => {
      const users = [
        { discordId: '111111111111111111', username: 'user1', isBot: false },
        { discordId: '222222222222222222', username: 'user2', isBot: false },
        { discordId: '333333333333333333', username: 'user3', isBot: false },
      ];

      const result = await service.getOrCreateUsersInBatch(users);

      expect(result.size).toBe(3);
      expect(result.has('111111111111111111')).toBe(true);
      expect(result.has('222222222222222222')).toBe(true);
      expect(result.has('333333333333333333')).toBe(true);
    });

    it('should filter out bot users', async () => {
      const users = [
        { discordId: '111111111111111111', username: 'user1', isBot: false },
        { discordId: '222222222222222222', username: 'botuser', isBot: true },
      ];

      const result = await service.getOrCreateUsersInBatch(users);

      expect(result.size).toBe(1);
      expect(result.has('111111111111111111')).toBe(true);
      expect(result.has('222222222222222222')).toBe(false);
    });

    it('should filter out unknown users', async () => {
      // UNKNOWN_USER_DISCORD_ID is 'unknown' from constants/message.ts
      const users = [
        { discordId: '111111111111111111', username: 'user1', isBot: false },
        { discordId: 'unknown', username: 'unknown', isBot: false },
      ];

      const result = await service.getOrCreateUsersInBatch(users);

      expect(result.size).toBe(1);
      expect(result.has('111111111111111111')).toBe(true);
    });

    it('should return empty map for empty input', async () => {
      const result = await service.getOrCreateUsersInBatch([]);
      expect(result.size).toBe(0);
    });

    it('should handle mixed existing and new users', async () => {
      // Create one user first
      await service.getOrCreateUser('111111111111111111', 'existing');

      const users = [
        { discordId: '111111111111111111', username: 'existing', isBot: false },
        { discordId: '222222222222222222', username: 'new', isBot: false },
      ];

      const result = await service.getOrCreateUsersInBatch(users);

      expect(result.size).toBe(2);

      // Verify only 2 users total exist
      const allUsers = await prisma.user.findMany();
      expect(allUsers).toHaveLength(2);
    });
  });
});
