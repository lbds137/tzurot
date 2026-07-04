/**
 * Producer half of the bot-client→ai-worker context-assembly contract.
 *
 * Runs the REAL `buildRawAssemblyInputs` and snapshots its output to committed
 * JSON fixtures under `@tzurot/test-utils` (`fixtures/contracts/raw-assembly-inputs/`).
 * `--update` regenerates the fixtures; CI COMPARES (strict). Drift → CI fails →
 * regenerate-on-purpose and commit the diff.
 *
 * The ai-worker consumer test (`RawEnvelopeContract.consumer.contract.test.ts`)
 * reads these SAME fixtures and feeds them to the real `ContextAssembler`. The
 * committed fixture IS the contract artifact — the two services share data, not
 * code, so neither imports the other (depcruise boundary stays intact). See
 * `packages/test-utils/src/contractFixtures.ts` for the rationale.
 *
 * The two producer internals (`VoiceMessageProcessor.getVoiceTranscript`,
 * `buildKnownChannelEnvironments`) are mocked deterministically — natural here,
 * colocated in bot-client, exactly as the pilot `RawEnvelopeBuilder.test.ts` does.
 * A scenario configures them per-case via `mockReturnValueOnce` for the seams
 * (voice transcript, cross-channel env map) it exercises.
 *
 * Parameterization is intentionally ASYMMETRIC with the consumer half: the
 * producer is a uniform build→snapshot, so a data-driven SCENARIOS table is the
 * clean shape; the consumer's per-scenario assertions + DB seeding diverge too
 * much for a table and stay explicit `it` blocks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { contractFixtureFile, stableFixtureJson } from '@tzurot/test-utils';
import { MessageRole } from '@tzurot/common-types/constants/message';
import { type ConversationMessage } from '@tzurot/common-types/types/conversationMessage';
import { type DiscordEnvironment } from '@tzurot/common-types/types/schemas/discord';
import { type RawAssemblyInputs } from '@tzurot/common-types/types/schemas/rawEnvelope';
import type { Message } from 'discord.js';

const { mockGetVoiceTranscript, mockBuildKnownChannelEnvironments } = vi.hoisted(() => ({
  mockGetVoiceTranscript: vi.fn((): string | undefined => undefined),
  // Default mirrors the historical single-entry map so the base /
  // with-extended-context fixtures regenerate byte-identical; the cross-channel
  // scenario overrides it with `mockReturnValueOnce` for its own richer map. The
  // explicit return type keeps `mockReturnValueOnce` open to any env-map shape
  // (without it TS pins the type to this single-key literal).
  mockBuildKnownChannelEnvironments: vi.fn((): Record<string, DiscordEnvironment> => ({
    'channel-cross-1': {
      type: 'guild',
      guild: { id: 'guild-1', name: 'Contract Guild' },
      channel: { id: 'channel-cross-1', name: 'cross-channel', type: 'GUILD_TEXT' },
    },
  })),
}));
vi.mock('../../processors/VoiceMessageProcessor.js', () => ({
  VoiceMessageProcessor: { getVoiceTranscript: mockGetVoiceTranscript },
}));
vi.mock('../CrossChannelHistoryFetcher.js', () => ({
  buildKnownChannelEnvironments: mockBuildKnownChannelEnvironments,
}));

import { buildRawAssemblyInputs } from './RawEnvelopeBuilder.js';

const makeMessage = (
  mentions: { id: string; username: string; globalName?: string }[],
  content: string
): Message =>
  ({
    client: {},
    content,
    mentions: { users: new Map(mentions.map(m => [m.id, m])) },
  }) as unknown as Message;

/**
 * A contract scenario: a name (= fixture file stem) and a builder that runs the
 * real producer (configuring the per-seam mocks it needs first) and returns the
 * envelope to snapshot.
 */
interface ProducerScenario {
  name: string;
  build: () => RawAssemblyInputs;
}

const extendedMessage = {
  id: 'ext-1',
  role: MessageRole.User,
  content: 'an earlier message from the channel',
  createdAt: new Date('2026-06-01T09:00:00Z'),
  personaId: 'discord:444',
  discordUsername: 'earlier-user',
  discordMessageId: ['ext-dm-1'],
  channelId: 'test-channel-987',
  guildId: 'test-guild-654',
} as ConversationMessage;

