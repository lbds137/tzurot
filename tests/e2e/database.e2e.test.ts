/**
 * E2E Test: Database Infrastructure
 *
 * This test verifies:
 * - PGLite schema loading works
 * - Database connection and Prisma client work with PGLite
 * - Basic CRUD operations are functional
 *
 * This is a "smoke test" to prove the test infrastructure works.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@tzurot/common-types';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { loadPGliteSchema } from '@tzurot/test-utils';

describe('Database Infrastructure', () => {
  let prisma: PrismaClient;
  let pglite: PGlite;

  beforeAll(async () => {
    // Set up PGlite with pgvector
    pglite = new PGlite({
      extensions: { vector },
    });

    // Load schema from test-utils
    const schemaSql = loadPGliteSchema();
    await pglite.exec(schemaSql);

    // Create Prisma client
    const adapter = new PrismaPGlite(pglite);
    prisma = new PrismaClient({ adapter }) as PrismaClient;
  }, 30000);

  afterAll(async () => {
    await prisma.$disconnect();
    await pglite.close();
  }, 30000);

  describe('Database Connection', () => {
    it('should connect to database and execute raw SQL', async () => {
      const result = await prisma.$queryRaw<Array<{ result: number }>>`SELECT 1 as result`;

      expect(result).toBeDefined();
      expect(result[0].result).toBe(1);
    });

    it('should have the user table available', async () => {
      // Verify the schema was loaded correctly
      const users = await prisma.user.findMany({ take: 1 });
      expect(Array.isArray(users)).toBe(true);
    });

    it('should have the personality table available', async () => {
      const personalities = await prisma.personality.findMany({ take: 1 });
      expect(Array.isArray(personalities)).toBe(true);
    });
  });

  describe('CRUD Operations', () => {
    const testUserId = '00000000-0000-0000-0000-000000000001';
    const testDiscordId = '123456789012345678';

    it('should create a user', async () => {
      const user = await prisma.user.create({
        data: {
          id: testUserId,
          discordId: testDiscordId,
          username: 'testuser',
        },
      });

      expect(user.id).toBe(testUserId);
      expect(user.username).toBe('testuser');
    });

    it('should read the created user', async () => {
      const user = await prisma.user.findUnique({
        where: { id: testUserId },
      });

      expect(user).not.toBeNull();
      expect(user?.username).toBe('testuser');
    });

    it('should update the user', async () => {
      const user = await prisma.user.update({
        where: { id: testUserId },
        data: { username: 'updateduser' },
      });

      expect(user.username).toBe('updateduser');
    });

    it('should delete the user', async () => {
      await prisma.user.delete({
        where: { id: testUserId },
      });

      const user = await prisma.user.findUnique({
        where: { id: testUserId },
      });

      expect(user).toBeNull();
    });
  });
});
