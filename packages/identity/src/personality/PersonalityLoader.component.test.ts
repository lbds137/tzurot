/**
 * Component Test: PersonalityLoader
 *
 * Runs the loader against a REAL database (PGlite in-memory PostgreSQL). The
 * colocated unit test covers every logic branch over a mocked client; this
 * tier pins the query semantics the mocks cannot verify:
 * - `mode: 'insensitive'` actually matching case-insensitively in Postgres
 * - `userId: null` in the alias where-clause matching IS NULL rows (the
 *   global tier) rather than nothing
 * - the personal→global alias fallthrough over real rows
 * - name-beats-slug prioritization and same-name scoring over real candidates
 * - the AdminSettings global-default POINTER resolving through a real FK
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import { ADMIN_SETTINGS_SINGLETON_ID } from '@tzurot/common-types/schemas/api/adminSettings';
import type { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { PersonalityLoader } from './PersonalityLoader.js';
import { createTestPGlite, loadPGliteSchema, seedUserWithPersona } from '@tzurot/test-utils';

describe('PersonalityLoader (PGlite)', () => {
  let prisma: PrismaClient;
  let pglite: PGlite;
  let loader: PersonalityLoader;

  // Users
  const ownerId = '00000000-0000-0000-0000-000000000001';
  const ownerDiscordId = '222222222222222222';
  const otherId = '00000000-0000-0000-0000-000000000002';
  const otherDiscordId = '333333333333333333';

  // Personalities
  const pubId = '00000000-0000-0000-0000-000000000010';
  const privId = '00000000-0000-0000-0000-000000000011';
  const namedEchoId = '00000000-0000-0000-0000-000000000012';
  const sluggedEchoId = '00000000-0000-0000-0000-000000000013';
  const twinPublicId = '00000000-0000-0000-0000-000000000014';
  const twinPrivateId = '00000000-0000-0000-0000-000000000015';
  const geminiOldId = '00000000-0000-0000-0000-000000000016';
  const geminiNewId = '00000000-0000-0000-0000-000000000017';

  const systemPromptId = '00000000-0000-0000-0000-000000000020';
  const globalCfgId = '00000000-0000-0000-0000-000000000030';

  beforeAll(async () => {
    pglite = createTestPGlite();
    await pglite.exec(loadPGliteSchema());
    const adapter = new PrismaPGlite(pglite);
    prisma = new PrismaClient({ adapter }) as PrismaClient;

    await seedUserWithPersona(prisma, {
      userId: ownerId,
      personaId: '00000000-0000-0000-0000-0000000000a1',
      discordId: ownerDiscordId,
      username: 'owner',
      personaName: 'owner',
    });
    await seedUserWithPersona(prisma, {
      userId: otherId,
      personaId: '00000000-0000-0000-0000-0000000000a2',
      discordId: otherDiscordId,
      username: 'other',
      personaName: 'other',
    });

    await prisma.systemPrompt.create({
      data: { id: systemPromptId, name: 'Prompt', content: 'Test prompt.' },
    });

    const base = {
      systemPromptId,
      ownerId,
      characterInfo: 'info',
      personalityTraits: 'traits',
    };
    await prisma.personality.createMany({
      data: [
        { id: pubId, name: 'Lumen', slug: 'lumen', isPublic: true, ...base },
        { id: privId, name: 'Shade', slug: 'shade', isPublic: false, ...base },
        // Name-vs-slug collision: 'echo' as a NAME on one row, as a SLUG on another
        { id: namedEchoId, name: 'Echo', slug: 'echo-original', isPublic: true, ...base },
        { id: sluggedEchoId, name: 'Reverb', slug: 'echo', isPublic: true, ...base },
        // Same-name scoring: public must beat private
        { id: twinPublicId, name: 'Twin', slug: 'twin-pub', isPublic: true, ...base },
        { id: twinPrivateId, name: 'Twin', slug: 'twin-priv', isPublic: false, ...base },
        // Same-name, same-score: oldest createdAt must win
        {
          id: geminiOldId,
          name: 'Gemini',
          slug: 'gemini-old',
          isPublic: true,
          createdAt: new Date('2024-01-01T00:00:00Z'),
          ...base,
        },
        {
          id: geminiNewId,
          name: 'Gemini',
          slug: 'gemini-new',
          isPublic: true,
          createdAt: new Date('2025-01-01T00:00:00Z'),
          ...base,
        },
      ],
    });

    await prisma.personalityAlias.createMany({
      data: [
        // Global tier (userId null) → the public personality
        { id: '00000000-0000-0000-0000-000000000040', alias: 'lux', personalityId: pubId },
        // OTHER user's personal alias with the SAME text → the private
        // personality they cannot access (fallthrough fixture)
        {
          id: '00000000-0000-0000-0000-000000000041',
          alias: 'lux',
          personalityId: privId,
          userId: otherId,
        },
        // Owner's personal alias → their own private personality
        {
          id: '00000000-0000-0000-0000-000000000042',
          alias: 'mine',
          personalityId: privId,
          userId: ownerId,
        },
      ],
    });

    await prisma.llmConfig.create({
      data: {
        id: globalCfgId,
        name: 'Global Default',
        model: 'anthropic/claude-haiku-4.5',
        provider: 'openrouter',
        advancedParameters: { temperature: 0.4 },
        isGlobal: true,
        ownerId,
      },
    });

    loader = new PersonalityLoader(prisma);
  }, 30000);

  afterAll(async () => {
    await prisma.$disconnect();
    await pglite.close();
  }, 30000);

  describe('loadFromDatabase — lookup semantics over real rows', () => {
    it('matches names case-insensitively (Prisma insensitive mode against Postgres)', async () => {
      const personality = await loader.loadFromDatabase('LUMEN');
      expect(personality?.id).toBe(pubId);
    });

    it('matches aliases case-insensitively', async () => {
      const personality = await loader.loadFromDatabase('LUX');
      expect(personality?.id).toBe(pubId);
    });

    it('prefers a NAME match over another row having it as a slug', async () => {
      const personality = await loader.loadFromDatabase('echo');
      expect(personality?.id).toBe(namedEchoId);
    });

    it('still resolves the slug when no name collides with it', async () => {
      const personality = await loader.loadFromDatabase('twin-priv');
      expect(personality?.id).toBe(twinPrivateId);
    });

    it('scores public over private when two rows share a name', async () => {
      const personality = await loader.loadFromDatabase('Twin');
      expect(personality?.id).toBe(twinPublicId);
    });

    it('breaks equal-score name ties by oldest createdAt', async () => {
      const personality = await loader.loadFromDatabase('Gemini');
      expect(personality?.id).toBe(geminiOldId);
    });

    it('returns null when nothing matches', async () => {
      expect(await loader.loadFromDatabase('nonexistent')).toBeNull();
    });
  });

  describe('loadFromDatabase — alias tiers', () => {
    it('resolves a global alias (userId IS NULL row) for a user with no personal alias', async () => {
      const personality = await loader.loadFromDatabase('lux', ownerDiscordId);
      expect(personality?.id).toBe(pubId);
    });

    it('resolves the requesting user personal alias to their private personality', async () => {
      const personality = await loader.loadFromDatabase('mine', ownerDiscordId);
      expect(personality?.id).toBe(privId);
    });

    it('does not leak a personal alias to another user', async () => {
      // 'mine' exists only as the owner's personal row; no global fallback.
      expect(await loader.loadFromDatabase('mine', otherDiscordId)).toBeNull();
    });

    it('falls through personal→global when the personal target is inaccessible', async () => {
      // The other user's personal 'lux' points at the owner's PRIVATE
      // personality; access-filtering must fall through to the global 'lux'.
      const personality = await loader.loadFromDatabase('lux', otherDiscordId);
      expect(personality?.id).toBe(pubId);
    });
  });

  describe('loadFromDatabase — access control over real rows', () => {
    it('lets the owner load their private personality by id', async () => {
      const personality = await loader.loadFromDatabase(privId, ownerDiscordId);
      expect(personality?.id).toBe(privId);
    });

    it('denies another registered user the private personality', async () => {
      expect(await loader.loadFromDatabase(privId, otherDiscordId)).toBeNull();
    });

    it('restricts a user with no database row to public personalities only', async () => {
      expect(await loader.loadFromDatabase(privId, '444444444444444444')).toBeNull();
      const publicOne = await loader.loadFromDatabase(pubId, '444444444444444444');
      expect(publicOne?.id).toBe(pubId);
    });

    it('applies no filter on internal calls (no userId)', async () => {
      const personality = await loader.loadFromDatabase(privId);
      expect(personality?.id).toBe(privId);
    });
  });

  describe('loadGlobalDefaultConfig — AdminSettings pointer', () => {
    it('returns null while the pointer is unset', async () => {
      await prisma.adminSettings.upsert({
        where: { id: ADMIN_SETTINGS_SINGLETON_ID },
        create: { id: ADMIN_SETTINGS_SINGLETON_ID },
        update: { globalDefaultLlmConfigId: null },
      });

      expect(await loader.loadGlobalDefaultConfig()).toBeNull();
    });

    it('resolves the pointer relation and maps advancedParameters', async () => {
      await prisma.adminSettings.upsert({
        where: { id: ADMIN_SETTINGS_SINGLETON_ID },
        create: { id: ADMIN_SETTINGS_SINGLETON_ID, globalDefaultLlmConfigId: globalCfgId },
        update: { globalDefaultLlmConfigId: globalCfgId },
      });

      const config = await loader.loadGlobalDefaultConfig();
      expect(config?.model).toBe('anthropic/claude-haiku-4.5');
      expect(config?.temperature).toBe(0.4);
    });
  });

  describe('loadAllFromDatabase', () => {
    it('returns every personality including private ones (internal operation)', async () => {
      const all = await loader.loadAllFromDatabase();
      const ids = all.map(p => p.id);
      expect(ids).toContain(pubId);
      expect(ids).toContain(privId);
    });
  });
});