const SCENARIOS: ProducerScenario[] = [
  {
    name: 'base',
    // Plain text trigger, no extended context.
    build: () =>
      buildRawAssemblyInputs(makeMessage([], 'hello from the contract test'), undefined, {
        rawAuthorDisplayName: 'Contract User',
      }),
  },
  {
    name: 'with-extended-context',
    // Mention + one prior extended-context turn.
    build: () =>
      buildRawAssemblyInputs(
        makeMessage(
          [{ id: '333', username: 'target', globalName: 'Target' }],
          '<@333> with context'
        ),
        {
          messages: [extendedMessage],
          extendedContextUsers: [
            { discordId: '444', username: 'earlier-user', displayName: 'Earlier', isBot: false },
          ],
          reactorUsers: [],
        },
        { rawAuthorDisplayName: 'Contract User' }
      ),
  },
  {
    name: 'voice-trigger',
    // A voice trigger: Discord content is EMPTY (ground truth), the bot-side STT
    // transcript rides rawRoutingTranscript as telemetry only. Locks the
    // content/transcript split at the producer; the consumer half asserts the
    // worker does NOT leak the transcript into the prompt content.
    build: () => {
      mockGetVoiceTranscript.mockReturnValueOnce('the spoken words from a voice note');
      return buildRawAssemblyInputs(makeMessage([], ''), undefined, {
        rawAuthorDisplayName: 'Voice User',
      });
    },
  },
  {
    name: 'with-channel-environment',
    // A trigger whose knownChannelEnvironments names two cross-channels. The
    // consumer fetches cross-channel groups from its OWN DB and decorates them
    // with these names; a third (unmapped) channel exercises the fallback.
    build: () => {
      mockBuildKnownChannelEnvironments.mockReturnValueOnce({
        'channel-cross-1': {
          type: 'guild',
          guild: { id: 'guild-1', name: 'Contract Guild' },
          channel: { id: 'channel-cross-1', name: 'cross-channel-one', type: 'GUILD_TEXT' },
        },
        'channel-cross-2': {
          type: 'guild',
          guild: { id: 'guild-1', name: 'Contract Guild' },
          channel: { id: 'channel-cross-2', name: 'cross-channel-two', type: 'GUILD_TEXT' },
        },
      });
      return buildRawAssemblyInputs(
        makeMessage([], 'what is happening in the other channels'),
        undefined,
        { rawAuthorDisplayName: 'Contract User' }
      );
    },
  },
  {
    name: 'personal-summon-mention',
    // A mention the producer captures into rawMentionedUsers (the normal path,
    // distinct from the component test's DB-fallback/absent path). The consumer
    // resolves the mentioned user's persona and rewrites the token. The id must
    // be a real 18-digit snowflake — resolveUserMentions filters mention ids
    // through isValidDiscordId, so a toy id is silently dropped (never rewritten).
    build: () =>
      buildRawAssemblyInputs(
        makeMessage(
          [{ id: '700700700700700700', username: 'mentioned', globalName: 'Mentioned User' }],
          'hey <@700700700700700700> check this out'
        ),
        undefined,
        { rawAuthorDisplayName: 'Contract User' }
      ),
  },
];

describe('RawEnvelope contract — producer fixture generation', () => {
  // Per 02-code-standards "Fake Timers (ALWAYS Use)". These scenarios use no
  // timers and only explicit fixed date strings (not Date.now()/argless new
  // Date()), so faking is a no-op on the output — present for rule-consistency.
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    // resetAllMocks (not restoreAllMocks): these mocks are `vi.fn()`, not `vi.spyOn`
    // spies, so restoreAllMocks is a no-op on them and — critically — leaves any
    // queued `mockReturnValueOnce` in place. A scenario that throws before consuming
    // its queued value would then leak it into the next scenario. reset clears the
    // once-queue between cases. Vitest 4's mockReset preserves the original
    // `vi.fn(factory)` implementation, so the default env-map / undefined-transcript
    // impls survive (verified: fixtures regenerate byte-identical).
    vi.resetAllMocks();
  });

  it.each(SCENARIOS)(
    '$name: real producer output matches the committed fixture',
    async ({ name, build }) => {
      const envelope = build();
      await expect(stableFixtureJson(envelope)).toMatchFileSnapshot(
        contractFixtureFile(`raw-assembly-inputs/${name}.json`)
      );
    }
  );
});
