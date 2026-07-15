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
import { createTestPGlite, loadPGliteSchema, seedUserWithPersona } from '@tzurot/test-utils';
import { assembleAccountExport } from './AccountExportAssembler.js';

const USER_A = 'ac0e0000-0000-4000-8000-0000000000a1';
const PERSONA_A = 'ac0e0000-0000-4000-8000-0000000000a2';
const USER_B = 'ac0e0000-0000-4000-8000-0000000000b1';
const PERSONA_B = 'ac0e0000-0000-4000-8000-0000000000b2';
const SYSTEM_PROMPT = 'ac0e0000-0000-4000-8000-0000000000c1';
const PERSONALITY_X = 'ac0e0000-0000-4000-8000-0000000000c2';
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
    expect(payload.characters.map(c => (c as { id: string }).id)).toEqual([PERSONALITY_X]);
    expect(payload.conversationHistory).toHaveLength(1);
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

  it('never includes secret material in the serialized payload', async () => {
    const payload = await assembleAccountExport(prisma, USER_A);
    const serialized = JSON.stringify(payload);

    expect(serialized).not.toContain(SECRET_VALUE);
    expect(serialized).not.toContain('test-iv');
    expect(serialized).not.toContain('cred-iv');
    // The meta.notes disclose the exclusions.
    expect(payload.meta.notes.join(' ')).toContain('secret material is never exported');
  });
});
