import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageReferenceType } from 'discord.js';
import type { Message } from 'discord.js';

vi.mock('../../utils/forwardedMessageUtils.js', async () => {
  const actual = await vi.importActual<typeof import('../../utils/forwardedMessageUtils.js')>(
    '../../utils/forwardedMessageUtils.js'
  );
  return { ...actual, resolveForwardedOrigin: vi.fn(() => Promise.resolve(undefined)) };
});

const { resolveForwardedOrigin } = await import('../../utils/forwardedMessageUtils.js');
const { __resetForwardedOriginCacheForTests, MAX_FORWARD_ORIGIN_RESOLUTIONS_PER_FETCH } =
  await import('../../utils/forwardedOriginCache.js');
const { primeForwardOriginsForWindow } = await import('./forwardOriginPrePass.js');

function forward(id: string): Message {
  return {
    id,
    reference: { type: MessageReferenceType.Forward, channelId: 'c-1', messageId: `orig-${id}` },
  } as unknown as Message;
}

function plain(id: string): Message {
  return { id, reference: null } as unknown as Message;
}

const baseOptions = { botUserId: 'bot-1' };
const resolver = (): Promise<string | undefined> => Promise.resolve(undefined);

describe('primeForwardOriginsForWindow', () => {
  beforeEach(() => {
    __resetForwardedOriginCacheForTests();
    vi.mocked(resolveForwardedOrigin).mockReset();
    vi.mocked(resolveForwardedOrigin).mockResolvedValue(undefined);
  });

  it('does nothing when no resolver is wired', async () => {
    await primeForwardOriginsForWindow([forward('f1')], baseOptions);

    expect(resolveForwardedOrigin).not.toHaveBeenCalled();
  });

  it('does nothing when the window holds no forwards', async () => {
    await primeForwardOriginsForWindow([plain('p1'), plain('p2')], {
      ...baseOptions,
      resolveForwardedAuthorPersonalityId: resolver,
    });

    expect(resolveForwardedOrigin).not.toHaveBeenCalled();
  });

  it('primes only the forwarded messages in the window', async () => {
    const fwd = forward('f1');

    await primeForwardOriginsForWindow([plain('p1'), fwd, plain('p2')], {
      ...baseOptions,
      resolveForwardedAuthorPersonalityId: resolver,
    });

    expect(resolveForwardedOrigin).toHaveBeenCalledTimes(1);
    expect(resolveForwardedOrigin).toHaveBeenCalledWith(fwd, resolver);
  });

  it('keeps the newest forwards when the window exceeds the cap', async () => {
    const overCap = MAX_FORWARD_ORIGIN_RESOLUTIONS_PER_FETCH + 3;
    // Oldest-first, matching the order the fetcher hands over.
    const messages = Array.from({ length: overCap }, (_, i) => forward(`f${i}`));

    await primeForwardOriginsForWindow(messages, {
      ...baseOptions,
      resolveForwardedAuthorPersonalityId: resolver,
    });

    const resolvedIds = vi
      .mocked(resolveForwardedOrigin)
      .mock.calls.map(call => (call[0] as Message).id);
    expect(resolvedIds).toHaveLength(MAX_FORWARD_ORIGIN_RESOLUTIONS_PER_FETCH);
    expect(resolvedIds).toContain(`f${overCap - 1}`);
    expect(resolvedIds).not.toContain('f0');
    expect(resolvedIds).not.toContain('f2');
  });
});
