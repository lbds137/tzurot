import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { User } from 'discord.js';
import { DMCacheWarmer } from './DMCacheWarmer.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

function mockUser(id: string, createDM = vi.fn().mockResolvedValue({})): User {
  return { id, createDM } as unknown as User;
}

describe('DMCacheWarmer', () => {
  let warmer: DMCacheWarmer;

  beforeEach(() => {
    vi.useFakeTimers();
    warmer = new DMCacheWarmer();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls user.createDM() on first warm', () => {
    const createDM = vi.fn().mockResolvedValue({});
    const user = mockUser('user-1', createDM);

    warmer.warm(user);

    expect(createDM).toHaveBeenCalledTimes(1);
    expect(warmer.has('user-1')).toBe(true);
  });

  it('skips createDM() on second warm of the same user', () => {
    const createDM = vi.fn().mockResolvedValue({});
    const user = mockUser('user-1', createDM);

    warmer.warm(user);
    warmer.warm(user);
    warmer.warm(user);

    expect(createDM).toHaveBeenCalledTimes(1);
  });

  it('warms different users independently', () => {
    const createDM1 = vi.fn().mockResolvedValue({});
    const createDM2 = vi.fn().mockResolvedValue({});

    warmer.warm(mockUser('user-1', createDM1));
    warmer.warm(mockUser('user-2', createDM2));

    expect(createDM1).toHaveBeenCalledTimes(1);
    expect(createDM2).toHaveBeenCalledTimes(1);
    expect(warmer.size).toBe(2);
  });

  it('does not throw or reject when createDM fails', async () => {
    const createDM = vi.fn().mockRejectedValue(new Error('DMs disabled'));
    const user = mockUser('user-1', createDM);

    // Synchronous warm() must not throw
    expect(() => warmer.warm(user)).not.toThrow();

    // The Set entry was added even though createDM failed — this is intentional
    // (we don't want to retry repeatedly for users who have DMs blocked).
    expect(warmer.has('user-1')).toBe(true);

    // Flush microtasks so the rejected promise settles before assertions
    await vi.runAllTimersAsync();
  });

  it('warmAwaitable returns true when createDM resolves', async () => {
    const createDM = vi.fn().mockResolvedValue({});
    const result = await warmer.warmAwaitable(mockUser('user-1', createDM));

    expect(result).toBe(true);
    expect(createDM).toHaveBeenCalledTimes(1);
    expect(warmer.has('user-1')).toBe(true);
  });

  it('warmAwaitable returns false when createDM rejects (but still memoizes)', async () => {
    const createDM = vi.fn().mockRejectedValue(new Error('bot quarantined'));
    const result = await warmer.warmAwaitable(mockUser('user-1', createDM));

    expect(result).toBe(false);
    // Memoized despite failure — one attempt per process lifetime, same as warm().
    expect(warmer.has('user-1')).toBe(true);
  });

  it('warmAwaitable returns the STORED failure on a repeat call, not a hardcoded true', async () => {
    const createDM = vi.fn().mockRejectedValue(new Error('bot quarantined'));
    const user = mockUser('user-1', createDM);

    const first = await warmer.warmAwaitable(user);
    const second = await warmer.warmAwaitable(user);

    // The memo tracks OUTCOME, not just "attempted": a failed user must stay
    // false on the next call. The race this guards: the live event path warms
    // (and fails) a user, then the startup prewarmer reaches the same user and
    // must count them failed, not warmed.
    expect(first).toBe(false);
    expect(second).toBe(false);
    expect(createDM).toHaveBeenCalledTimes(1);
  });

  it('warmAwaitable returns true for an already-warmed user without a second createDM', async () => {
    const createDM = vi.fn().mockResolvedValue({});
    const user = mockUser('user-1', createDM);

    await warmer.warmAwaitable(user);
    const second = await warmer.warmAwaitable(user);

    expect(second).toBe(true);
    expect(createDM).toHaveBeenCalledTimes(1);
  });

  it('clear() empties the memo', () => {
    warmer.warm(mockUser('user-1'));
    warmer.warm(mockUser('user-2'));
    expect(warmer.size).toBe(2);

    warmer.clear();

    expect(warmer.size).toBe(0);
    expect(warmer.has('user-1')).toBe(false);
  });

  it('post-clear, the same user can be warmed again', () => {
    const createDM = vi.fn().mockResolvedValue({});
    const user = mockUser('user-1', createDM);

    warmer.warm(user);
    expect(createDM).toHaveBeenCalledTimes(1);

    warmer.clear();
    warmer.warm(user);

    expect(createDM).toHaveBeenCalledTimes(2);
  });
});
