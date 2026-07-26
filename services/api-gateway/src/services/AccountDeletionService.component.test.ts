/**
 * Component test: the zero-residue proof for account deletion over REAL
 * PGLite. Seeds a two-user graph covering every deletion mechanism — FK
 * cascade (personas, owned characters), the case-insensitive entity-tag
 * fact sweep, both pending_memories arms, loose-keyed diagnostic logs, and
 * SetNull audit columns — then asserts the target user leaves NOTHING
 * behind while the survivor's data is untouched.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import { createTestPGlite, loadPGliteSchema, seedUserWithPersona } from '@tzurot/test-utils';
import { generateUserUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { ORPHAN_SENTINEL_DISCORD_ID } from '@tzurot/common-types/constants/persona';
import {
  AccountDeletionService,
  RetentionIneligibleError,
  SuperuserDeletionError,
} from './AccountDeletionService.js';

const USER_A = 'de1e0000-0000-4000-8000-0000000000a1';
const PERSONA_A = 'de1e0000-0000-4000-8000-0000000000a2';
const PERSONA_A2 = 'de1e0000-0000-4000-8000-0000000000a3';
const USER_B = 'de1e0000-0000-4000-8000-0000000000b1';
const PERSONA_B = 'de1e0000-0000-4000-8000-0000000000b2';
const PERSONALITY_X = 'de1e0000-0000-4000-8000-0000000000c1'; // owned by A, co-owned by B
const PERSONALITY_Y = 'de1e0000-0000-4000-8000-0000000000c2'; // owned by B
const DISCORD_A = '900000000000000071';
const DISCORD_B = '900000000000000072';

let seq = 0;
const nextId = (): string =>
  `de1e0000-0000-4000-8000-0000000001${(seq++).toString().padStart(2, '0')}`;

describe('AccountDeletionService (component, PGLite)', () => {
  let pglite: PGlite;
  let prisma: PrismaClient;
  let service: AccountDeletionService;

  beforeAll(async () => {
    pglite = createTestPGlite();
    await pglite.exec(loadPGliteSchema());
    prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) }) as PrismaClient;
    service = new AccountDeletionService(prisma);

    await seedUserWithPersona(prisma, {
      userId: USER_A,
      personaId: PERSONA_A,
      discordId: DISCORD_A,
      username: 'zeroresalice',
      personaName: 'Alice Persona',
      personaPreferredName: 'Allie',
      personaContent: 'Persona A content',
    });
    await prisma.persona.create({
      data: {
        id: PERSONA_A2,
        name: 'Second Self',
        content: 'Persona A2 content',
        ownerId: USER_A,
      },
    });
    await seedUserWithPersona(prisma, {
      userId: USER_B,
      personaId: PERSONA_B,
      discordId: DISCORD_B,
      username: 'zeroresbob',
      personaName: 'Bob Persona',
      personaPreferredName: 'Bob',
      personaContent: 'Persona B content',
    });

    // X owned by A (co-owned by B); Y owned by B.
    await prisma.$executeRaw`
      INSERT INTO personalities (id, name, slug, character_info, personality_traits, owner_id, updated_at)
      VALUES (${PERSONALITY_X}::uuid, 'XBot', 'xbot', 'X character', 'Curious', ${USER_A}::uuid, NOW()),
             (${PERSONALITY_Y}::uuid, 'YBot', 'ybot', 'Y character', 'Reserved', ${USER_B}::uuid, NOW())
    `;
    await prisma.personalityOwner.createMany({
      data: [
        { personalityId: PERSONALITY_X, userId: USER_A },
        { personalityId: PERSONALITY_X, userId: USER_B },
      ],
    });
    await prisma.personalityAlias.create({
      data: { id: nextId(), personalityId: PERSONALITY_X, alias: 'xb' },
    });

    // History in three scopes: A×X and A×Y die with A's personas; B×X dies
    // with the X cascade even though it belongs to B's persona.
    await prisma.conversationHistory.createMany({
      data: [
        {
          id: nextId(),
          personaId: PERSONA_A,
          personalityId: PERSONALITY_X,
          channelId: 'chan-1',
          role: 'user',
          content: 'a-with-x',
        },
        {
          id: nextId(),
          personaId: PERSONA_A,
          personalityId: PERSONALITY_Y,
          channelId: 'chan-2',
          role: 'user',
          content: 'a-with-y',
        },
        {
          id: nextId(),
          personaId: PERSONA_B,
          personalityId: PERSONALITY_X,
          channelId: 'chan-3',
          role: 'user',
          content: 'b-with-x',
        },
      ],
    });

    // Memories: locked + soft-deleted rows must die too (erasure beats
    // protection flags); B's PB×Y memory with A in senders SURVIVES
    // (owner-decided: other users' group memories keep their content).
    await prisma.memory.createMany({
      data: [
        {
          id: nextId(),
          personaId: PERSONA_A,
          personalityId: PERSONALITY_X,
          content: 'a-locked',
          senders: ['alice'],
          isLocked: true,
        },
        {
          id: nextId(),
          personaId: PERSONA_A,
          personalityId: PERSONALITY_X,
          content: 'a-softdel',
          senders: ['alice'],
          visibility: 'deleted',
        },
        {
          id: nextId(),
          personaId: PERSONA_B,
          personalityId: PERSONALITY_X,
          content: 'b-with-x-memory',
          senders: ['bob'],
        },
        {
          id: nextId(),
          personaId: PERSONA_B,
          personalityId: PERSONALITY_Y,
          content: 'group-moment',
          senders: ['bob', 'zeroresalice'],
        },
      ],
    });

    // Facts: PA-scoped (incl. forgotten) die by cascade; A-tagged facts under
    // PB×Y (exact-lower AND case-variant) die by the tag sweep; the
    // NULL-persona A-tagged fact dies by the sweep; B's own fact survives.
    await prisma.memoryFact.createMany({
      data: [
        {
          id: nextId(),
          personaId: PERSONA_A,
          personalityId: PERSONALITY_X,
          statement: 'a fact',
          entityTags: ['user:zeroresalice'],
        },
        {
          id: nextId(),
          personaId: PERSONA_A,
          personalityId: PERSONALITY_X,
          statement: 'a forgotten fact',
          entityTags: [],
          forgotten: true,
        },
        {
          id: nextId(),
          personaId: PERSONA_B,
          personalityId: PERSONALITY_Y,
          statement: 'about alice exact',
          entityTags: ['user:alice persona'],
        },
        {
          id: nextId(),
          personaId: PERSONA_B,
          personalityId: PERSONALITY_Y,
          statement: 'about alice case-variant',
          entityTags: ['User:ALLIE'],
        },
        {
          id: nextId(),
          personaId: PERSONA_B,
          personalityId: PERSONALITY_Y,
          statement: 'about bob only',
          entityTags: ['user:bob persona'],
        },
        {
          id: nextId(),
          personaId: null,
          personalityId: PERSONALITY_Y,
          statement: 'world fact about alice',
          entityTags: ['user:zeroresalice', 'topic:tea'],
        },
      ],
    });

    // pending_memories: PA-scoped (arm 1), X-scoped under B's persona
    // (arm 2 — orphaned against a dead character without it), PB×Y survives.
    await prisma.pendingMemory.createMany({
      data: [
        {
          id: nextId(),
          personaId: PERSONA_A,
          personalityId: PERSONALITY_X,
          text: 'pending-a',
          metadata: {},
        },
        {
          id: nextId(),
          personaId: PERSONA_B,
          personalityId: PERSONALITY_X,
          text: 'pending-b-x',
          metadata: {},
        },
        {
          id: nextId(),
          personaId: PERSONA_B,
          personalityId: PERSONALITY_Y,
          text: 'pending-b-y',
          metadata: {},
        },
      ],
    });

    // Diagnostic logs key on the loose Discord-ID string.
    await prisma.llmDiagnosticLog.createMany({
      data: [
        {
          requestId: 'req-a-1',
          userId: DISCORD_A,
          model: 'm',
          provider: 'p',
          durationMs: 1,
          data: {},
        },
        {
          requestId: 'req-b-1',
          userId: DISCORD_B,
          model: 'm',
          provider: 'p',
          durationMs: 1,
          data: {},
        },
      ],
    });

    // Every user-FK table populated for A.
    await prisma.userApiKey.create({
      data: {
        id: nextId(),
        userId: USER_A,
        provider: 'openrouter',
        iv: 'iv',
        content: 'ct',
        tag: 'tg',
      },
    });
    await prisma.userCredential.create({
      data: {
        id: nextId(),
        userId: USER_A,
        service: 'shapes_inc',
        credentialType: 'session_cookie',
        iv: 'iv',
        content: 'ct',
        tag: 'tg',
      },
    });
    await prisma.exportJob.create({
      data: {
        id: nextId(),
        userId: USER_A,
        sourceSlug: 'account',
        sourceService: 'account',
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    await prisma.importJob.create({
      data: {
        id: nextId(),
        userId: USER_A,
        sourceSlug: 'someshape',
        sourceService: 'shapes_inc',
        personalityId: PERSONALITY_X,
      },
    });
    await prisma.usageLog.create({
      data: {
        id: nextId(),
        userId: USER_A,
        provider: 'openrouter',
        model: 'test/model',
        tokensIn: 1,
        tokensOut: 2,
        requestType: 'chat',
      },
    });
    const releaseId = nextId();
    await prisma.releaseAnnouncement.create({
      data: {
        id: releaseId,
        version: 'v0.0.0-zerores',
        level: 'patch',
        githubReleaseId: '1',
        body: 'notes',
      },
    });
    await prisma.releaseDeliveryLog.create({
      data: { id: nextId(), releaseId, userId: USER_A },
    });
    await prisma.userFeedback.create({
      data: { id: nextId(), userId: USER_A, content: 'bye', contentHash: 'h1' },
    });
    await prisma.llmConfig.create({
      data: { id: nextId(), name: 'a-config', ownerId: USER_A, model: 'test/model' },
    });
    await prisma.ttsConfig.create({
      data: { id: nextId(), name: 'a-tts', ownerId: USER_A, provider: 'self-hosted' },
    });
    await prisma.userPersonalityConfig.create({
      data: { id: nextId(), userId: USER_A, personalityId: PERSONALITY_Y },
    });
    await prisma.shapesPersonaMapping.create({
      data: { id: nextId(), shapesUserId: nextId(), personaId: PERSONA_A },
    });

    // SetNull audit columns: rows survive, attribution nulls out.
    await prisma.channelSettings.create({
      data: { id: nextId(), channelId: 'chan-set-1', createdBy: USER_A },
    });
    await prisma.adminSettings.create({
      data: { id: nextId(), updatedBy: USER_A },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pglite.close();
  });

  it('preview reports counts, per-character reach, and the fixed phrase', async () => {
    const preview = await service.preview(USER_A);

    expect(preview.confirmationPhrase).toBe('DELETE MY ACCOUNT');
    expect(preview.counts.personas).toBe(2);
    expect(preview.counts.characters).toBe(1);
    // A×X + A×Y (persona arm) + B×X (owned-character arm)
    expect(preview.counts.conversationMessages).toBe(3);
    // PA locked + PA soft-deleted + PB×X (owned-character arm)
    expect(preview.counts.memories).toBe(3);
    expect(preview.hasActiveExport).toBe(true);
    // B's persona holds memories with X → reach of exactly one other user.
    expect(preview.ownedCharacters).toEqual([
      expect.objectContaining({ name: 'XBot', otherUsersWithMemories: 1 }),
    ]);
  });

  it('erases the account with zero residue while the survivor keeps everything', async () => {
    const summary = await service.deleteAccount(USER_A, DISCORD_A, 'self-serve');

    // --- Summary numbers match the seed ---
    expect(summary.personas).toBe(2);
    expect(summary.characters).toBe(1);
    expect(summary.characterNames).toEqual(['XBot']);
    expect(summary.characterSlugs).toEqual(['xbot']);
    expect(summary.conversationMessages).toBe(3);
    expect(summary.memories).toBe(3);
    // Persona/character-scoped facts: 2 PA + 0 others in scope
    expect(summary.facts).toBe(2);
    // Tag sweep: exact-lower + case-variant under PB×Y + null-persona world fact
    // + A's own tagged fact (in scope AND tagged; sweep runs first)
    expect(summary.factsSweptByTag).toBe(4);
    expect(summary.pendingMemories).toBe(2);
    expect(summary.diagnosticLogs).toBe(1);

    // --- Zero residue for A ---
    expect(await prisma.user.findUnique({ where: { id: USER_A } })).toBeNull();
    expect(await prisma.persona.count({ where: { ownerId: USER_A } })).toBe(0);
    expect(await prisma.personality.findUnique({ where: { id: PERSONALITY_X } })).toBeNull();
    expect(await prisma.personalityAlias.count({ where: { personalityId: PERSONALITY_X } })).toBe(
      0
    );
    expect(await prisma.personalityOwner.count({ where: { personalityId: PERSONALITY_X } })).toBe(
      0
    );
    expect(
      await prisma.conversationHistory.count({
        where: {
          OR: [{ personaId: { in: [PERSONA_A, PERSONA_A2] } }, { personalityId: PERSONALITY_X }],
        },
      })
    ).toBe(0);
    expect(
      await prisma.memory.count({
        where: {
          OR: [{ personaId: { in: [PERSONA_A, PERSONA_A2] } }, { personalityId: PERSONALITY_X }],
        },
      })
    ).toBe(0);
    // No A-tagged fact survives ANYWHERE (any scope, any case).
    const remainingFacts = await prisma.memoryFact.findMany({
      select: { statement: true, entityTags: true },
    });
    for (const fact of remainingFacts) {
      const lowered = fact.entityTags.map(tag => tag.toLowerCase());
      expect(lowered).not.toContain('user:zeroresalice');
      expect(lowered).not.toContain('user:alice persona');
      expect(lowered).not.toContain('user:allie');
    }
    expect(await prisma.pendingMemory.count({ where: { personalityId: PERSONALITY_X } })).toBe(0);
    expect(
      await prisma.pendingMemory.count({ where: { personaId: { in: [PERSONA_A, PERSONA_A2] } } })
    ).toBe(0);
    expect(await prisma.llmDiagnosticLog.count({ where: { userId: DISCORD_A } })).toBe(0);
    expect(await prisma.userApiKey.count({ where: { userId: USER_A } })).toBe(0);
    expect(await prisma.userCredential.count({ where: { userId: USER_A } })).toBe(0);
    expect(await prisma.exportJob.count({ where: { userId: USER_A } })).toBe(0);
    expect(await prisma.importJob.count({ where: { userId: USER_A } })).toBe(0);
    expect(await prisma.userFeedback.count({ where: { userId: USER_A } })).toBe(0);
    expect(await prisma.userPersonalityConfig.count({ where: { userId: USER_A } })).toBe(0);
    expect(await prisma.usageLog.count({ where: { userId: USER_A } })).toBe(0);
    expect(await prisma.releaseDeliveryLog.count({ where: { userId: USER_A } })).toBe(0);
    expect(await prisma.llmConfig.count({ where: { ownerId: USER_A } })).toBe(0);
    expect(await prisma.ttsConfig.count({ where: { ownerId: USER_A } })).toBe(0);
    expect(await prisma.shapesPersonaMapping.count({ where: { personaId: PERSONA_A } })).toBe(0);

    // --- Survivors: B's world is intact ---
    expect(await prisma.user.findUnique({ where: { id: USER_B } })).not.toBeNull();
    expect(await prisma.personality.findUnique({ where: { id: PERSONALITY_Y } })).not.toBeNull();
    const groupMemory = await prisma.memory.findFirst({ where: { content: 'group-moment' } });
    expect(groupMemory).not.toBeNull();
    expect(groupMemory?.senders).toContain('zeroresalice');
    expect(await prisma.memoryFact.count({ where: { statement: 'about bob only' } })).toBe(1);
    expect(
      await prisma.pendingMemory.count({
        where: { personaId: PERSONA_B, personalityId: PERSONALITY_Y },
      })
    ).toBe(1);
    expect(await prisma.llmDiagnosticLog.count({ where: { userId: DISCORD_B } })).toBe(1);

    // --- SetNull audit columns: rows alive, attribution gone ---
    const channelSetting = await prisma.channelSettings.findUnique({
      where: { channelId: 'chan-set-1' },
    });
    expect(channelSetting).not.toBeNull();
    expect(channelSetting?.createdBy).toBeNull();
    const adminSettings = await prisma.adminSettings.findFirst();
    expect(adminSettings?.updatedBy).toBeNull();
  });

  it('refuses to delete a superuser account inside the transaction', async () => {
    await prisma.user.update({ where: { id: USER_B }, data: { isSuperuser: true } });

    await expect(service.deleteAccount(USER_B, DISCORD_B, 'self-serve')).rejects.toThrow(
      SuperuserDeletionError
    );
    // Nothing was deleted.
    expect(await prisma.user.findUnique({ where: { id: USER_B } })).not.toBeNull();
    expect(await prisma.personality.findUnique({ where: { id: PERSONALITY_Y } })).not.toBeNull();
  });
});

/**
 * Retention-mode proof (Phase 2 D11): a departed user's character that ANOTHER
 * active user uses is re-homed to the Orphaned-Characters sentinel (surviving
 * the cascade, with provenance) rather than deleted, and the other user's data
 * on it is untouched — while a solo character is deleted normally.
 */
