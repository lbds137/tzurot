import { describe, it, expect, vi } from 'vitest';
import type { Client, User } from 'discord.js';
import { resolveRerollTurnUser } from './rerollTurnUser.js';

function clientWith(fetch: ReturnType<typeof vi.fn>): Client {
  return { users: { fetch } } as unknown as Client;
}

describe('resolveRerollTurnUser', () => {
  it('fetches the owner by Discord id and returns the user', async () => {
    const owner = { id: 'owner-1' } as unknown as User;
    const fetch = vi.fn().mockResolvedValue(owner);

    await expect(resolveRerollTurnUser(clientWith(fetch), 'owner-1')).resolves.toBe(owner);
    expect(fetch).toHaveBeenCalledWith('owner-1');
  });

  it('returns null when Discord cannot resolve the owner', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('Unknown User'));

    await expect(resolveRerollTurnUser(clientWith(fetch), 'gone')).resolves.toBeNull();
  });
});
