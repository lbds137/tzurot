/**
 * Component test: `ContextAssembler.assembleCore` against REAL PGLite.
 *
 * This un-stubs what `AIJobProcessor.component.test.ts` deliberately skips — that test
 * stubs the ENTIRE ContextStep because the real assembler reads Prisma, which its
 * harness didn't wire. Here we wire the REAL `PrismaContextDataSource` +
 * `UserService` + `PersonaResolver` over PGLite, seed real users/personas/history,
 * and assert the assembler re-derives the core surfaces from actual DB state.
 *
 * This is the real-data third of the producer→schema→consumer contract that the
 * Prisma-eviction epic deleted bot-client code against on the claim "the
 * worker re-derives identical context from rawAssemblyInputs":
 *  - producer half  → RawEnvelopeBuilder.test.ts (real builder conforms to schema)
 *  - mocked consumer → ContextAssembler.test.ts (assembleCore over faithful doubles)
 *  - real consumer   → THIS FILE (assembleCore over real PGLite)
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
import type { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { createTestPGlite, loadPGliteSchema, seedUserWithPersona } from '@tzurot/test-utils';
import { ContextAssembler } from './ContextAssembler.js';
import { PrismaContextDataSource } from './PrismaContextDataSource.js';

const DISCORD_USER_ID = '123456789012345678';
const CHANNEL_ID = 'test-channel-987';
const GUILD_ID = 'test-guild-654';
// Cross-channel: a second/third channel for the same persona+personality.
const CHANNEL_ID_B = 'other-channel-111'; // gets an env-map entry
const CHANNEL_ID_C = 'other-channel-222'; // NO env entry → fallback decoration
// A different Discord user, @-mentioned to exercise the DB-fallback resolution.
const MENTIONED_DISCORD_ID = '999888777666555444';

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

    // User + default persona (the pair must be created atomically).
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
      discordMessageId: string,
      channelId: string = CHANNEL_ID
    ): Promise<void> => {
      await prisma.conversationHistory.create({
        data: {
          id: generateConversationHistoryUuid(channelId, personalityId, personaId, createdAt),
          channelId,
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
    // Cross-channel rows: same persona+personality, OTHER channels (B has an env
    // entry, C does not → exercises env-map decoration vs the shared fallback).
    await seedTurn(
      'cross-channel turn from B',
      MessageRole.User,
      new Date('2026-06-01T09:00:00Z'),
      'dm-b1',
      CHANNEL_ID_B
    );
    await seedTurn(
      'cross-channel turn from C',
      MessageRole.User,
      new Date('2026-06-01T08:00:00Z'),
      'dm-c1',
      CHANNEL_ID_C
    );

    // A second user + default persona, @-mentioned to drive the DB-fallback
    // mention resolution (the id is omitted from rawMentionedUsers below).
    const mentionedUserId = generateUserUuid(MENTIONED_DISCORD_ID);
    await seedUserWithPersona(prisma, {
      userId: mentionedUserId,
      personaId: generatePersonaUuid('mentioned-user', mentionedUserId),
      discordId: MENTIONED_DISCORD_ID,
      username: 'mentioned-user',
      personaName: 'Mentioned',
    });

    // A persisted voice message in a SEPARATE channel — the worker stores the
    // transcript AS the row's content (DB tier). Referenced from another turn,
    // it's not in the current channel's history, so enrichment appends its
    // transcript rather than deduping it.
    await seedTurn(
      'the persisted transcript',
      MessageRole.User,
      new Date('2026-06-01T07:00:00Z'),
      'voice-ref-1',
      'voice-channel-zzz'
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

  // ── Weigh-in / incognito assembly ──────────────────────────────────────────

  it('weigh-in on an empty channel still assembles (incognito: null persona, no epoch, no throw)', async () => {
    // Empty-channel weigh-in guard (the worker-side mirror of the bot's
    // synthetic-anchor path): a read-the-room poke at a channel with NO history
    // must assemble cleanly, not crash on an empty window. A default weigh-in
    // (incognito) nulls the persona and skips the persona-scoped epoch.
    const core = await assembler.assembleCore(
      jobContext({
        channelId: 'empty-channel-xyz',
        isWeighIn: true,
        // A mention token so the messageContent assertion DISTINGUISHES the
        // incognito short-circuit (passes through untouched) from the full
        // rewriter merely finding nothing — a plain string can't tell them apart.
        rawAssemblyInputs: rawAssemblyInputsSchema.parse({
          rawMessageContent: `read the room <@${MENTIONED_DISCORD_ID}>`,
        }),
      }),
      personality,
      undefined
    );
    expect(core.history).toEqual([]); // no rows seeded for this channel
    expect(core.activePersonaId).toBeNull(); // default-incognito weigh-in
    expect(core.contextEpoch).toBeUndefined(); // epoch skipped for incognito
    // Incognito skips resolveUserMentions: the mention token is NOT rewritten (no
    // anonymous-poke user upsert). The full-rewriter path WOULD resolve it (the
    // mentioned user is seeded), so the raw token proves the short-circuit fired.
    expect(core.messageContent).toBe(`read the room <@${MENTIONED_DISCORD_ID}>`);
  });

  it('weigh-in on the seeded channel still hydrates its recent history', async () => {
    // Weigh-in changes framing (anonymity), not channel-history hydration — the
    // current channel's recent turns are still read.
    const core = await assembler.assembleCore(
      jobContext({ isWeighIn: true }),
      personality,
      undefined
    );
    expect(core.activePersonaId).toBeNull();
    expect(core.history.map(m => m.content)).toContain('assistant reply');
  });

  // ── Cross-channel decoration (step 7) ──────────────────────────────────────

  it('assembles cross-channel history from other channels, excluding the current one', async () => {
    const core = await assembler.assembleCore(
      jobContext({
        rawAssemblyInputs: rawAssemblyInputsSchema.parse({
          rawMessageContent: 'live trigger',
          knownChannelEnvironments: {
            [CHANNEL_ID_B]: {
              type: 'guild',
              guild: { id: GUILD_ID, name: 'Test Guild' },
              channel: { id: CHANNEL_ID_B, name: 'other-channel', type: 'text' },
            },
          },
        }),
      }),
      personality,
      { crossChannelHistoryEnabled: true } as ResolvedConfigOverrides
    );

    expect(core.crossChannelHistory).toBeDefined();
    const groups = core.crossChannelHistory ?? [];
    const allContent = groups.flatMap(g => g.messages.map(m => m.content));
    // Both other channels' rows are fetched (the real persona-scoped DB query).
    expect(allContent).toContain('cross-channel turn from B');
    expect(allContent).toContain('cross-channel turn from C');
    // The CURRENT channel's own history is NOT duplicated into the cross set.
    expect(allContent).not.toContain('assistant reply');

    // Decoration: B uses the env-map entry; C (no entry) uses the shared fallback.
    const byChannel = (id: string): DiscordEnvironment | undefined =>
      groups.find(g => g.channelEnvironment.channel.id === id)?.channelEnvironment;
    expect(byChannel(CHANNEL_ID_B)?.channel.name).toBe('other-channel');
    expect(byChannel(CHANNEL_ID_C)?.channel.name).toBe('unknown-channel');
  });

  // ── Content rewriting via real DB-fallback mention resolution (step 6) ──────

  it('rewrites a user mention via the DB fallback (mention absent from rawMentionedUsers)', async () => {
    // The mention id is NOT in rawMentionedUsers, so the shared kernel must fall
    // back to findUserByDiscordId → resolve the seeded user's persona, then
    // rewrite. A personal summon (no weigh-in) so rewriting runs.
    const core = await assembler.assembleCore(
      jobContext({
        rawAssemblyInputs: rawAssemblyInputsSchema.parse({
          rawMessageContent: `hey <@${MENTIONED_DISCORD_ID}> look at this`,
        }),
      }),
      personality,
      undefined
    );

    // The raw mention token was rewritten (resolved through the DB fallback).
    expect(core.messageContent).not.toContain(`<@${MENTIONED_DISCORD_ID}>`);
    // The CORRECT mentioned persona surfaced — locks the resolution round-trip,
    // not just a non-empty result. The seeded mentioned persona's name is 'Mentioned'.
    expect(core.mentionedPersonas).toContainEqual(
      expect.objectContaining({ personaName: 'Mentioned' })
    );
  });

  // ── Reference enrichment (step 5): voice transcript + dedup ─────────────────

  it('appends a referenced voice message’s DB-persisted transcript', async () => {
    const core = await assembler.assembleCore(
      jobContext({
        rawAssemblyInputs: rawAssemblyInputsSchema.parse({
          rawMessageContent: 'live trigger',
          rawReferencedMessages: [
            {
              referenceNumber: 1,
              discordMessageId: 'voice-ref-1',
              discordUserId: MENTIONED_DISCORD_ID,
              authorUsername: 'mentioned-user',
              authorDisplayName: 'Mentioned',
              content: 'a voice message',
              embeds: '',
              timestamp: new Date('2026-06-01T07:00:00Z').toISOString(),
              locationContext: '<location>here</location>',
              attachments: [
                { url: 'http://x/voice.ogg', contentType: 'audio/ogg', isVoiceMessage: true },
              ],
            },
          ],
        }),
      }),
      personality,
      undefined
    );

    const ref = core.referencedMessages?.find(r => r.discordMessageId === 'voice-ref-1');
    expect(ref).toBeDefined();
    // Exact shape: the DB-derived transcript was APPENDED to the original content
    // (not replacing it). `toBe` catches an append→replace regression `toContain`
    // would miss.
    expect(ref?.content).toBe('a voice message\n\n[Voice transcript]: the persisted transcript');
  });

  it('marks a reference that duplicates an assembled-history message as deduplicated', async () => {
    // dm-2 (assistant reply) is in the current channel's assembled history, so a
    // reference to it is a duplicate and is collapsed to a dedup stub.
    const core = await assembler.assembleCore(
      jobContext({
        rawAssemblyInputs: rawAssemblyInputsSchema.parse({
          rawMessageContent: 'live trigger',
          rawReferencedMessages: [
            {
              referenceNumber: 1,
              discordMessageId: 'dm-2',
              discordUserId: DISCORD_USER_ID,
              authorUsername: 'test-user',
              authorDisplayName: 'test-user',
              content: 'assistant reply',
              embeds: '',
              timestamp: new Date('2026-06-01T10:01:00Z').toISOString(),
              locationContext: '<location>here</location>',
            },
          ],
        }),
      }),
      personality,
      undefined
    );

    const ref = core.referencedMessages?.find(r => r.discordMessageId === 'dm-2');
    expect(ref?.isDeduplicated).toBe(true);
    // Lock the stub SHAPE, not just the flag: the reference number survives and a
    // non-bot-authored ref keeps a content preview of the original.
    expect(ref?.referenceNumber).toBe(1);
    expect(ref?.content).toBe('assistant reply');
  });
});
