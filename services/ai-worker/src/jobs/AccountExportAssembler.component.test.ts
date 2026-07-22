/**
 * Component test: account-export assembly over REAL PGLite.
 *
 * The assembler is pure DB reads, so the meaningful failure modes are
 * schema-level: a renamed column, a missed section, secret material leaking
 * into the payload, or the cursor sweep clipping rows. This test seeds a
 * two-user graph and asserts section contents, cross-user isolation, and —
 * critically — that the serialized payload never contains seeded secret
 * values.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { type PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import { ADMIN_SETTINGS_SINGLETON_ID } from '@tzurot/common-types/schemas/api/adminSettings';
import { createTestPGlite, loadPGliteSchema, seedUserWithPersona } from '@tzurot/test-utils';
import { assembleAccountExport } from './AccountExportAssembler.js';
import { buildAccountExportFiles } from './AccountExportFiles.js';

const USER_A = 'ac0e0000-0000-4000-8000-0000000000a1';
const PERSONA_A = 'ac0e0000-0000-4000-8000-0000000000a2';
const USER_B = 'ac0e0000-0000-4000-8000-0000000000b1';
const PERSONA_B = 'ac0e0000-0000-4000-8000-0000000000b2';
const SYSTEM_PROMPT = 'ac0e0000-0000-4000-8000-0000000000c1';
const PERSONALITY_X = 'ac0e0000-0000-4000-8000-0000000000c2';
const PERSONALITY_Y = 'ac0e0000-0000-4000-8000-0000000000c3';
const SECRET_VALUE = 'super-secret-encrypted-blob-DO-NOT-EXPORT';

let seq = 0;
const nextId = (): string =>
  `ac0e0000-0000-4000-8000-0000000001${(seq++).toString().padStart(2, '0')}`;

describe('assembleAccountExport (component, PGLite)', () => {
  let pglite: PGlite;
  let prisma: PrismaClient;

  beforeAll(async () => {
    pglite = createTestPGlite();
    await pglite.exec(loadPGliteSchema());
    prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) }) as PrismaClient;

    await seedUserWithPersona(prisma, {
      userId: USER_A,
      personaId: PERSONA_A,
      discordId: '900000000000000061',
      username: 'exportalice',
      personaName: 'Alice Persona',
      personaPreferredName: 'Alice',
      personaContent: 'Persona A content',
    });
    await seedUserWithPersona(prisma, {
      userId: USER_B,
      personaId: PERSONA_B,
      discordId: '900000000000000062',
      username: 'exportbob',
      personaName: 'Bob Persona',
      personaPreferredName: 'Bob',
      personaContent: 'Persona B content',
    });

    await prisma.$executeRaw`
      INSERT INTO system_prompts (id, name, content, updated_at)
      VALUES (${SYSTEM_PROMPT}::uuid, 'X Prompt', 'You are X.', NOW())
    `;
    await prisma.$executeRaw`
      INSERT INTO personalities (id, name, display_name, slug, system_prompt_id, character_info, personality_traits, owner_id, updated_at)
      VALUES (${PERSONALITY_X}::uuid, 'XBot', 'X Bot', 'xbot', ${SYSTEM_PROMPT}::uuid, 'X character', 'Curious', ${USER_A}::uuid, NOW())
    `;
    await prisma.personalityOwner.create({
      data: { personalityId: PERSONALITY_X, userId: USER_A },
    });

    // A character OWNED BY B that A merely conversed with — the personality
    // directory must cover it even though A's characters section won't.
    await prisma.$executeRaw`
      INSERT INTO personalities (id, name, slug, character_info, personality_traits, owner_id, updated_at)
      VALUES (${PERSONALITY_Y}::uuid, 'YBot', 'ybot', 'Y character', 'Reserved', ${USER_B}::uuid, NOW())
    `;
    await prisma.conversationHistory.create({
      data: {
        id: nextId(),
        personaId: PERSONA_A,
        personalityId: PERSONALITY_Y,
        channelId: 'chan-2',
        role: 'user',
        content: 'alice-line talks to a character she does not own',
      },
    });

    // Conversation history + memories + facts for BOTH users' personas.
    for (const [personaId, marker] of [
      [PERSONA_A, 'alice-line'],
      [PERSONA_B, 'bob-line'],
    ] as const) {
      await prisma.conversationHistory.create({
        data: {
          id: nextId(),
          personaId,
          personalityId: PERSONALITY_X,
          channelId: 'chan-1',
          role: 'user',
          content: `${marker} says hello`,
        },
      });
      await prisma.memory.create({
        data: {
          id: nextId(),
          personaId,
          personalityId: PERSONALITY_X,
          content: `${marker} memory content`,
          senders: [marker],
        },
      });
      await prisma.memoryFact.create({
        data: {
          id: nextId(),
          personaId,
          personalityId: PERSONALITY_X,
          statement: `${marker} fact statement`,
          entityTags: [`user:${marker}`],
        },
      });
    }

    // Secret-bearing rows for A: BYOK key + credential.
    await prisma.userApiKey.create({
      data: {
        id: nextId(),
        userId: USER_A,
        provider: 'openrouter',
        iv: 'test-iv',
        content: SECRET_VALUE,
        tag: 'test-tag',
      },
    });
    await prisma.userCredential.create({
      data: {
        id: nextId(),
        userId: USER_A,
        service: 'shapes_inc',
        credentialType: 'session_cookie',
        iv: 'cred-iv',
        content: SECRET_VALUE,
        tag: 'cred-tag',
      },
    });

    await prisma.usageLog.create({
      data: {
        id: nextId(),
        userId: USER_A,
        provider: 'openrouter',
        model: 'test/model',
        tokensIn: 10,
        tokensOut: 20,
        requestType: 'chat',
      },
    });
    await prisma.userFeedback.create({
      data: { id: nextId(), userId: USER_A, content: 'love the bot', contentHash: 'fb-hash-1' },
    });
  });

  it('assembles every section for the user, isolated from other users', async () => {
    const payload = await assembleAccountExport(prisma, USER_A);

    expect(payload.profile).toEqual(expect.objectContaining({ username: 'exportalice' }));
    expect(payload.personas).toHaveLength(1);
    expect(payload.characters.map(c => c.id)).toEqual([PERSONALITY_X]);
    expect(payload.conversationHistory).toHaveLength(2);
    expect(payload.memories).toHaveLength(1);
    expect(payload.facts).toHaveLength(1);
    expect(payload.feedback).toHaveLength(1);
    expect(payload.apiKeyMetadata).toEqual([expect.objectContaining({ provider: 'openrouter' })]);
    expect(payload.usageSummary).toEqual([
      expect.objectContaining({
        provider: 'openrouter',
        model: 'test/model',
        _sum: expect.objectContaining({ tokensIn: 10, tokensOut: 20 }),
      }),
    ]);

    // Cross-user isolation: nothing of Bob's rides along.
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('bob-line');
    expect(serialized).not.toContain('exportbob');
  });

  it('directory covers unowned characters; the file map folders their content by slug', async () => {
    const payload = await assembleAccountExport(prisma, USER_A);

    // A owns X; Y belongs to B but A conversed with it.
    expect(payload.characters.map(c => c.id)).toEqual([PERSONALITY_X]);
    expect(payload.personalityDirectory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: PERSONALITY_X, slug: 'xbot' }),
        expect.objectContaining({ id: PERSONALITY_Y, slug: 'ybot' }),
      ])
    );

    const files = buildAccountExportFiles(payload);
    expect(files['conversations/ybot.md']).toContain('does not own');
    // The unowned character gets NO definition files — only foldered content.
    expect(files['characters/ybot.json']).toBeUndefined();
    expect(files['characters/xbot.json']).toBeDefined();
  });

  it('never includes secret material anywhere in the built export files', async () => {
    const payload = await assembleAccountExport(prisma, USER_A);
    const files = buildAccountExportFiles(payload);
    const everything = Object.values(files).join('\n');

    expect(everything).not.toContain(SECRET_VALUE);
    expect(everything).not.toContain('test-iv');
    expect(everything).not.toContain('cred-iv');
    // The README discloses the exclusions.
    expect(files['README.md']).toContain('secret material is never exported');
  });

  it('exports the user config-defaults, filters dead anchor rows, and gates admin settings on superuser', async () => {
    // A user-tier config default + a GENUINELY partial override (configOverrides
    // set, no FK dependency) + a dead all-null anchor.
    await prisma.user.update({ where: { id: USER_A }, data: { configDefaults: { maxImages: 4 } } });
    const liveId = nextId();
    await prisma.userPersonalityConfig.create({
      data: {
        id: liveId,
        userId: USER_A,
        personalityId: PERSONALITY_X,
        configOverrides: { crossChannelHistoryEnabled: true },
      },
    });
    const deadId = nextId();
    await prisma.userPersonalityConfig.create({
      data: { id: deadId, userId: USER_A, personalityId: PERSONALITY_Y },
    });

    const asNormalUser = await assembleAccountExport(prisma, USER_A);
    expect((asNormalUser.profile as { configDefaults: unknown }).configDefaults).toEqual({
      maxImages: 4,
    });
    const configIds = asNormalUser.personalityConfigs.map(r => (r as { id: string }).id);
    // The genuinely-partial row survives; the all-null anchor is filtered.
    expect(configIds).toContain(liveId);
    expect(configIds).not.toContain(deadId);
    // Non-superuser: no admin settings.
    expect(asNormalUser.adminSettings).toBeNull();

    // Promote A to superuser + seed the global admin-settings singleton row.
    await prisma.user.update({ where: { id: USER_A }, data: { isSuperuser: true } });
    await prisma.$executeRaw`
      INSERT INTO admin_settings (id, system_settings, updated_at)
      VALUES (${ADMIN_SETTINGS_SINGLETON_ID}::uuid, '{"fallbackModel":"gpt"}'::jsonb, NOW())
    `;

    const asAdmin = await assembleAccountExport(prisma, USER_A);
    expect(asAdmin.adminSettings).toEqual(
      expect.objectContaining({ systemSettings: { fallbackModel: 'gpt' } })
    );
    expect(buildAccountExportFiles(asAdmin)['account/admin-settings.json']).toBeDefined();
  });
});
