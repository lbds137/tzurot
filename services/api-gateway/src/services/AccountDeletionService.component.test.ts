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
import { AccountDeletionService, SuperuserDeletionError } from './AccountDeletionService.js';

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
    const summary = await service.deleteAccount(USER_A, DISCORD_A);

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

    await expect(service.deleteAccount(USER_B, DISCORD_B)).rejects.toThrow(SuperuserDeletionError);
    // Nothing was deleted.
    expect(await prisma.user.findUnique({ where: { id: USER_B } })).not.toBeNull();
    expect(await prisma.personality.findUnique({ where: { id: PERSONALITY_Y } })).not.toBeNull();
  });
});
