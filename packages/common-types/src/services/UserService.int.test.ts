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
import { generatePersonaUuid } from '../utils/deterministicUuid.js';
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
    // Clear tables between tests. Post-Phase-5, personas referenced as a
    // user's default can't be deleted directly (Restrict FK). Deleting the
    // user first cascades to their personas (Persona.owner onDelete: Cascade),
    // which Postgres orders correctly within the transaction.
    await prisma.user.deleteMany();
    // Belt-and-suspenders: clean up any orphaned personas (unreachable
    // post-Phase-5 owner cascade but preserves test isolation if anything
    // slips through).
    await prisma.persona.deleteMany();

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
      const provisioned = await service.getOrCreateUser(
        testDiscordId,
        testUsername,
        testDisplayName,
        testBio
      );

      expect(provisioned).not.toBeNull();
      expect(typeof provisioned?.userId).toBe('string');
      expect(typeof provisioned?.defaultPersonaId).toBe('string');

      // Verify user was created
      const user = await prisma.user.findUnique({
        where: { discordId: testDiscordId },
      });
      expect(user).not.toBeNull();
      expect(user?.username).toBe(testUsername);
      expect(user?.defaultPersonaId).toBe(provisioned?.defaultPersonaId);

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
      const first = await service.getOrCreateUser(testDiscordId, testUsername);

      // Call again - should return same user
      const second = await service.getOrCreateUser(testDiscordId, testUsername);

      expect(first?.userId).toBe(second?.userId);

      // Verify only one user exists
      const users = await prisma.user.findMany({
        where: { discordId: testDiscordId },
        take: 100, // Bounded query best practice
      });
      expect(users).toHaveLength(1);
    });

    it('should return null for bot users', async () => {
      const result = await service.getOrCreateUser(
        testDiscordId,
        testUsername,
        undefined,
        undefined,
        true // isBot
      );

      expect(result).toBeNull();

      // Verify no user was created
      const user = await prisma.user.findUnique({
        where: { discordId: testDiscordId },
      });
      expect(user).toBeNull();
    });

    it('should promote bot owner to superuser on creation', async () => {
      vi.mocked(isBotOwner).mockReturnValue(true);

      const provisioned = await service.getOrCreateUser(testDiscordId, testUsername);

      const user = await prisma.user.findUnique({
        where: { id: provisioned?.userId ?? '' },
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
      const provisioned = await service.getOrCreateUser(testDiscordId, testUsername);
      const duration = Date.now() - startTime;

      expect(provisioned?.userId).toBeDefined();
      // Cached lookup should be very fast (< 10ms typically)
      expect(duration).toBeLessThan(100);
    });
  });

  describe('shell-flow creation and upgrade (Phase 5b)', () => {
    // The legacy "backfill a null-default user" scenario is structurally
    // impossible post-5b: users.default_persona_id is NOT NULL and both user
    // paths atomically create a persona. These tests exercise the new
    // contract — the shell path produces a valid user + placeholder persona,
    // and the first real `getOrCreateUser` call upgrades both sides.

    it('getOrCreateUserShell creates a user with a non-null default persona named "User {discordId}"', async () => {
      const userId = await service.getOrCreateUserShell(testDiscordId);

      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user).not.toBeNull();
      expect(user?.username).toBe(testDiscordId); // Placeholder
      expect(user?.defaultPersonaId).not.toBeNull();

      const persona = await prisma.persona.findUnique({
        where: { id: user!.defaultPersonaId! },
      });
      expect(persona).not.toBeNull();
      expect(persona?.name).toBe(`User ${testDiscordId}`);
      expect(persona?.preferredName).toBe(`User ${testDiscordId}`);
      expect(persona?.ownerId).toBe(userId);
    });

    it('first getOrCreateUser after a shell upgrades both username and placeholder persona name', async () => {
      const userId = await service.getOrCreateUserShell(testDiscordId);

      // Use a fresh service so the upgrade path actually runs (cache would
      // otherwise short-circuit runMaintenanceTasks).
      const newService = new UserService(prisma);
      const provisioned = await newService.getOrCreateUser(
        testDiscordId,
        testUsername,
        testDisplayName
      );

      expect(provisioned?.userId).toBe(userId);

      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user?.username).toBe(testUsername);

      const persona = await prisma.persona.findUnique({
        where: { id: user!.defaultPersonaId! },
      });
      expect(persona?.name).toBe(testUsername);
      // `preferredName` follows `displayName ?? username`, matching the
      // full-path create behavior. A shell-created user whose first
      // bot-client interaction carries a distinct displayName should land
      // on preferredName = displayName, not preferredName = username.
      expect(persona?.preferredName).toBe(testDisplayName);
    });

    it('calling getOrCreateUser twice with the same real username is idempotent (no P2002)', async () => {
      await service.getOrCreateUserShell(testDiscordId);

      const first = await new UserService(prisma).getOrCreateUser(testDiscordId, testUsername);
      const second = await new UserService(prisma).getOrCreateUser(testDiscordId, testUsername);

      expect(first?.userId).toBe(second?.userId);
      expect(first?.defaultPersonaId).toBe(second?.defaultPersonaId);
    });
  });

  describe('getUserTimezone', () => {
    it('should return user timezone', async () => {
      const provisioned = await service.getOrCreateUser(testDiscordId, testUsername);
      const userId = provisioned!.userId;

      // Set timezone
      await prisma.user.update({
        where: { id: userId },
        data: { timezone: 'America/New_York' },
      });

      const timezone = await service.getUserTimezone(userId);
      expect(timezone).toBe('America/New_York');
    });

    it('should return UTC for user without timezone set', async () => {
      const provisioned = await service.getOrCreateUser(testDiscordId, testUsername);
      const timezone = await service.getUserTimezone(provisioned!.userId);
      expect(timezone).toBe('UTC');
    });

    it('should return UTC for non-existent user', async () => {
      const timezone = await service.getUserTimezone('non-existent-id');
      expect(timezone).toBe('UTC');
    });
  });

  describe('getPersonaName', () => {
    it('should return preferredName when set', async () => {
      const provisioned = await service.getOrCreateUser(
        testDiscordId,
        testUsername,
        testDisplayName
      );

      const user = await prisma.user.findUnique({
        where: { id: provisioned?.userId ?? '' },
      });

      const name = await service.getPersonaName(user!.defaultPersonaId!);
      expect(name).toBe(testDisplayName);
    });

    it('should return name when preferredName is not set', async () => {
      const provisioned = await service.getOrCreateUser(testDiscordId, testUsername);

      const user = await prisma.user.findUnique({
        where: { id: provisioned?.userId ?? '' },
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
      const allUsers = await prisma.user.findMany({ take: 100 });
      expect(allUsers).toHaveLength(2);
    });
  });

  describe('Identity Epic Phase 5 — DB-level invariants', () => {
    // These tests verify the constraints added in the Phase 5 migration at
    // the DB level. The app layer has its own guards (e.g., crud.ts:254's
    // "Cannot delete your default persona" validation error) — these tests
    // exercise the structural safety net that fires if the app guard is
    // bypassed or deleted.
    //
    // NOTE: CHECK constraints (personas_name_non_empty,
    // personas_name_not_snowflake) can't be tested against PGLite because
    // Prisma doesn't represent CHECK constraints in the schema, so they
    // don't make it into the regenerated PGLite schema. They're exercised
    // by the real-Postgres migration applies (local + Railway).

    it("should reject deleting a persona that is still someone's default (Restrict FK)", async () => {
      // Pre-Phase-5: this delete would succeed and silently null the FK.
      // Post-Phase-5: the FK is ON DELETE RESTRICT, so the delete fails at
      // the DB level with P2003.
      await service.getOrCreateUser(testDiscordId, testUsername);

      const user = await prisma.user.findUnique({
        where: { discordId: testDiscordId },
        select: { defaultPersonaId: true },
      });
      expect(user?.defaultPersonaId).not.toBeNull();

      const defaultPersonaId = user!.defaultPersonaId!;

      await expect(
        prisma.persona.delete({ where: { id: defaultPersonaId } })
      ).rejects.toMatchObject({
        code: 'P2003', // Prisma's FK constraint violation
      });

      // Persona still exists; default_persona_id still points to it
      const personaStillExists = await prisma.persona.findUnique({
        where: { id: defaultPersonaId },
      });
      expect(personaStillExists).not.toBeNull();
    });

    it('should reject two personas with the same (owner_id, name) (unique constraint)', async () => {
      // Two personas per user is fine — they just can't share a name.
      const provisioned = await service.getOrCreateUser(testDiscordId, testUsername);
      expect(provisioned).not.toBeNull();
      const userId = provisioned!.userId;

      // First explicit persona named "Alice" — succeeds
      await prisma.persona.create({
        data: {
          id: generatePersonaUuid('Alice', userId),
          name: 'Alice',
          content: 'First Alice',
          ownerId: userId,
        },
      });

      // Second persona with the same name for the SAME owner — fails with P2002
      await expect(
        prisma.persona.create({
          data: {
            // Different UUID seed but same (ownerId, name) pair
            id: generatePersonaUuid('Alice-duplicate', userId),
            name: 'Alice',
            content: 'Second Alice',
            ownerId: userId,
          },
        })
      ).rejects.toMatchObject({
        code: 'P2002', // Prisma's unique constraint violation
      });

      // A DIFFERENT user with name "Alice" still works — uniqueness is scoped to owner
      const otherProvisioned = await service.getOrCreateUser('222222222222222222', 'other');
      expect(otherProvisioned).not.toBeNull();
      const otherUserId = otherProvisioned!.userId;

      await prisma.persona.create({
        data: {
          id: generatePersonaUuid('Alice', otherUserId),
          name: 'Alice',
          content: 'Alice (owned by other user)',
          ownerId: otherUserId,
        },
      });

      // Two "Alice" personas total — one per owner
      const alicePersonas = await prisma.persona.findMany({ where: { name: 'Alice' } });
      expect(alicePersonas).toHaveLength(2);
    });
  });
});
