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
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { contractFixtureFile, stableFixtureJson } from '@tzurot/test-utils';
import { MessageRole, type ConversationMessage } from '@tzurot/common-types';
import type { Message } from 'discord.js';

const { mockGetVoiceTranscript } = vi.hoisted(() => ({
  mockGetVoiceTranscript: vi.fn((): string | undefined => undefined),
}));
vi.mock('../../processors/VoiceMessageProcessor.js', () => ({
  VoiceMessageProcessor: { getVoiceTranscript: mockGetVoiceTranscript },
}));
vi.mock('../CrossChannelHistoryFetcher.js', () => ({
  buildKnownChannelEnvironments: vi.fn(() => ({
    'channel-cross-1': {
      type: 'guild',
      guild: { id: 'guild-1', name: 'Contract Guild' },
      channel: { id: 'channel-cross-1', name: 'cross-channel', type: 'GUILD_TEXT' },
    },
  })),
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

describe('RawEnvelope contract — producer fixture generation', () => {
  // Per 02-code-standards "Fake Timers (ALWAYS Use)". This test uses no timers
  // and only an explicit fixed date string (not Date.now()/argless new Date()),
  // so faking is a no-op on the output — present for rule-consistency.
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('base: plain text trigger (no extended context)', async () => {
    const envelope = buildRawAssemblyInputs(
      makeMessage([], 'hello from the contract test'),
      undefined,
      { rawAuthorDisplayName: 'Contract User' }
    );
    await expect(stableFixtureJson(envelope)).toMatchFileSnapshot(
      contractFixtureFile('raw-assembly-inputs/base.json')
    );
  });

  it('with-extended-context: mention + one prior extended-context turn', async () => {
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

    const envelope = buildRawAssemblyInputs(
      makeMessage([{ id: '333', username: 'target', globalName: 'Target' }], '<@333> with context'),
      {
        messages: [extendedMessage],
        extendedContextUsers: [
          { discordId: '444', username: 'earlier-user', displayName: 'Earlier', isBot: false },
        ],
        reactorUsers: [],
      },
      { rawAuthorDisplayName: 'Contract User' }
    );
    await expect(stableFixtureJson(envelope)).toMatchFileSnapshot(
      contractFixtureFile('raw-assembly-inputs/with-extended-context.json')
    );
  });
});
