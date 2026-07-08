/**
 * Tests for character/randomPick.ts
 *
 * Covers the resolver and the deferred-reply finalizer separately —
 * the integrated random-pick flow is exercised in chat.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => mockLogger,
  };
});

const mockGetCachedPersonalities = vi.fn();
vi.mock('../../utils/autocomplete/autocompleteCache.js', () => ({
  getCachedPersonalities: (...args: unknown[]) => mockGetCachedPersonalities(...args),
}));

// Mock clientsFor — the cache mock above doesn't care about the userClient
// identity, so a structurally-empty stub suffices.
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: {} })),
}));

import { resolveCharacterSlug, finalizeDeferredReply } from './randomPick.js';

const makeSummary = (
  slug: string,
  opts: { displayName?: string | null; isPublic?: boolean; isOwned?: boolean } = {}
) => ({
  id: `id-${slug}`,
  slug,
  name: slug,
  displayName: opts.displayName ?? null,
  isOwned: opts.isOwned ?? true,
  isPublic: opts.isPublic ?? false,
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
      message: expect.stringContaining('Failed to load the characters'),
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

  it('with excludePrivate=true, filters out non-public personalities before picking', async () => {
    mockGetCachedPersonalities.mockResolvedValue({
      kind: 'ok',
      value: [
        makeSummary('mine-private', { isPublic: false }),
        makeSummary('public-one', { isPublic: true }),
        makeSummary('public-two', { isPublic: true }),
      ],
    });
    // index 1 of 2 candidates → 'public-two'
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const result = await resolveCharacterSlug(null, makeContext(), { excludePrivate: true });

    expect(result).toEqual({ kind: 'slug', slug: 'public-two', randomPick: true });
  });

  it('with excludePrivate=true and only-private pool, the error names the active filter', async () => {
    mockGetCachedPersonalities.mockResolvedValue({
      kind: 'ok',
      value: [
        makeSummary('mine-1', { isPublic: false }),
        makeSummary('mine-2', { isPublic: false }),
      ],
    });

    const result = await resolveCharacterSlug(null, makeContext(), { excludePrivate: true });

    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toContain('No characters available');
      // Names the specific filter so the user knows what to toggle off
      expect(result.message).toContain('exclude-private');
    }
  });

  it('with excludePrivate=false (default), private personalities stay in the pool', async () => {
    mockGetCachedPersonalities.mockResolvedValue({
      kind: 'ok',
      value: [makeSummary('only-private', { isPublic: false })],
    });

    const result = await resolveCharacterSlug(null, makeContext());

    expect(result).toEqual({ kind: 'slug', slug: 'only-private', randomPick: true });
  });

  // --- only-mine filter (independent of excludePrivate, AND-composable) ---

  it('with onlyMine=true, filters the pool to user-owned personalities', async () => {
    mockGetCachedPersonalities.mockResolvedValue({
      kind: 'ok',
      value: [
        makeSummary('not-mine-public', { isPublic: true, isOwned: false }),
        makeSummary('mine-private', { isPublic: false, isOwned: true }),
        makeSummary('not-mine-other', { isPublic: true, isOwned: false }),
      ],
    });
    vi.spyOn(Math, 'random').mockReturnValue(0); // pick index 0 of survivors

    const result = await resolveCharacterSlug(null, makeContext(), { onlyMine: true });

    expect(result).toEqual({ kind: 'slug', slug: 'mine-private', randomPick: true });
  });

  it('with onlyMine=true AND excludePrivate=true, filters to user-owned AND public (intersection)', async () => {
    mockGetCachedPersonalities.mockResolvedValue({
      kind: 'ok',
      value: [
        makeSummary('not-mine-public', { isPublic: true, isOwned: false }),
        makeSummary('mine-private', { isPublic: false, isOwned: true }),
        makeSummary('mine-public-1', { isPublic: true, isOwned: true }),
        makeSummary('mine-public-2', { isPublic: true, isOwned: true }),
      ],
    });
    vi.spyOn(Math, 'random').mockReturnValue(0); // pick index 0 of survivors

    const result = await resolveCharacterSlug(null, makeContext(), {
      onlyMine: true,
      excludePrivate: true,
    });

    expect(result).toEqual({ kind: 'slug', slug: 'mine-public-1', randomPick: true });
  });

  it('with onlyMine=true and no owned personalities in the pool, the error names the active filter', async () => {
    mockGetCachedPersonalities.mockResolvedValue({
      kind: 'ok',
      value: [
        makeSummary('not-mine-1', { isPublic: true, isOwned: false }),
        makeSummary('not-mine-2', { isPublic: true, isOwned: false }),
      ],
    });

    const result = await resolveCharacterSlug(null, makeContext(), { onlyMine: true });

    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toContain('No characters available');
      expect(result.message).toContain('only-mine');
    }
  });

  it('with both filters on and empty intersection, the error lists both filter names', async () => {
    mockGetCachedPersonalities.mockResolvedValue({
      kind: 'ok',
      value: [
        // User owns one private; doesn't own any public — the intersection is empty
        makeSummary('mine-private', { isPublic: false, isOwned: true }),
        makeSummary('not-mine-public', { isPublic: true, isOwned: false }),
      ],
    });

    const result = await resolveCharacterSlug(null, makeContext(), {
      onlyMine: true,
      excludePrivate: true,
    });

    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toContain('only-mine');
      expect(result.message).toContain('exclude-private');
    }
  });

  it('uses plural "filters active" wording when both filters are on and pool is empty', async () => {
    // Pins the plural-branch of the `filterNoun` ternary — the singular
    // "filter on" path is exercised by the two single-filter tests above.
    mockGetCachedPersonalities.mockResolvedValue({ kind: 'ok', value: [] });

    const result = await resolveCharacterSlug(null, makeContext(), {
      onlyMine: true,
      excludePrivate: true,
    });

    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toContain('filters active');
      expect(result.message).not.toContain('filter on');
    }
  });

  it('uses singular "filter on" wording when only one filter is active', async () => {
    // Companion to the plural-branch test above — pins the singular path
    // so a future refactor can't collapse both into one form silently.
    mockGetCachedPersonalities.mockResolvedValue({ kind: 'ok', value: [] });

    const result = await resolveCharacterSlug(null, makeContext(), {
      onlyMine: true,
    });

    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toContain('filter on');
      expect(result.message).not.toContain('filters active');
    }
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
