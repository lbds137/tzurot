import { describe, it, expect, vi } from 'vitest';
import { ChannelType } from 'discord.js';
import type { GuildTextBasedChannel } from 'discord.js';
import { satisfiesPrivateThreadMembership } from './threadAccess.js';

function mockChannel(overrides: Record<string, unknown>): GuildTextBasedChannel {
  return {
    isThread: vi.fn(() => false),
    type: ChannelType.GuildText,
    members: { fetch: vi.fn() },
    ...overrides,
  } as unknown as GuildTextBasedChannel;
}

describe('satisfiesPrivateThreadMembership', () => {
  it('returns true for a non-thread channel without a membership lookup', async () => {
    const membersFetch = vi.fn();
    const channel = mockChannel({
      isThread: vi.fn(() => false),
      members: { fetch: membersFetch },
    });

    const result = await satisfiesPrivateThreadMembership(channel, 'viewer-1');

    expect(result).toBe(true);
    expect(membersFetch).not.toHaveBeenCalled();
  });

  it('returns true for a public thread without a membership lookup', async () => {
    const membersFetch = vi.fn();
    const channel = mockChannel({
      isThread: vi.fn(() => true),
      type: ChannelType.PublicThread,
      members: { fetch: membersFetch },
    });

    const result = await satisfiesPrivateThreadMembership(channel, 'viewer-1');

    expect(result).toBe(true);
    expect(membersFetch).not.toHaveBeenCalled();
  });

  it('returns true for an announcement thread without a membership lookup', async () => {
    const membersFetch = vi.fn();
    const channel = mockChannel({
      isThread: vi.fn(() => true),
      type: ChannelType.AnnouncementThread,
      members: { fetch: membersFetch },
    });

    const result = await satisfiesPrivateThreadMembership(channel, 'viewer-1');

    expect(result).toBe(true);
    expect(membersFetch).not.toHaveBeenCalled();
  });

  it('returns true for a private thread when the fetch resolves (viewer is a member)', async () => {
    const membersFetch = vi.fn().mockResolvedValue({ id: 'viewer-1' });
    const channel = mockChannel({
      isThread: vi.fn(() => true),
      type: ChannelType.PrivateThread,
      members: { fetch: membersFetch },
    });

    const result = await satisfiesPrivateThreadMembership(channel, 'viewer-1');

    expect(result).toBe(true);
    expect(membersFetch).toHaveBeenCalledWith('viewer-1');
  });

  it('returns false for a private thread when the fetch throws (viewer is not a member)', async () => {
    const membersFetch = vi.fn().mockRejectedValue(new Error('Unknown Member'));
    const channel = mockChannel({
      isThread: vi.fn(() => true),
      type: ChannelType.PrivateThread,
      members: { fetch: membersFetch },
    });

    const result = await satisfiesPrivateThreadMembership(channel, 'viewer-1');

    expect(result).toBe(false);
    expect(membersFetch).toHaveBeenCalledWith('viewer-1');
  });
});
