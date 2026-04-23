/**
 * Integration test: Identity provisioning invariant
 *
 * Covers the `c88ae5b7` regression class — persona data being stale or
 * incorrect after a user is provisioned. The regression shipped in 2025-12
 * when user creation was centralized through `UserService.getOrCreateUser`;
 * it produced wrong `activePersonaId` / `activePersonaName` values in
 * downstream prompt generation, because `PersonaResolver.resolve` could
 * return data that didn't match what `getOrCreateUser` had just created.
 *
 * This test pins the integration contract between the two services: after
 * provisioning a user via `getOrCreateUser`, a subsequent `resolve` call
 * MUST return the same persona ID that was attached to the user during
 * provisioning, regardless of call ordering (HTTP-first vs. Discord-first).
 *
 * The test exercises the real services against a real Postgres-compatible
 * engine (PGlite), so any regression in the Prisma query paths, persona
 * auto-creation invariants, or persona-resolver cache coherence will
 * produce a loud failure here — which is the explicit goal of Phase 6 of
 * the Identity & Provisioning Hardening epic.
 *
 * Phase 6 goal (epic-identity-hardening.md): "The c88ae5b7 class of
 * regression fails loudly in tests."
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { createTestPGlite, loadPGliteSchema } from '@tzurot/test-utils';
import { PrismaClient } from './prisma.js';
import { UserService } from './UserService.js';
import { PersonaResolver } from './resolvers/PersonaResolver.js';

describe('Identity provisioning integration (c88ae5b7 regression guard)', () => {
  let prisma: PrismaClient;
  let pglite: PGlite;
  let userService: UserService;
  let personaResolver: PersonaResolver;

  const TEST_PERSONALITY_ID = '00000000-0000-0000-0000-000000000003';
  const SYSTEM_PROMPT_ID = '00000000-0000-0000-0000-000000000004';
  const BOT_OWNER_USER_ID = '00000000-0000-0000-0000-000000000001';
  const BOT_OWNER_PERSONA_ID = '00000000-0000-0000-0000-000000000002';

  beforeAll(async () => {
    pglite = createTestPGlite();
    await pglite.exec(loadPGliteSchema());
    const adapter = new PrismaPGlite(pglite);
    prisma = new PrismaClient({ adapter }) as PrismaClient;

    // A personality row needs an owner user. Seed a bot-owner user + default
    // persona via the atomic CTE helper (personas and users have mutually
    // circular FKs post-Phase-5b; direct prisma.user.create no longer works).
    //
    // Inlined rather than importing `seedUserWithPersona` from `@tzurot/test-utils`
    // because that package currently can't be a runtime dep of common-types
    // without reopening the Turbo build-DAG cycle flagged in Phase 5c work
    // items. The CTE below is the same SQL the helper uses.
    await prisma.$executeRawUnsafe(`
      WITH new_persona AS (
        INSERT INTO personas (id, name, preferred_name, description, content, owner_id, updated_at)
        VALUES ('${BOT_OWNER_PERSONA_ID}', 'Owner', 'Owner', 'Bot owner', '', '${BOT_OWNER_USER_ID}', NOW())
        RETURNING id
      ),
      new_user AS (
        INSERT INTO users (id, discord_id, username, is_superuser, default_persona_id, updated_at)
        VALUES ('${BOT_OWNER_USER_ID}', 'owner-discord-id', 'owner', false, '${BOT_OWNER_PERSONA_ID}', NOW())
        RETURNING id
      )
      SELECT 1
    `);

    // Seed the personality rows. PersonaResolver.resolve needs a valid
    // personality to resolve against, but doesn't care about the specific
    // fields — just that the row exists and has a valid owner.
    await prisma.$executeRawUnsafe(`
      INSERT INTO system_prompts (id, name, content, updated_at)
      VALUES ('${SYSTEM_PROMPT_ID}', 'Test Prompt', 'test', NOW())
    `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO personalities (id, name, slug, system_prompt_id, character_info, personality_traits, owner_id, updated_at)
      VALUES ('${TEST_PERSONALITY_ID}', 'TestBot', 'testbot', '${SYSTEM_PROMPT_ID}', 'A test bot', 'Helpful', '${BOT_OWNER_USER_ID}', NOW())
    `);

    userService = new UserService(prisma);
    // cacheTtlMs: 0 disables PersonaResolver's in-memory cache so tests
    // exercise the real resolution path every call. The cache is the
    // safe-by-default for prod (hit rate > 95%) but hides the provisioning
    // integration we want to pin here.
    personaResolver = new PersonaResolver(prisma, { cacheTtlMs: 0 });
  }, 30000);

  afterAll(async () => {
    await prisma.$disconnect();
    await pglite.close();
  }, 30000);

  beforeEach(async () => {
    // Each test creates its own user. Preserve the bot-owner seeded in beforeAll.
    // Relies on `personas.owner_id → users.id` being `ON DELETE CASCADE` so
    // deleting the user transitively cleans up owned personas; the user row's
    // own `default_persona_id → personas.id` RESTRICT check passes because the
    // referencing row is being deleted in the same statement.
    await prisma.$executeRawUnsafe(`
      DELETE FROM users WHERE discord_id != 'owner-discord-id'
    `);
  });

  // Note: "HTTP-first" and "Discord-first" below exercise the same
  // `UserService.getOrCreateUser` entry point — both provisioning paths
  // converge on that method in prod. The labels document intent (which
  // side initiated the provisioning flow) rather than separate code paths.
  // The cross-path-consistency block below is what verifies ordering doesn't
  // matter at the data level.

  describe('HTTP-first provisioning path', () => {
    // Simulates api-gateway's requireProvisionedUser middleware: a user who
    // has never interacted via Discord but hits an HTTP endpoint first,
    // triggering provisioning from the HTTP side.
    it('resolves the same persona that getOrCreateUser just created', async () => {
      const discordId = 'http-first-111';
      const username = 'httpuser';

      const provisioned = await userService.getOrCreateUser(discordId, username, 'HTTP User');
      expect(provisioned).not.toBeNull();
      expect(provisioned!.defaultPersonaId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );

      // Simulates a subsequent Discord interaction that reaches bot-client's
      // resolveUserContext — it calls PersonaResolver.resolve with the
      // user's Discord ID and the target personality's ID.
      const resolved = await personaResolver.resolve(discordId, TEST_PERSONALITY_ID);

      // The c88ae5b7 regression: `resolved.config.personaId` was sometimes
      // different from `provisioned.defaultPersonaId`, because the resolver
      // was not consistent with what getOrCreateUser had materialized.
      // That produced wrong persona attribution in downstream prompts.
      expect(resolved.config.personaId).toBe(provisioned!.defaultPersonaId);
    });
  });

  describe('Discord-first provisioning path', () => {
    // Simulates the reverse ordering: a user @-mentions the bot in Discord
    // before ever hitting an HTTP endpoint. Provisioning happens from the
    // bot-client side.
    it('resolves consistently after Discord-side provisioning', async () => {
      const discordId = 'discord-first-222';
      const username = 'discorduser';

      // Discord-side provisioning goes through the same UserService path;
      // the distinction from HTTP-first is really just "which call ran first."
      // Both sides must produce the same end state.
      const provisioned = await userService.getOrCreateUser(discordId, username, 'Discord User');
      expect(provisioned).not.toBeNull();

      const resolved = await personaResolver.resolve(discordId, TEST_PERSONALITY_ID);
      expect(resolved.config.personaId).toBe(provisioned!.defaultPersonaId);
    });
  });

  describe('cross-path consistency', () => {
    // Pins the invariant that path ordering doesn't matter: the same Discord
    // user, provisioned once by either side and subsequently looked up by
    // both, always resolves to the same persona.
    it('returns the same persona ID across multiple resolve calls', async () => {
      const discordId = 'consist-user-333';
      const provisioned = await userService.getOrCreateUser(discordId, 'consistuser', 'Consist');
      expect(provisioned).not.toBeNull();

      const first = await personaResolver.resolve(discordId, TEST_PERSONALITY_ID);
      const second = await personaResolver.resolve(discordId, TEST_PERSONALITY_ID);
      const third = await personaResolver.resolve(discordId, TEST_PERSONALITY_ID);

      expect(second.config.personaId).toBe(first.config.personaId);
      expect(third.config.personaId).toBe(first.config.personaId);
      expect(first.config.personaId).toBe(provisioned!.defaultPersonaId);
    });

    // Pins the invariant that `getOrCreateUser` is idempotent on the
    // provisioning identity — calling it again after a user exists must
    // return the same userId and defaultPersonaId, not re-provision.
    it('returns stable user and persona IDs on repeated getOrCreateUser calls', async () => {
      const discordId = 'idem-user-444';

      const first = await userService.getOrCreateUser(discordId, 'idempuser', 'First Name');
      const second = await userService.getOrCreateUser(discordId, 'idempuser', 'Second Name');

      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(second!.userId).toBe(first!.userId);
      expect(second!.defaultPersonaId).toBe(first!.defaultPersonaId);
    });
  });

  describe('bot rejection', () => {
    // Phase 2 invariant (post-c88ae5b7): UserService rejects bot users at
    // the provisioning boundary so no persona gets associated with a bot
    // account. This test pins the rejection contract at the integration
    // seam rather than relying on the unit test alone.
    it('returns null when isBot is true — no user or persona created', async () => {
      const discordId = 'bot-user-555';

      const result = await userService.getOrCreateUser(
        discordId,
        'botuser',
        'Bot',
        undefined,
        true
      );
      expect(result).toBeNull();

      const userRow = await prisma.user.findUnique({ where: { discordId } });
      expect(userRow).toBeNull();
    });
  });
});
