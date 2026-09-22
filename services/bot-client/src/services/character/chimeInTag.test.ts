/**
 * Tests for character/chimeInTag.ts
 *
 * The tag fan-out: pool resolution, cap-driven sampling + its notice, the
 * per-character turn seam, and the shared-reply redirect that stops a blocked
 * character from clobbering the notice.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChannelType, MessageFlags } from 'discord.js';
import { DISCORD_LIMITS } from '@tzurot/common-types/constants/discord';
import type { PersonalitySummary } from '@tzurot/common-types/schemas/api/personality';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return { ...actual, createLogger: () => mockLogger };
});

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: { NODE_ENV: 'test' as string, LOG_CONTENT_PREVIEWS: false },
}));
vi.mock('@tzurot/common-types/config/config', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/config/config')>(
    '@tzurot/common-types/config/config'
  );
  return { ...actual, getConfig: () => mockConfig };
});

const mockGetCachedPersonalities = vi.fn();
vi.mock('../../utils/autocomplete/autocompleteCache.js', () => ({
  getCachedPersonalities: (...args: unknown[]) => mockGetCachedPersonalities(...args),
}));

// A distinct object (not `{}`) so a test can assert it — and not some other
// object — is the one that reaches `evaluateNsfwGate`.
const sentinelUserClient = { __sentinel: 'tag-chime-in-user-client' };
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: {} })),
  clientsForUser: vi.fn(() => ({ userClient: sentinelUserClient })),
}));

const mockGetMultiTagCap = vi.fn();
vi.mock('../../utils/gatewayServiceCalls.js', () => ({
  getMultiTagCap: () => mockGetMultiTagCap(),
}));

const mockRunCharacterTurn = vi.fn();
vi.mock('./characterTurn.js', () => ({
  runCharacterTurn: (...args: unknown[]) => mockRunCharacterTurn(...args),
}));

// `slashChatGates.js` is deliberately NOT mocked here: the real
// `isDeniedForActor` / `runSlashNsfwGate` helpers run, so the pre-sample-gate
// tests below exercise the real predicate against its own mocked
// dependencies rather than a stand-in that could drift from the real thing.
const mockGetDenylistCache = vi.fn();
vi.mock('../serviceRegistry.js', () => ({
  getDenylistCache: () => mockGetDenylistCache(),
}));

const mockIsBotOwner = vi.fn((_id: string) => false);
vi.mock('@tzurot/common-types/utils/ownerMiddleware', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@tzurot/common-types/utils/ownerMiddleware')>();
  return { ...actual, isBotOwner: (id: string) => mockIsBotOwner(id) };
});

const mockEvaluateNsfwGate = vi.fn();
const mockSendVerificationConfirmation = vi.fn().mockResolvedValue(undefined);
const mockTrackPending = vi.fn().mockResolvedValue(undefined);
vi.mock('../../utils/nsfwVerification.js', () => ({
  evaluateNsfwGate: (...args: unknown[]) => mockEvaluateNsfwGate(...args),
  sendVerificationConfirmation: (...args: unknown[]) => mockSendVerificationConfirmation(...args),
  trackPendingVerificationMessage: (...args: unknown[]) => mockTrackPending(...args),
  nsfwVerificationMessage: () => 'NSFW_PROMPT',
  NSFW_VERIFICATION_CHECK_FAILED_MESSAGE: 'NSFW_CHECK_FAILED',
}));

// Sampling is exercised directly in tagPool.test.ts; here the draw is pinned so
// the notice's name list is deterministic.
vi.mock('node:crypto', async importActual => ({
  ...(await importActual<typeof import('node:crypto')>()),
  randomInt: vi.fn(),
}));

import { randomInt } from 'node:crypto';
import { runTagChimeIn, sharedReplyContext, CHIME_IN_SELECTOR_USAGE_DETAIL } from './chimeInTag.js';

const mockedRandomInt = vi.mocked(randomInt as (max: number) => number);

const makeSummary = (slug: string, opts: { displayName?: string | null; tags?: string[] } = {}) =>
  ({
    id: `id-${slug}`,
    slug,
    name: slug,
    displayName: opts.displayName ?? null,
    isOwned: true,
    isPublic: true,
    ownerId: 'user-123',
    ownerDiscordId: 'user-123',
    tags: opts.tags ?? [],
    permissions: { canEdit: true, canDelete: true },
  }) satisfies PersonalitySummary;

const makeContext = (): DeferredCommandContext =>
  ({
    interaction: {},
    user: { id: 'user-123', displayName: 'TestUser' },
    // A default supported channel so the up-front NSFW gate runs in every
    // test unless a test explicitly overrides `channel` to `null` — the
    // default-allowed NSFW mock below keeps every pre-existing test's
    // behavior unchanged.
    channel: { type: ChannelType.GuildText },
    // The NSFW gate's "not verified" branch reads `.id`/`.channelId` off the
    // resolved reply to track the prompt for later retraction.
    editReply: vi.fn().mockResolvedValue({ id: 'reply-1', channelId: 'chan-1' }),
    deleteReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
  }) as unknown as DeferredCommandContext;

beforeEach(() => {
  vi.clearAllMocks();
  mockConfig.NODE_ENV = 'test';
  mockConfig.LOG_CONTENT_PREVIEWS = false;
  mockedRandomInt.mockReturnValue(0);
  mockGetMultiTagCap.mockResolvedValue(5);
  mockRunCharacterTurn.mockResolvedValue(undefined);
  // Defaults for the pre-sample gates: nobody is denied, nobody is the bot
  // owner, and NSFW is allowed — every pre-existing test's fan-out behavior
  // is unaffected by either gate.
  mockGetDenylistCache.mockReturnValue({
    isPersonalityDenied: vi.fn().mockReturnValue(false),
    isPersonalityMuted: vi.fn().mockReturnValue(false),
  });
  mockIsBotOwner.mockReturnValue(false);
  mockEvaluateNsfwGate.mockResolvedValue({ allowed: true, wasNewVerification: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runTagChimeIn', () => {
  it('runs a weigh-in turn for every character in an under-cap pool', async () => {
    mockGetCachedPersonalities.mockResolvedValue({
      kind: 'ok',
      value: [
        makeSummary('untagged'),
        makeSummary('a', { tags: ['fantasy'] }),
        makeSummary('b', { tags: ['fantasy'] }),
      ],
    });
    const ctx = makeContext();

    await runTagChimeIn(ctx, { tag: 'fantasy', incognitoOption: null });

    expect(mockRunCharacterTurn).toHaveBeenCalledTimes(2);
    // Seam assertion: what crosses into the turn engine decides which character
    // speaks and in which mode — a wiring bug here is invisible in the return value.
    expect(mockRunCharacterTurn).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        characterArg: 'a',
        message: null, // null message is what makes this a weigh-in
        incognitoOption: null,
      })
    );
    expect(mockRunCharacterTurn).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ characterArg: 'b', message: null })
    );
  });

  it('forwards the incognito option to every turn unchanged', async () => {
    mockGetCachedPersonalities.mockResolvedValue({
      kind: 'ok',
      value: [makeSummary('a', { tags: ['fantasy'] }), makeSummary('b', { tags: ['fantasy'] })],
    });

    await runTagChimeIn(makeContext(), { tag: 'fantasy', incognitoOption: false });

    for (const call of mockRunCharacterTurn.mock.calls) {
      expect(call[1]).toMatchObject({ incognitoOption: false });
    }
  });

  it('posts no sampling notice when the whole pool fits under the cap', async () => {
    mockGetCachedPersonalities.mockResolvedValue({
      kind: 'ok',
      value: [makeSummary('a', { tags: ['fantasy'] })],
    });
    const ctx = makeContext();

    await runTagChimeIn(ctx, { tag: 'fantasy', incognitoOption: null });

    expect(ctx.editReply).not.toHaveBeenCalled();
    // The deferred "thinking..." indicator is still cleared, the way an
    // explicit-pick chime-in clears it.
    expect(ctx.deleteReply).toHaveBeenCalled();
  });

  it('samples down to the cap and says so when the pool is larger', async () => {
    mockGetMultiTagCap.mockResolvedValue(2);
    mockGetCachedPersonalities.mockResolvedValue({
      kind: 'ok',
      value: [
        makeSummary('a', { displayName: 'Ana', tags: ['fantasy'] }),
        makeSummary('b', { displayName: 'Bo', tags: ['fantasy'] }),
        makeSummary('c', { displayName: 'Cy', tags: ['fantasy'] }),
        makeSummary('d', { displayName: 'Di', tags: ['fantasy'] }),
      ],
    });
    const ctx = makeContext();

    await runTagChimeIn(ctx, { tag: 'fantasy', incognitoOption: null });

    expect(mockRunCharacterTurn).toHaveBeenCalledTimes(2);
    expect(ctx.editReply).toHaveBeenCalledWith({
      content: '🎲 4 characters carry `fantasy` — picked 2 at random: Ana, Di',
    });
    expect(ctx.deleteReply).not.toHaveBeenCalled();
  });

  it('echoes the normalized tag in the notice, not the raw typed form', async () => {
    mockGetMultiTagCap.mockResolvedValue(1);
    mockGetCachedPersonalities.mockResolvedValue({
      kind: 'ok',
      value: [
        makeSummary('a', { displayName: 'Ana', tags: ['sci-fi'] }),
        makeSummary('b', { displayName: 'Bo', tags: ['sci-fi'] }),
      ],
    });
    const ctx = makeContext();

    await runTagChimeIn(ctx, { tag: '  Sci   Fi ', incognitoOption: null });

    // The needle that MATCHED is the normalized one — echoing the raw input
    // would show a tag string that was never actually searched for.
    expect(ctx.editReply).toHaveBeenCalledWith({
      content: '🎲 2 characters carry `sci-fi` — picked 1 at random: Ana',
    });
  });

  it('names only the sampled characters in the notice', async () => {
    mockGetMultiTagCap.mockResolvedValue(1);
    mockGetCachedPersonalities.mockResolvedValue({
      kind: 'ok',
      value: [
        makeSummary('a', { displayName: 'Ana', tags: ['fantasy'] }),
        makeSummary('b', { displayName: 'Bo', tags: ['fantasy'] }),
      ],
    });
    const ctx = makeContext();

    await runTagChimeIn(ctx, { tag: 'fantasy', incognitoOption: null });

    const content = vi.mocked(ctx.editReply).mock.calls[0][0] as { content: string };
    expect(content.content).toContain('Ana');
    expect(content.content).not.toContain('Bo');
  });

  it('falls back to name when a sampled character has no displayName', async () => {
    mockGetMultiTagCap.mockResolvedValue(1);
    mockGetCachedPersonalities.mockResolvedValue({
      kind: 'ok',
      value: [
        makeSummary('plain-slug', { displayName: null, tags: ['fantasy'] }),
        makeSummary('other', { tags: ['fantasy'] }),
      ],
    });
    const ctx = makeContext();

    await runTagChimeIn(ctx, { tag: 'fantasy', incognitoOption: null });

    const content = vi.mocked(ctx.editReply).mock.calls[0][0] as { content: string };
    expect(content.content).toContain('plain-slug');
  });

  it('escapes markdown in author-controlled display names', async () => {
    mockGetMultiTagCap.mockResolvedValue(1);
    mockGetCachedPersonalities.mockResolvedValue({
      kind: 'ok',
      value: [
        makeSummary('a', { displayName: '**Loud**', tags: ['fantasy'] }),
        makeSummary('b', { tags: ['fantasy'] }),
      ],
    });
    const ctx = makeContext();

    await runTagChimeIn(ctx, { tag: 'fantasy', incognitoOption: null });

    const content = vi.mocked(ctx.editReply).mock.calls[0][0] as { content: string };
    expect(content.content).toContain('\\*\\*Loud\\*\\*');
  });

  it('keeps the sampling notice inside the Discord message ceiling', async () => {
    // Display names are author-authored up to 255 chars; cap-many of them
    // overrun the 2000-char ceiling, which rejects the edit outright.
    const longName = 'N'.repeat(255);
    mockGetMultiTagCap.mockResolvedValue(9);
    mockGetCachedPersonalities.mockResolvedValue({
      kind: 'ok',
      value: Array.from({ length: 12 }, (_unused, i) =>
        makeSummary(`slug-${i}`, { displayName: `${longName}${i}`, tags: ['fantasy'] })
      ),
    });
    const ctx = makeContext();

    await runTagChimeIn(ctx, { tag: 'fantasy', incognitoOption: null });

    const { content } = vi.mocked(ctx.editReply).mock.calls[0][0] as { content: string };
    expect(content.length).toBeLessThanOrEqual(DISCORD_LIMITS.MESSAGE_LENGTH);
    // The dropped names are accounted for rather than silently vanishing.
    expect(content).toMatch(/…and \d+ more$/u);
    // Every sampled character still gets its turn — trimming is a display
    // concern, not a change to who responds.
    expect(mockRunCharacterTurn).toHaveBeenCalledTimes(9);
  });

  it('still runs the turns when the sampling notice fails to post', async () => {
    mockGetMultiTagCap.mockResolvedValue(1);
    mockGetCachedPersonalities.mockResolvedValue({
      kind: 'ok',
      value: [makeSummary('a', { tags: ['fantasy'] }), makeSummary('b', { tags: ['fantasy'] })],
    });
    const ctx = makeContext();
    vi.mocked(ctx.editReply).mockRejectedValue(new Error('Invalid Form Body'));

    await runTagChimeIn(ctx, { tag: 'fantasy', incognitoOption: null });

    // The notice is context, not the answer: a rejected edit must not abort the
    // fan-out before any character has spoken.
    expect(mockRunCharacterTurn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('drops the tag from the fan-out log by default, keeping the always-on length', async () => {
    // The Discord `tag` option declares no setMaxLength, so an unbounded log
    // field would write up to 6000 user-controlled characters on EVERY
    // fan-out unless it goes through the gated content-preview helper.
    const longTag = 'a'.repeat(4000);
    mockGetCachedPersonalities.mockResolvedValue({
      kind: 'ok',
      value: [makeSummary('a', { tags: [longTag] })],
    });

    await runTagChimeIn(makeContext(), { tag: longTag, incognitoOption: null });

    const [fields] = mockLogger.info.mock.calls[0] as [Record<string, unknown>];
    expect(fields.tagPreview).toBeUndefined();
    expect(fields.tagLength).toBe(longTag.length);
    expect(JSON.stringify(mockLogger.info.mock.calls)).not.toContain(longTag);
  });

  it('includes the tag preview in the fan-out log when content previews are enabled', async () => {
    mockConfig.NODE_ENV = 'development';
    mockConfig.LOG_CONTENT_PREVIEWS = true;
    mockGetCachedPersonalities.mockResolvedValue({
      kind: 'ok',
      value: [makeSummary('a', { tags: ['fantasy'] })],
    });

    await runTagChimeIn(makeContext(), { tag: 'fantasy', incognitoOption: null });

    const [fields] = mockLogger.info.mock.calls[0] as [Record<string, unknown>];
    expect(fields.tagPreview).toBe('fantasy');
  });

  it('still runs the turns when deleting the stale thinking indicator fails', async () => {
    mockGetCachedPersonalities.mockResolvedValue({
      kind: 'ok',
      value: [makeSummary('a', { tags: ['fantasy'] })],
    });
    const ctx = makeContext();
    vi.mocked(ctx.deleteReply).mockRejectedValue(new Error('Unknown Message'));

    await runTagChimeIn(ctx, { tag: 'fantasy', incognitoOption: null });

    // The delete is cosmetic; the fan-out must survive its failure.
    expect(mockRunCharacterTurn).toHaveBeenCalledTimes(1);
  });

  it('surfaces an empty pool without running any turn', async () => {
    mockGetCachedPersonalities.mockResolvedValue({
      kind: 'ok',
      value: [makeSummary('a', { tags: ['sci-fi'] })],
    });
    const ctx = makeContext();

    await runTagChimeIn(ctx, { tag: 'Fantasy', incognitoOption: null });

    expect(mockRunCharacterTurn).not.toHaveBeenCalled();
    const content = vi.mocked(ctx.editReply).mock.calls[0][0] as { content: string };
    expect(content.content).toContain('No characters carry the tag');
    expect(content.content).toContain('fantasy');
  });

  it('surfaces a gateway failure without running any turn', async () => {
    const cause = new Error('boom');
    mockGetCachedPersonalities.mockResolvedValue({ kind: 'error', error: cause });
    const ctx = makeContext();

    await runTagChimeIn(ctx, { tag: 'fantasy', incognitoOption: null });

    expect(mockRunCharacterTurn).not.toHaveBeenCalled();
    expect(ctx.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to load the characters'),
    });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: cause, userId: 'user-123' }),
      expect.stringContaining('Personalities lookup failed')
    );
    expect(mockGetMultiTagCap).not.toHaveBeenCalled();
  });

  it('hands every turn the shared-reply view, not the raw context', async () => {
    mockGetCachedPersonalities.mockResolvedValue({
      kind: 'ok',
      value: [makeSummary('a', { tags: ['fantasy'] })],
    });
    const ctx = makeContext();

    await runTagChimeIn(ctx, { tag: 'fantasy', incognitoOption: null });

    const handed = mockRunCharacterTurn.mock.calls[0][0] as DeferredCommandContext;
    expect(handed).not.toBe(ctx);
    // Proving it IS the redirected view: a turn's editReply must not reach the
    // deferred message that carries the notice.
    await handed.editReply({ content: 'blocked' });
    expect(ctx.editReply).not.toHaveBeenCalled();
    expect(ctx.followUp).toHaveBeenCalled();
  });

  it('asks the gateway for the cap rather than assuming one', async () => {
    mockGetCachedPersonalities.mockResolvedValue({
      kind: 'ok',
      value: Array.from({ length: 9 }, (_, i) => makeSummary(`p${i}`, { tags: ['fantasy'] })),
    });
    mockGetMultiTagCap.mockResolvedValue(3);

    await runTagChimeIn(makeContext(), { tag: 'fantasy', incognitoOption: null });

    expect(mockGetMultiTagCap).toHaveBeenCalled();
    expect(mockRunCharacterTurn).toHaveBeenCalledTimes(3);
  });
});

describe('pre-sample gates', () => {
  describe('denylist filtering', () => {
    it('excludes a denied character from the pool before it ever reaches a turn', async () => {
      mockGetMultiTagCap.mockResolvedValue(2);
      mockGetCachedPersonalities.mockResolvedValue({
        kind: 'ok',
        value: [
          makeSummary('a', { tags: ['fantasy'] }),
          makeSummary('b', { tags: ['fantasy'] }),
          makeSummary('c', { tags: ['fantasy'] }),
        ],
      });
      const isPersonalityDenied = vi.fn(
        (_actorId: string, personalityId: string) => personalityId === 'id-b'
      );
      mockGetDenylistCache.mockReturnValue({
        isPersonalityDenied,
        isPersonalityMuted: vi.fn().mockReturnValue(false),
      });

      await runTagChimeIn(makeContext(), { tag: 'fantasy', incognitoOption: null });

      const slugs = mockRunCharacterTurn.mock.calls.map(
        call => (call[1] as { characterArg: string }).characterArg
      );
      expect(slugs).toEqual(['a', 'c']);
      // Seam assertion: the predicate is consulted with the invoking user's id
      // and EACH tag-matching member's id — not just the ones that survive.
      expect(isPersonalityDenied).toHaveBeenCalledWith('user-123', 'id-a');
      expect(isPersonalityDenied).toHaveBeenCalledWith('user-123', 'id-b');
      expect(isPersonalityDenied).toHaveBeenCalledWith('user-123', 'id-c');
    });

    it('is not over cap once the pool is filtered, so no notice posts', async () => {
      // 3 in the tag pool, 1 denied → 2 eligible, which exactly fills the cap.
      mockGetMultiTagCap.mockResolvedValue(2);
      mockGetCachedPersonalities.mockResolvedValue({
        kind: 'ok',
        value: [
          makeSummary('a', { tags: ['fantasy'] }),
          makeSummary('b', { tags: ['fantasy'] }),
          makeSummary('c', { tags: ['fantasy'] }),
        ],
      });
      mockGetDenylistCache.mockReturnValue({
        isPersonalityDenied: vi.fn(
          (_actorId: string, personalityId: string) => personalityId === 'id-b'
        ),
        isPersonalityMuted: vi.fn().mockReturnValue(false),
      });
      const ctx = makeContext();

      await runTagChimeIn(ctx, { tag: 'fantasy', incognitoOption: null });

      expect(ctx.editReply).not.toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('🎲') })
      );
      expect(ctx.deleteReply).toHaveBeenCalled();
    });

    it('never names the denied character in the sampling notice, and undercounts poolSize by it', async () => {
      mockGetMultiTagCap.mockResolvedValue(2);
      mockGetCachedPersonalities.mockResolvedValue({
        kind: 'ok',
        value: [
          makeSummary('a', { displayName: 'Ana', tags: ['fantasy'] }),
          makeSummary('b', { displayName: 'Denied', tags: ['fantasy'] }),
          makeSummary('c', { displayName: 'Cy', tags: ['fantasy'] }),
          makeSummary('d', { displayName: 'Di', tags: ['fantasy'] }),
        ],
      });
      mockGetDenylistCache.mockReturnValue({
        isPersonalityDenied: vi.fn(
          (_actorId: string, personalityId: string) => personalityId === 'id-b'
        ),
        isPersonalityMuted: vi.fn().mockReturnValue(false),
      });
      const ctx = makeContext();

      await runTagChimeIn(ctx, { tag: 'fantasy', incognitoOption: null });

      const content = vi.mocked(ctx.editReply).mock.calls[0][0] as { content: string };
      // 3 eligible (a, c, d), 2 sampled — the denied 4th is never counted.
      expect(content.content).toContain('🎲 3 characters');
      expect(content.content).not.toContain('Denied');
    });

    it('renders the empty-pool message, and runs no turns, when every match is denied', async () => {
      mockGetCachedPersonalities.mockResolvedValue({
        kind: 'ok',
        value: [makeSummary('a', { tags: ['fantasy'] }), makeSummary('b', { tags: ['fantasy'] })],
      });
      mockGetDenylistCache.mockReturnValue({
        isPersonalityDenied: vi.fn().mockReturnValue(true),
        isPersonalityMuted: vi.fn().mockReturnValue(false),
      });
      const ctx = makeContext();

      await runTagChimeIn(ctx, { tag: 'fantasy', incognitoOption: null });

      expect(mockRunCharacterTurn).not.toHaveBeenCalled();
      const content = vi.mocked(ctx.editReply).mock.calls[0][0] as { content: string };
      expect(content.content).toContain('No characters carry the tag');
    });

    it('does not filter for the bot owner, even when the cache denies everything', async () => {
      mockIsBotOwner.mockReturnValue(true);
      mockGetCachedPersonalities.mockResolvedValue({
        kind: 'ok',
        value: [makeSummary('a', { tags: ['fantasy'] }), makeSummary('b', { tags: ['fantasy'] })],
      });
      mockGetDenylistCache.mockReturnValue({
        isPersonalityDenied: vi.fn().mockReturnValue(true),
        isPersonalityMuted: vi.fn().mockReturnValue(false),
      });

      await runTagChimeIn(makeContext(), { tag: 'fantasy', incognitoOption: null });

      expect(mockRunCharacterTurn).toHaveBeenCalledTimes(2);
    });

    it('does not filter when the denylist cache is unregistered', async () => {
      mockGetCachedPersonalities.mockResolvedValue({
        kind: 'ok',
        value: [makeSummary('a', { tags: ['fantasy'] }), makeSummary('b', { tags: ['fantasy'] })],
      });
      mockGetDenylistCache.mockReturnValue(undefined);

      await runTagChimeIn(makeContext(), { tag: 'fantasy', incognitoOption: null });

      expect(mockRunCharacterTurn).toHaveBeenCalledTimes(2);
    });
  });

  describe('up-front NSFW gate', () => {
    it('blocks the whole fan-out before any notice or turn when not verified', async () => {
      mockEvaluateNsfwGate.mockResolvedValue({ allowed: false, reason: 'not-verified' });
      mockGetCachedPersonalities.mockResolvedValue({
        kind: 'ok',
        value: [makeSummary('a', { tags: ['fantasy'] }), makeSummary('b', { tags: ['fantasy'] })],
      });
      const ctx = makeContext();

      await runTagChimeIn(ctx, { tag: 'fantasy', incognitoOption: null });

      expect(ctx.editReply).toHaveBeenCalledTimes(1);
      expect(ctx.editReply).toHaveBeenCalledWith({ content: 'NSFW_PROMPT' });
      expect(ctx.deleteReply).not.toHaveBeenCalled();
      expect(ctx.followUp).not.toHaveBeenCalled();
      expect(mockRunCharacterTurn).not.toHaveBeenCalled();
    });

    it('blocks with the check-failed message and no tracking on a check failure', async () => {
      mockEvaluateNsfwGate.mockResolvedValue({ allowed: false, reason: 'check-failed' });
      mockGetCachedPersonalities.mockResolvedValue({
        kind: 'ok',
        value: [makeSummary('a', { tags: ['fantasy'] })],
      });
      const ctx = makeContext();

      await runTagChimeIn(ctx, { tag: 'fantasy', incognitoOption: null });

      expect(ctx.editReply).toHaveBeenCalledWith({ content: 'NSFW_CHECK_FAILED' });
      expect(mockTrackPending).not.toHaveBeenCalled();
      expect(mockRunCharacterTurn).not.toHaveBeenCalled();
    });

    it('runs the NSFW gate exactly once, against the original context, and proceeds when allowed', async () => {
      mockGetCachedPersonalities.mockResolvedValue({
        kind: 'ok',
        value: [makeSummary('a', { tags: ['fantasy'] }), makeSummary('b', { tags: ['fantasy'] })],
      });

      await runTagChimeIn(makeContext(), { tag: 'fantasy', incognitoOption: null });

      expect(mockEvaluateNsfwGate).toHaveBeenCalledTimes(1);
      expect(mockEvaluateNsfwGate).toHaveBeenCalledWith(sentinelUserClient, {
        type: ChannelType.GuildText,
      });
      expect(mockRunCharacterTurn).toHaveBeenCalledTimes(2);
    });

    it('skips the gate and still fans out when the context has no channel', async () => {
      mockGetCachedPersonalities.mockResolvedValue({
        kind: 'ok',
        value: [makeSummary('a', { tags: ['fantasy'] })],
      });
      const ctx = { ...makeContext(), channel: null };

      await runTagChimeIn(ctx, { tag: 'fantasy', incognitoOption: null });

      expect(mockEvaluateNsfwGate).not.toHaveBeenCalled();
      expect(mockRunCharacterTurn).toHaveBeenCalledTimes(1);
    });
  });
});

describe('sharedReplyContext', () => {
  it('redirects editReply to an ephemeral followUp', async () => {
    const ctx = makeContext();

    await sharedReplyContext(ctx).editReply({ content: 'blocked' });

    expect(ctx.editReply).not.toHaveBeenCalled();
    expect(ctx.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'blocked', flags: MessageFlags.Ephemeral })
    );
  });

  it('accepts the string form of editReply', async () => {
    const ctx = makeContext();

    await sharedReplyContext(ctx).editReply('blocked');

    expect(ctx.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'blocked', flags: MessageFlags.Ephemeral })
    );
  });

  it('turns deleteReply into a no-op so the notice survives', async () => {
    const ctx = makeContext();

    await sharedReplyContext(ctx).deleteReply();

    expect(ctx.deleteReply).not.toHaveBeenCalled();
  });

  it('leaves the rest of the context intact', () => {
    const ctx = makeContext();
    const view = sharedReplyContext(ctx);

    expect(view.user).toBe(ctx.user);
    expect(view.interaction).toBe(ctx.interaction);
    expect(view.followUp).toBe(ctx.followUp);
  });
});

describe('CHIME_IN_SELECTOR_USAGE_DETAIL', () => {
  it('names both selectors so the user knows what to supply', () => {
    expect(CHIME_IN_SELECTOR_USAGE_DETAIL).toContain('character');
    expect(CHIME_IN_SELECTOR_USAGE_DETAIL).toContain('tag');
  });
});
