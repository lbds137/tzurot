import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import {
  DescriptionPromptService,
  getDescriptionPrompt,
  registerDescriptionPrompt,
  resetDescriptionPromptRegistration,
} from './DescriptionPromptService.js';

function prismaWith(findFirst: ReturnType<typeof vi.fn>): PrismaClient {
  return { systemPrompt: { findFirst } } as unknown as PrismaClient;
}

describe('DescriptionPromptService', () => {
  beforeEach(() => {
    resetDescriptionPromptRegistration();
  });

  afterEach(() => {
    resetDescriptionPromptRegistration();
    vi.restoreAllMocks();
  });

  it('serves the isDefault row content after a refresh', async () => {
    const findFirst = vi.fn().mockResolvedValue({ content: 'You are a description engine.' });
    const service = new DescriptionPromptService(prismaWith(findFirst));

    await service.refresh();

    expect(service.get()).toBe('You are a description engine.');
    // Queries the DEFAULT row specifically — not whichever row a personality
    // happens to link, which is the whole point of the service.
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { isDefault: true } }));
  });

  it('is undefined before anything has loaded', () => {
    // Callers treat undefined as "send no system message" — the description
    // instruction in the user message stands alone, so a cold start degrades
    // to neutral rather than to a wrong framing.
    const service = new DescriptionPromptService(prismaWith(vi.fn()));

    expect(service.get()).toBeUndefined();
  });

  it('treats a configured-but-empty prompt as none', async () => {
    const service = new DescriptionPromptService(
      prismaWith(vi.fn().mockResolvedValue({ content: '' }))
    );

    await service.refresh();

    expect(service.get()).toBeUndefined();
  });

  it('treats a missing default row as none', async () => {
    const service = new DescriptionPromptService(prismaWith(vi.fn().mockResolvedValue(null)));

    await service.refresh();

    expect(service.get()).toBeUndefined();
  });

  it('keeps serving the previous value when a refresh fails', async () => {
    // Degrading mid-conversation would change how images are described for the
    // duration of an outage — worse than serving a slightly stale prompt.
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({ content: 'first' })
      .mockRejectedValueOnce(new Error('db down'));
    const service = new DescriptionPromptService(prismaWith(findFirst));

    await service.refresh();
    await service.refresh();

    expect(service.get()).toBe('first');
  });

  it('paces retries by the TTL after a failure instead of firing on every read', async () => {
    // This one query can fail while describes keep flowing — the personality
    // arrives as job-payload data, not a per-call fetch — so an un-paced retry
    // would issue a query per describe for the whole outage.
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({ content: 'primed' })
      .mockRejectedValue(new Error('db down'));
    const service = new DescriptionPromptService(prismaWith(findFirst), 60_000);

    await service.refresh();
    await service.refresh();
    const callsAfterFailure = findFirst.mock.calls.length;

    // Reads inside the TTL must not trigger further queries.
    service.get();
    service.get();

    expect(findFirst.mock.calls.length).toBe(callsAfterFailure);
    // And the last good value keeps serving — boot priming guarantees there is
    // one, so a failure degrades to stale rather than to no prompt at all.
    expect(service.get()).toBe('primed');
  });

  it('recovers once a later refresh succeeds', async () => {
    const findFirst = vi
      .fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({ content: 'recovered' });
    const service = new DescriptionPromptService(prismaWith(findFirst));

    await service.refresh();
    await service.refresh();

    expect(service.get()).toBe('recovered');
  });

  it('coalesces concurrent refreshes into one query', async () => {
    // Multi-character fan-out describes the same image N times at once; N
    // queries for one unchanging string is pure waste.
    let release: (v: { content: string }) => void = () => {};
    const findFirst = vi.fn().mockReturnValue(
      new Promise<{ content: string }>(resolve => {
        release = resolve;
      })
    );
    const service = new DescriptionPromptService(prismaWith(findFirst));

    const a = service.refresh();
    const b = service.refresh();
    release({ content: 'shared' });
    await Promise.all([a, b]);

    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('refreshes in the background once the TTL lapses, still returning synchronously', async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({ content: 'stale' })
      .mockResolvedValueOnce({ content: 'fresh' });
    const service = new DescriptionPromptService(prismaWith(findFirst), 1000);

    await service.refresh();
    // Past the TTL: the read must still be synchronous, serving stale.
    const duringRefresh = service.get(Date.now() + 5000);
    expect(duringRefresh).toBe('stale');

    await service.refresh();
    expect(service.get()).toBe('fresh');
  });
});

describe('getDescriptionPrompt (ambient)', () => {
  beforeEach(() => {
    resetDescriptionPromptRegistration();
  });

  afterEach(() => {
    resetDescriptionPromptRegistration();
  });

  it('is undefined when no instance is registered', () => {
    // Boot-order tolerance: a describe that races registration sends no system
    // message rather than throwing.
    expect(getDescriptionPrompt()).toBeUndefined();
  });

  it('reads through the registered instance', async () => {
    const service = new DescriptionPromptService(
      prismaWith(vi.fn().mockResolvedValue({ content: 'instance prompt' }))
    );
    await service.refresh();
    registerDescriptionPrompt(service);

    expect(getDescriptionPrompt()).toBe('instance prompt');
  });
});
