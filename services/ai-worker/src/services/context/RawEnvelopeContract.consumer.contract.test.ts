/**
 * Consumer half of the bot-client→ai-worker context-assembly contract.
 *
 * Reads the SAME committed fixtures the bot-client producer test
 * (`RawEnvelopeContract.producer.test.ts`) generates, parses them through
 * `rawAssemblyInputsSchema`, and feeds them to the REAL `ContextAssembler`
 * over PGLite. The committed fixture IS the contract artifact: producer proves
 * "real output === fixture"; this proves "real consumer derives correctly from
 * that same fixture." Neither service imports the other — they share the data
 * artifact via `@tzurot/test-utils` (see `contractFixtures.ts`). This closes the
 * seam the isolated pilot tests don't cross: a field the producer emits in a
 * shape the schema permits but the consumer mishandles now fails HERE.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  PrismaClient,
  generateUserUuid,
  generatePersonaUuid,
  generatePersonalityUuid,
  generateSystemPromptUuid,
  rawAssemblyInputsSchema,
  type JobContext,
  type LoadedPersonality,
} from '@tzurot/common-types';
import { UserService, PersonaResolver } from '@tzurot/identity';
import {
  createTestPGlite,
  loadPGliteSchema,
  seedUserWithPersona,
  loadContractFixture,
} from '@tzurot/test-utils';
import type { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { ContextAssembler } from './ContextAssembler.js';
import { PrismaContextDataSource } from './PrismaContextDataSource.js';

const DISCORD_USER_ID = '123456789012345678';
const CHANNEL_ID = 'test-channel-987';
const GUILD_ID = 'test-guild-654';

/** Parse a committed contract fixture through the real wire schema. */
const fixtureEnvelope = (name: string) =>
  rawAssemblyInputsSchema.parse(loadContractFixture(`raw-assembly-inputs/${name}.json`));

describe('RawEnvelope contract — consumer derivation over PGLite', () => {
  let prisma: PrismaClient;
  let pglite: PGlite;
  let assembler: ContextAssembler;
  let userId: string;
  let personality: LoadedPersonality;

  beforeAll(async () => {
    pglite = createTestPGlite();
    await pglite.exec(loadPGliteSchema());
    prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) }) as PrismaClient;

    userId = generateUserUuid(DISCORD_USER_ID);
    await seedUserWithPersona(prisma, {
      userId,
      personaId: generatePersonaUuid('contract-user', userId),
      discordId: DISCORD_USER_ID,
      username: 'contract-user',
      personaName: 'contract-user',
    });
    await prisma.user.update({ where: { id: userId }, data: { timezone: 'America/New_York' } });

    const systemPrompt = await prisma.systemPrompt.create({
      data: {
        id: generateSystemPromptUuid('contract-prompt'),
        name: 'contract-prompt',
        content: 'You are a test assistant.',
      },
    });
    const personalityId = generatePersonalityUuid('contract-bot');
    await prisma.personality.create({
      data: {
        id: personalityId,
        name: 'ContractBot',
        slug: 'contract-bot',
        displayName: 'Contract Bot',
        systemPromptId: systemPrompt.id,
        ownerId: userId,
        characterInfo: 'A test bot',
        personalityTraits: 'Deterministic',
      },
    });
    // Only id/name are read by assembleCore here; the narrow cast is intentional
    // (mirrors ContextAssembler.component.test.ts).
    personality = { id: personalityId, name: 'ContractBot' } as LoadedPersonality;

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

  const jobContext = (rawAssemblyInputs: JobContext['rawAssemblyInputs']): JobContext =>
    ({
      userId: DISCORD_USER_ID,
      userName: 'contract-user',
      channelId: CHANNEL_ID,
      serverId: GUILD_ID,
      rawAssemblyInputs,
    }) as JobContext;

  it('base fixture: trigger content passes through + identity resolves from DB', async () => {
    const core = await assembler.assembleCore(
      jobContext(fixtureEnvelope('base')),
      personality,
      undefined
    );

    // The producer's rawMessageContent drives the consumer's messageContent.
    expect(core.messageContent).toBe('hello from the contract test');
    // The consumer resolves the real seeded identity around the envelope.
    expect(core.userInternalId).toBe(userId);
    expect(core.userTimezone).toBe('America/New_York');
  });

  it('with-extended-context fixture: envelope extended-context merges into assembled history', async () => {
    const core = await assembler.assembleCore(
      jobContext(fixtureEnvelope('with-extended-context')),
      personality,
      undefined
    );

    // The producer's rawExtendedContextMessages are merged into the assembled
    // history — the key derivation this envelope field enables.
    expect(core.history.map(m => m.content)).toContain('an earlier message from the channel');
    // The producer's rawMessageContent still drives the consumer's messageContent.
    // (Mention-token REWRITING is summon-mode- and personality-dependent — the
    // mention kernel's domain, covered by mentionRewriter's own tests — not the
    // envelope→consumer seam this contract locks.)
    expect(core.messageContent).toContain('with context');
  });
});
