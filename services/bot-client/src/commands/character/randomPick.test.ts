/**
 * Tests for character/randomPick.ts
 *
 * Covers the resolver and the deferred-reply finalizer separately —
 * the integrated random-pick flow is exercised in chat.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LoadedPersonality } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    createLogger: () => mockLogger,
  };
});

const mockGetCachedPersonalities = vi.fn();
vi.mock('../../utils/autocomplete/autocompleteCache.js', () => ({
  getCachedPersonalities: (...args: unknown[]) => mockGetCachedPersonalities(...args),
}));

vi.mock('../../utils/userGatewayClient.js', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    toGatewayUser: vi.fn((user: { id: string; displayName: string }) => ({
      discordId: user.id,
      username: user.displayName,
      displayName: user.displayName,
    })),
  };
});

import { resolveCharacterSlug, finalizeDeferredReply } from './randomPick.js';

const makeSummary = (slug: string, displayName: string | null = null) => ({
  id: `id-${slug}`,
  slug,
  name: slug,
  displayName,
  isOwned: true,
  isPublic: false,
  ownerId: 'user-123',
  ownerDiscordId: 'user-123',
  permissions: { canEdit: true, canDelete: true, canView: true },
});

const makeContext = (): DeferredCommandContext =>
  ({
    user: { id: 'user-123', displayName: 'TestUser' },
    editReply: vi.fn().mockResolvedValue(undefined),
    deleteReply: vi.fn().mockResolvedValue(undefined),
  }) as unknown as DeferredCommandContext;

// File-scope hooks: cover both describe blocks. `restoreAllMocks` is
// load-bearing because tests use `vi.spyOn(Math, 'random')` which would
// otherwise leak across suites and into other test files.
beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveCharacterSlug', () => {
  it('returns the provided slug unchanged when one is supplied', async () => {
    const result = await resolveCharacterSlug('explicit-slug', makeContext());

    expect(result).toEqual({ kind: 'slug', slug: 'explicit-slug', randomPick: false });
    expect(mockGetCachedPersonalities).not.toHaveBeenCalled();
  });

  it('returns an error and logs the underlying cause when the personalities lookup fails', async () => {
    const cause = new Error('boom');
    mockGetCachedPersonalities.mockResolvedValue({ kind: 'error', error: cause });

    const result = await resolveCharacterSlug(null, makeContext());

    expect(result).toEqual({
      kind: 'error',
      message: expect.stringContaining('Unable to load characters'),
    });
    // Pin the diagnostic log so a future refactor can't silently drop it
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: cause, userId: 'user-123' }),
      expect.stringContaining('Personalities lookup failed')
    );
  });

  it('returns an error when the user has no accessible personalities', async () => {
    mockGetCachedPersonalities.mockResolvedValue({ kind: 'ok', value: [] });

    const result = await resolveCharacterSlug(null, makeContext());

    expect(result).toEqual({
      kind: 'error',
      message: expect.stringContaining('No characters available'),
    });
  });

  it('picks a slug from the pool with randomPick=true on the result', async () => {
    mockGetCachedPersonalities.mockResolvedValue({
      kind: 'ok',
      value: [makeSummary('only-one')],
    });

    const result = await resolveCharacterSlug(null, makeContext());

    expect(result).toEqual({ kind: 'slug', slug: 'only-one', randomPick: true });
  });

  it('uses Math.random output to index into the pool', async () => {
    const pool = ['a', 'b', 'c', 'd'].map(s => makeSummary(s));
    mockGetCachedPersonalities.mockResolvedValue({ kind: 'ok', value: pool });
    // 0.75 * 4 = 3 → index 3 → slug 'd'
    vi.spyOn(Math, 'random').mockReturnValue(0.75);

    const result = await resolveCharacterSlug(null, makeContext());

    expect(result).toEqual({ kind: 'slug', slug: 'd', randomPick: true });
  });
});

describe('finalizeDeferredReply', () => {
  const personality = {
    name: 'fallback-name',
    displayName: 'Fancy Name',
  } as unknown as LoadedPersonality;

  it('deletes the deferred reply for explicit picks', async () => {
    const ctx = makeContext();

    await finalizeDeferredReply(ctx, personality, false);

    expect(ctx.deleteReply).toHaveBeenCalled();
    expect(ctx.editReply).not.toHaveBeenCalled();
  });

  it('edits the deferred reply with the dice notice for random picks', async () => {
    const ctx = makeContext();

    await finalizeDeferredReply(ctx, personality, true);

    expect(ctx.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('🎲'),
    });
    expect(ctx.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Fancy Name'),
    });
    expect(ctx.deleteReply).not.toHaveBeenCalled();
  });

  it('falls back to personality.name when displayName is null', async () => {
    const ctx = makeContext();
    const noDisplayName = {
      name: 'fallback-name',
      displayName: null,
    } as unknown as LoadedPersonality;

    await finalizeDeferredReply(ctx, noDisplayName, true);

    expect(ctx.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('fallback-name'),
    });
  });
});
