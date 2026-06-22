/**
 * Component test: `ContextAssembler.assembleCore` against REAL PGLite.
 *
 * This un-stubs what `AIJobProcessor.int.test.ts` deliberately skips — that test
 * stubs the ENTIRE ContextStep because the real assembler reads Prisma, which its
 * harness didn't wire. Here we wire the REAL `PrismaContextDataSource` +
 * `UserService` + `PersonaResolver` over PGLite, seed real users/personas/history,
 * and assert the assembler re-derives the core surfaces from actual DB state.
 *
 * This is the real-data third of the producer→schema→consumer contract that the
 * 2.5d Prisma-eviction epic deleted bot-client code against on the claim "the
 * worker re-derives identical context from rawAssemblyInputs":
 *  - producer half  → RawEnvelopeBuilder.test.ts (real builder conforms to schema)
 *  - mocked consumer → ContextAssembler.test.ts (assembleCore over faithful doubles)
 *  - real consumer   → THIS FILE (assembleCore over real PGLite)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  MessageRole,
  PrismaClient,
  generateUserUuid,
  generatePersonaUuid,
  generatePersonalityUuid,
  generateSystemPromptUuid,
  generateConversationHistoryUuid,
  rawAssemblyInputsSchema,
  type JobContext,
  type LoadedPersonality,
} from '@tzurot/common-types';
import { UserService, PersonaResolver } from '@tzurot/identity';
import type { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { createTestPGlite, loadPGliteSchema, seedUserWithPersona } from '@tzurot/test-utils';
import { ContextAssembler } from './ContextAssembler.js';
import { PrismaContextDataSource } from './PrismaContextDataSource.js';

const DISCORD_USER_ID = '123456789012345678';
const CHANNEL_ID = 'test-channel-987';
const GUILD_ID = 'test-guild-654';

describe('ContextAssembler.assembleCore — PGLite component', () => {
  let prisma: PrismaClient;
  let pglite: PGlite;
  let assembler: ContextAssembler;
  let userId: string;
  let personaId: string;
  let personalityId: string;
  let personality: LoadedPersonality;

  beforeAll(async () => {
    pglite = createTestPGlite();
    await pglite.exec(loadPGliteSchema());
    prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) }) as PrismaClient;

    // User + default persona (Phase 5b: the pair must be created atomically).
    userId = generateUserUuid(DISCORD_USER_ID);
    personaId = generatePersonaUuid('test-user', userId);
    await seedUserWithPersona(prisma, {
      userId,
      personaId,
      discordId: DISCORD_USER_ID,
      username: 'test-user',
      personaName: 'test-user',
    });
    // A non-default timezone so the assembled `userTimezone` proves a REAL read,
    // not the 'UTC' fallback.
    await prisma.user.update({ where: { id: userId }, data: { timezone: 'America/New_York' } });

    const systemPrompt = await prisma.systemPrompt.create({
      data: {
        id: generateSystemPromptUuid('assembler-int-prompt'),
        name: 'assembler-int-prompt',
        content: 'You are a test assistant.',
      },
    });
    personalityId = generatePersonalityUuid('assembler-int');
    await prisma.personality.create({
      data: {
        id: personalityId,
        name: 'AssemblerIntBot',
        slug: 'assembler-int',
        displayName: 'Assembler Int Bot',
        systemPromptId: systemPrompt.id,
        ownerId: userId,
        characterInfo: 'A test bot',
        personalityTraits: 'Helpful and deterministic',
      },
    });
    personality = { id: personalityId, name: 'AssemblerIntBot' } as LoadedPersonality;

    // Two channel-history rows (chronological); getChannelHistory reads them by
    // channelId. discordMessageId lets the trigger-exclusion test target one.
    const seedTurn = async (
      content: string,
      role: MessageRole,
      createdAt: Date,
      discordMessageId: string
    ): Promise<void> => {
      await prisma.conversationHistory.create({
        data: {
          id: generateConversationHistoryUuid(CHANNEL_ID, personalityId, personaId, createdAt),
          channelId: CHANNEL_ID,
          guildId: GUILD_ID,
          personalityId,
          personaId,
          role,
          content,
          discordMessageId: [discordMessageId],
          createdAt,
        },
      });
    };
    await seedTurn('first user turn', MessageRole.User, new Date('2026-06-01T10:00:00Z'), 'dm-1');
    await seedTurn(
      'assistant reply',
      MessageRole.Assistant,
      new Date('2026-06-01T10:01:00Z'),
      'dm-2'
    );

    assembler = new ContextAssembler({
      dataSource: new PrismaContextDataSource(prisma),
      userService: new UserService(prisma),
      personaResolver: new PersonaResolver(prisma),
    });
  }, 30000);

  afterAll(async () => {
    await prisma.$disconnect();
    await pglite.close();
  }, 30000);

  function jobContext(partial: Partial<JobContext> = {}): JobContext {
    return {
      userId: DISCORD_USER_ID,
      userName: 'test-user',
      channelId: CHANNEL_ID,
      serverId: GUILD_ID,
      rawAssemblyInputs: rawAssemblyInputsSchema.parse({ rawMessageContent: 'live trigger' }),
      ...partial,
    } as JobContext;
  }

  it('re-derives core surfaces from real DB state (user, timezone, history, persona)', async () => {
    const core = await assembler.assembleCore(jobContext(), personality, undefined);

    // User upsert resolved to the SEEDED internal user row.
    expect(core.userInternalId).toBe(userId);
    // Timezone read from the real user row (proves it's not the UTC fallback).
    expect(core.userTimezone).toBe('America/New_York');
    // History hydrated from the two seeded rows.
    const contents = core.history.map(m => m.content);
    expect(contents).toContain('first user turn');
    expect(contents).toContain('assistant reply');
    // A personal summon resolves SOME persona from the DB (the seeded default).
    expect(core.activePersonaId).not.toBeNull();
    // Raw message content passes through (no mentions to rewrite).
    expect(core.messageContent).toBe('live trigger');
  });

  it('excludes the trigger message from the assembled history', async () => {
    // dm-1 is a seeded row; naming it as the trigger drops it from the assembled
    // history (the worker filters the just-persisted trigger to avoid a double).
    const core = await assembler.assembleCore(
      jobContext({ triggerMessageId: 'dm-1' }),
      personality,
      undefined
    );
    const contents = core.history.map(m => m.content);
    expect(contents).not.toContain('first user turn'); // dm-1 excluded
    expect(contents).toContain('assistant reply'); // dm-2 retained
  });
});
