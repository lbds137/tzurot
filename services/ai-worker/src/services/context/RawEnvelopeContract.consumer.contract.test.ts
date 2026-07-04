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
import { MessageRole } from '@tzurot/common-types/constants/message';
import { type ResolvedConfigOverrides } from '@tzurot/common-types/schemas/api/configOverrides';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import { type JobContext } from '@tzurot/common-types/types/jobs';
import { type DiscordEnvironment } from '@tzurot/common-types/types/schemas/discord';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { rawAssemblyInputsSchema } from '@tzurot/common-types/types/schemas/rawEnvelope';
import {
  generateUserUuid,
  generatePersonaUuid,
  generatePersonalityUuid,
  generateSystemPromptUuid,
  generateConversationHistoryUuid,
} from '@tzurot/common-types/utils/deterministicUuid';
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
// A real 18-digit snowflake — the mention rewriter drops ids that fail
// isValidDiscordId, so the personal-summon-mention fixture must use a valid one.
const MENTIONED_DISCORD_ID = '700700700700700700';

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

    // Cross-channel rows for the with-channel-environment fixture: same
    // persona+personality the trigger user resolves to (cross-channel history is
    // persona-scoped), in OTHER channels. channel-cross-1 is in the fixture's env
    // map (decorated by its name); channel-cross-3 is NOT (falls back to id-only).
    // channel-cross-2 is in the env map but seeded with NO rows — the consumer
    // must not emit a spurious group for it (asserted in the cross-channel test).
    const contractPersonaId = generatePersonaUuid('contract-user', userId);
    const seedCrossTurn = (chId: string, content: string, createdAt: Date, dmId: string) =>
      prisma.conversationHistory.create({
        data: {
          id: generateConversationHistoryUuid(chId, personalityId, contractPersonaId, createdAt),
          channelId: chId,
          guildId: GUILD_ID,
          personalityId,
          personaId: contractPersonaId,
          role: MessageRole.User,
          content,
          discordMessageId: [dmId],
          createdAt,
        },
      });
    await seedCrossTurn(
      'channel-cross-1',
      'cross turn in channel one',
      new Date('2026-06-01T09:00:00Z'),
      'xc-1'
    );
    await seedCrossTurn(
      'channel-cross-3',
      'cross turn in channel three',
      new Date('2026-06-01T08:00:00Z'),
      'xc-3'
    );

    // The @-mentioned user in the personal-summon-mention fixture, with a persona
    // named 'Mentioned' — the rewrite resolves the mention to this name. The id is
    // a real snowflake because resolveUserMentions drops toy ids via isValidDiscordId.
    const mentionedUserId = generateUserUuid(MENTIONED_DISCORD_ID);
    await seedUserWithPersona(prisma, {
      userId: mentionedUserId,
      personaId: generatePersonaUuid('mentioned', mentionedUserId),
      discordId: MENTIONED_DISCORD_ID,
      username: 'mentioned',
      personaName: 'Mentioned',
    });

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
    expect(core.messageContent).toContain('with context');
  });

  it('voice-trigger fixture: the routing transcript stays telemetry-only (content empty)', async () => {
    const core = await assembler.assembleCore(
      jobContext(fixtureEnvelope('voice-trigger')),
      personality,
      undefined
    );

    // A voice trigger ships EMPTY rawMessageContent + the bot-side STT text on
    // rawRoutingTranscript (telemetry). The worker derives its OWN transcript via
    // the attachment path, so the assembled prompt content must stay empty here —
    // the routing transcript must NOT leak into it. Locks the ground-truth
    // content/transcript split end-to-end (producer emits the split; consumer
    // respects it).
    expect(core.messageContent).toBe('');
    // Secondary leak path: the telemetry transcript must not surface in the
    // assembled HISTORY either (not just the current-message content). The fixture's
    // routing transcript is "the spoken words from a voice note" — assert no history
    // entry carries it, so a future regression that folds rawRoutingTranscript into
    // history is caught here too.
    expect(core.history.map(m => m.content)).not.toContain('the spoken words from a voice note');
  });

  it('with-channel-environment fixture: cross-channel groups decorate from the envelope env map', async () => {
    const core = await assembler.assembleCore(
      jobContext(fixtureEnvelope('with-channel-environment')),
      personality,
      // Partial cast: the cross-channel path reads crossChannelHistoryEnabled and
      // guards the other required fields (maxMessages/maxAge) with ?? fallbacks, so
      // leaving them unset is safe here.
      { crossChannelHistoryEnabled: true } as ResolvedConfigOverrides
    );

    expect(core.crossChannelHistory).toBeDefined();
    const groups = core.crossChannelHistory ?? [];
    const allContent = groups.flatMap(g => g.messages.map(m => m.content));
    // The persona-scoped DB query returns both other channels' rows...
    expect(allContent).toContain('cross turn in channel one');
    expect(allContent).toContain('cross turn in channel three');

    // ...decorated from the envelope's knownChannelEnvironments: channel-cross-1
    // is in the map (named), channel-cross-3 is not (id-only fallback). This is
    // the producer→consumer seam — the env names come from the REAL fixture map.
    const byChannel = (id: string): DiscordEnvironment | undefined =>
      groups.find(g => g.channelEnvironment.channel.id === id)?.channelEnvironment;
    expect(byChannel('channel-cross-1')?.channel.name).toBe('cross-channel-one');
    expect(byChannel('channel-cross-3')?.channel.name).toBe('unknown-channel');
    // channel-cross-2 is in the env map but has no seeded rows → no group. The
    // query is history-first (the env map only decorates fetched rows), so an
    // in-map channel with no history must not produce a spurious group.
    expect(byChannel('channel-cross-2')).toBeUndefined();
  });

  it('personal-summon-mention fixture: the mentioned user resolves + the token is rewritten', async () => {
    const core = await assembler.assembleCore(
      jobContext(fixtureEnvelope('personal-summon-mention')),
      personality,
      undefined
    );

    // The mention id rides the producer's rawMentionedUsers (the normal
    // path, distinct from the component test's DB-fallback). A personal summon
    // rewrites the token out and surfaces the resolved persona — locking that the
    // consumer consumes rawMentionedUsers the producer actually emits.
    expect(core.messageContent).not.toContain(`<@${MENTIONED_DISCORD_ID}>`);
    expect(core.mentionedPersonas).toContainEqual(
      expect.objectContaining({ personaName: 'Mentioned' })
    );
  });
});