describe('AccountDeletionService retention mode (component, PGLite)', () => {
  const USER_D = 'de1e0000-0000-4000-8000-0000000000d1'; // departed (purged)
  const PERSONA_D = 'de1e0000-0000-4000-8000-0000000000d2';
  const USER_E = 'de1e0000-0000-4000-8000-0000000000e1'; // survivor
  const PERSONA_E = 'de1e0000-0000-4000-8000-0000000000e2';
  const PERSONALITY_XR = 'de1e0000-0000-4000-8000-0000000000f1'; // shared → re-home
  const PERSONALITY_ZR = 'de1e0000-0000-4000-8000-0000000000f2'; // solo → delete
  const DISCORD_D = '900000000000000081';
  const DISCORD_E = '900000000000000082';
  const SENTINEL_ID = generateUserUuid(ORPHAN_SENTINEL_DISCORD_ID);

  let rseq = 0;
  const rid = (): string =>
    `de1e0000-0000-4000-8000-0000000002${(rseq++).toString().padStart(2, '0')}`;

  let pglite: PGlite;
  let prisma: PrismaClient;
  let service: AccountDeletionService;

  beforeAll(async () => {
    pglite = createTestPGlite();
    await pglite.exec(loadPGliteSchema());
    prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) }) as PrismaClient;
    service = new AccountDeletionService(prisma);

    await seedUserWithPersona(prisma, {
      userId: USER_D,
      personaId: PERSONA_D,
      discordId: DISCORD_D,
      username: 'departeddana',
      personaName: 'Dana Persona',
      personaContent: 'Persona D content',
    });
    await seedUserWithPersona(prisma, {
      userId: USER_E,
      personaId: PERSONA_E,
      discordId: DISCORD_E,
      username: 'survivorevan',
      personaName: 'Evan Persona',
      personaContent: 'Persona E content',
    });

    // Both owned by D. XR is used by E (cross-user reach); ZR by no one else.
    // XR seeded with an OLD updated_at so the re-home's @updatedAt bump is
    // unambiguous (proves the write goes through the Prisma client, not raw SQL —
    // the sync-LWW-safety fix).
    await prisma.$executeRaw`
      INSERT INTO personalities (id, name, slug, character_info, personality_traits, owner_id, updated_at)
      VALUES (${PERSONALITY_XR}::uuid, 'Shared', 'shared-xr', 'shared char', 'Warm', ${USER_D}::uuid, '2020-01-01T00:00:00Z'),
             (${PERSONALITY_ZR}::uuid, 'Solo', 'solo-zr', 'solo char', 'Quiet', ${USER_D}::uuid, NOW())
    `;

    // D must actually BE purge-eligible: retention mode re-checks the predicate
    // inside the transaction (D4), so an unstamped user is refused. Raw SQL for
    // the same reason production uses it — these columns stay off updated_at.
    await prisma.$executeRaw`
      UPDATE users
      SET dm_undeliverable_since = '2020-01-01T00:00:00Z',
          last_active_at = '2020-01-01T00:00:00Z'
      WHERE id = ${USER_D}::uuid
    `;

    await prisma.memory.createMany({
      data: [
        // E's memory on the shared char — must SURVIVE the purge (other user's data).
        {
          id: rid(),
          personaId: PERSONA_E,
          personalityId: PERSONALITY_XR,
          content: 'e-with-xr',
          senders: ['survivorevan'],
        },
        // D's own memory on the shared char — dies with D (persona-arm sweep).
        {
          id: rid(),
          personaId: PERSONA_D,
          personalityId: PERSONALITY_XR,
          content: 'd-with-xr',
          senders: ['departeddana'],
        },
        // D's memory on the solo char — dies with D (the char cascades too).
        {
          id: rid(),
          personaId: PERSONA_D,
          personalityId: PERSONALITY_ZR,
          content: 'd-with-zr',
          senders: ['departeddana'],
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pglite.close();
  });

  it('re-homes the cross-user character, deletes the solo one, and spares the other user', async () => {
    const summary = await service.deleteAccount(USER_D, DISCORD_D, 'retention');

    // Only the solo character is reported deleted; the shared one is re-homed.
    expect(summary.characters).toBe(1);
    expect(summary.characterIds).toEqual([PERSONALITY_ZR]);
    expect(summary.characterNames).toEqual(['Solo']);

    // Shared character SURVIVES, re-homed to the sentinel with reclamation provenance.
    const xr = await prisma.personality.findUnique({ where: { id: PERSONALITY_XR } });
    expect(xr).not.toBeNull();
    expect(xr?.ownerId).toBe(SENTINEL_ID);
    expect(xr?.originalOwnerDiscordId).toBe(DISCORD_D);
    // The re-home bumped updated_at (Prisma @updatedAt) past the seeded old value
    // — so the change wins the dev<->prod sync LWW and can't be silently reverted.
    // A raw-SQL re-home would leave the seeded timestamp untouched and fail this.
    expect(xr?.updatedAt.getTime()).toBeGreaterThan(new Date('2020-06-01T00:00:00Z').getTime());

    // Solo character is gone (cascaded with the departed owner).
    expect(await prisma.personality.findUnique({ where: { id: PERSONALITY_ZR } })).toBeNull();

    // The other user's memory on the survivor is intact; the departed user's is gone.
    expect(await prisma.memory.count({ where: { content: 'e-with-xr' } })).toBe(1);
    expect(await prisma.memory.count({ where: { personaId: PERSONA_D } })).toBe(0);

    // The departed user is fully erased.
    expect(await prisma.user.findUnique({ where: { id: USER_D } })).toBeNull();
    expect(await prisma.persona.count({ where: { ownerId: USER_D } })).toBe(0);

    // The sentinel exists, is retention-exempt (never re-purged), and is NOT a superuser.
    const sentinel = await prisma.user.findUnique({ where: { id: SENTINEL_ID } });
    expect(sentinel).not.toBeNull();
    expect(sentinel?.retentionExempt).toBe(true);
    expect(sentinel?.isSuperuser).toBe(false);

    // The audit row committed WITH the deletion (D14). It survives the cascade
    // because retention_purge_log has no FK to users — which is the whole point:
    // the ledger has to outlive the row it describes.
    const audit = await prisma.retentionPurgeLog.findMany();
    expect(audit).toHaveLength(1);
    expect(audit[0]?.targetDiscordId).toBe(DISCORD_D);
    expect(audit[0]?.dbOutcome).toBe('success');
    // Only the DELETED character's slug is queued for the off-DB avatar unlink —
    // the re-homed survivor keeps its avatar, so listing it here would delete a
    // live character's image.
    expect(audit[0]?.offDbPending).toEqual({ characterSlugs: ['solo-zr'] });
    expect(summary.auditLogId).toBe(audit[0]?.id);
  });

  it('REFUSES a user who is no longer eligible, leaving them fully intact', async () => {
    // The TOCTOU close (D4): between the preview that selected a cohort and the
    // purge that acts on it, a user can come back. E is reachable and active, so
    // the in-transaction re-check must roll the whole erasure back.
    await expect(service.deleteAccount(USER_E, DISCORD_E, 'retention')).rejects.toThrow(
      RetentionIneligibleError
    );

    expect(await prisma.user.findUnique({ where: { id: USER_E } })).not.toBeNull();
    expect(await prisma.persona.count({ where: { ownerId: USER_E } })).toBe(1);
    expect(await prisma.memory.count({ where: { content: 'e-with-xr' } })).toBe(1);
    // No ledger row either — an aborted purge is not a purge.
    expect(await prisma.retentionPurgeLog.count()).toBe(1);
  });
});
