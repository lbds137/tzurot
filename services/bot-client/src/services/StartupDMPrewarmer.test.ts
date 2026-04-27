import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Client, User } from 'discord.js';
import { StartupDMPrewarmer } from './StartupDMPrewarmer.js';
import type { DMCacheWarmer } from './DMCacheWarmer.js';

const mockAdminFetch = vi.fn();
vi.mock('../utils/adminApiClient.js', () => ({
  adminFetch: (...args: unknown[]) => mockAdminFetch(...args),
}));

vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

function mockJsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function mockUser(id: string): User {
  return { id, createDM: vi.fn().mockResolvedValue({}) } as unknown as User;
}

describe('StartupDMPrewarmer', () => {
  let prewarmer: StartupDMPrewarmer;
  let mockClient: { users: { fetch: ReturnType<typeof vi.fn> } };
  let mockWarmer: { warm: ReturnType<typeof vi.fn> };
  let mockSleep: ReturnType<typeof vi.fn<(ms: number) => Promise<void>>>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockAdminFetch.mockReset();
    mockClient = { users: { fetch: vi.fn() } };
    mockWarmer = { warm: vi.fn() };
    mockSleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
    prewarmer = new StartupDMPrewarmer({
      client: mockClient as unknown as Client,
      warmer: mockWarmer as unknown as DMCacheWarmer,
      sleep: mockSleep,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('warms each user returned by the recent-users endpoint', async () => {
    mockAdminFetch.mockResolvedValue(
      mockJsonResponse({
        discordIds: ['111111111111111111', '222222222222222222'],
        sinceDays: 30,
      })
    );
    mockClient.users.fetch
      .mockResolvedValueOnce(mockUser('111111111111111111'))
      .mockResolvedValueOnce(mockUser('222222222222222222'));

    await prewarmer.run();

    expect(mockClient.users.fetch).toHaveBeenCalledTimes(2);
    expect(mockClient.users.fetch).toHaveBeenCalledWith('111111111111111111');
    expect(mockClient.users.fetch).toHaveBeenCalledWith('222222222222222222');
    expect(mockWarmer.warm).toHaveBeenCalledTimes(2);
    expect(mockSleep).toHaveBeenCalledWith(1000);
  });

  it('rate-limits with 1000ms sleep between fetches (N-1 sleeps for N users)', async () => {
    mockAdminFetch.mockResolvedValue(
      mockJsonResponse({
        discordIds: ['111111111111111111', '222222222222222222', '333333333333333333'],
        sinceDays: 30,
      })
    );
    mockClient.users.fetch.mockImplementation((id: string) => Promise.resolve(mockUser(id)));

    await prewarmer.run();

    // 3 users → 2 sleeps (between requests, not after the last one)
    expect(mockSleep).toHaveBeenCalledTimes(2);
    expect(mockSleep).toHaveBeenCalledWith(1000);
  });

  it('does not sleep at all for a single-user list', async () => {
    mockAdminFetch.mockResolvedValue(
      mockJsonResponse({ discordIds: ['111111111111111111'], sinceDays: 30 })
    );
    mockClient.users.fetch.mockResolvedValue(mockUser('111111111111111111'));

    await prewarmer.run();

    expect(mockSleep).not.toHaveBeenCalled();
    expect(mockWarmer.warm).toHaveBeenCalledTimes(1);
  });

  it('continues when a single user fetch fails (e.g. deleted account)', async () => {
    mockAdminFetch.mockResolvedValue(
      mockJsonResponse({
        discordIds: ['111111111111111111', '222222222222222222', '333333333333333333'],
        sinceDays: 30,
      })
    );
    mockClient.users.fetch
      .mockResolvedValueOnce(mockUser('111111111111111111'))
      .mockRejectedValueOnce(new Error('Unknown User'))
      .mockResolvedValueOnce(mockUser('333333333333333333'));

    await prewarmer.run();

    expect(mockClient.users.fetch).toHaveBeenCalledTimes(3);
    expect(mockWarmer.warm).toHaveBeenCalledTimes(2);
  });

  it('skips warming entirely when api-gateway fetch fails', async () => {
    mockAdminFetch.mockRejectedValue(new Error('connect ECONNREFUSED'));

    await prewarmer.run();

    expect(mockClient.users.fetch).not.toHaveBeenCalled();
    expect(mockWarmer.warm).not.toHaveBeenCalled();
  });

  it('skips warming when api-gateway returns non-2xx', async () => {
    mockAdminFetch.mockResolvedValue(mockJsonResponse({}, false, 503));

    await prewarmer.run();

    expect(mockClient.users.fetch).not.toHaveBeenCalled();
  });

  it('skips warming when api-gateway returns malformed body', async () => {
    mockAdminFetch.mockResolvedValue(mockJsonResponse({ wrong: 'shape' }));

    await prewarmer.run();

    expect(mockClient.users.fetch).not.toHaveBeenCalled();
  });

  it('returns silently when the recent-users list is empty', async () => {
    mockAdminFetch.mockResolvedValue(mockJsonResponse({ discordIds: [], sinceDays: 30 }));

    await prewarmer.run();

    expect(mockClient.users.fetch).not.toHaveBeenCalled();
    expect(mockSleep).not.toHaveBeenCalled();
  });

  it('calls the recent-users endpoint with sinceDays=30', async () => {
    mockAdminFetch.mockResolvedValue(mockJsonResponse({ discordIds: [], sinceDays: 30 }));

    await prewarmer.run();

    expect(mockAdminFetch).toHaveBeenCalledWith('/internal/users/recent?sinceDays=30');
  });
});
