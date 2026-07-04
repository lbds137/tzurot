import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Client, User } from 'discord.js';
import { StartupDMPrewarmer } from './StartupDMPrewarmer.js';
import type { DMCacheWarmer } from './DMCacheWarmer.js';

const mockRecentUsers = vi.fn();
vi.mock('../utils/gatewayClients.js', () => ({
  getServiceClient: () => ({ recentUsers: mockRecentUsers }),
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

function okResult(body: { discordIds: string[]; sinceDays: number }) {
  return { ok: true, data: body };
}

function errResult(status: number) {
  return { ok: false, error: 'fail', status };
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
    mockRecentUsers.mockReset();
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
    mockRecentUsers.mockResolvedValue(
      okResult({
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
    mockRecentUsers.mockResolvedValue(
      okResult({
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
    mockRecentUsers.mockResolvedValue(
      okResult({ discordIds: ['111111111111111111'], sinceDays: 30 })
    );
    mockClient.users.fetch.mockResolvedValue(mockUser('111111111111111111'));

    await prewarmer.run();

    expect(mockSleep).not.toHaveBeenCalled();
    expect(mockWarmer.warm).toHaveBeenCalledTimes(1);
  });

  it('continues when a single user fetch fails (e.g. deleted account)', async () => {
    mockRecentUsers.mockResolvedValue(
      okResult({
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

  it('skips warming entirely when api-gateway fetch fails on every retry (network errors)', async () => {
    mockRecentUsers.mockRejectedValue(new Error('connect ECONNREFUSED'));

    await prewarmer.run();

    expect(mockClient.users.fetch).not.toHaveBeenCalled();
    expect(mockWarmer.warm).not.toHaveBeenCalled();
    // 1 initial attempt + 3 retries = 4 total calls
    expect(mockRecentUsers).toHaveBeenCalledTimes(4);
  });

  it('skips warming entirely when api-gateway returns 404 on every retry (status-based exhaustion)', async () => {
    // Different code path from network-error exhaustion: this exercises the
    // status-based retry branch in fetchOnce() rather than the catch block.
    mockRecentUsers.mockResolvedValue(errResult(404));

    await prewarmer.run();

    expect(mockClient.users.fetch).not.toHaveBeenCalled();
    expect(mockWarmer.warm).not.toHaveBeenCalled();
    expect(mockRecentUsers).toHaveBeenCalledTimes(4);
    // Sleep called once per retry delay (3 retries → 3 sleeps; no sleep
    // before the initial attempt or after the final failure).
    expect(mockSleep).toHaveBeenCalledTimes(3);
  });

  it('retries on 404 and succeeds when api-gateway becomes ready', async () => {
    // Simulates the empirical race observed on first dev deploy:
    // api-gateway routes weren't yet mounted when bot-client's ClientReady
    // fired, so the first call got 404. With retry-with-backoff, the second
    // call (after the api-gateway finishes startup) succeeds.
    mockRecentUsers
      .mockResolvedValueOnce(errResult(404))
      .mockResolvedValueOnce(okResult({ discordIds: ['111111111111111111'], sinceDays: 30 }));
    mockClient.users.fetch.mockResolvedValue(mockUser('111111111111111111'));

    await prewarmer.run();

    expect(mockRecentUsers).toHaveBeenCalledTimes(2);
    expect(mockWarmer.warm).toHaveBeenCalledTimes(1);
    expect(mockSleep).toHaveBeenCalledWith(5000); // first retry delay
  });

  it('retries on 5xx responses (gateway still starting)', async () => {
    mockRecentUsers
      .mockResolvedValueOnce(errResult(503))
      .mockResolvedValueOnce(okResult({ discordIds: ['111111111111111111'], sinceDays: 30 }));
    mockClient.users.fetch.mockResolvedValue(mockUser('111111111111111111'));

    await prewarmer.run();

    expect(mockRecentUsers).toHaveBeenCalledTimes(2);
    expect(mockWarmer.warm).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, 'auth required'],
    [403, 'forbidden'],
    [400, 'bad request'],
  ])("does NOT retry on %d (%s — won't fix itself)", async (status: number) => {
    mockRecentUsers.mockResolvedValue(errResult(status));

    await prewarmer.run();

    expect(mockRecentUsers).toHaveBeenCalledTimes(1);
    expect(mockClient.users.fetch).not.toHaveBeenCalled();
  });

  it('skips warming when api-gateway returns malformed body (status 0, treated as fatal)', async () => {
    // The typed client's outputSchema.safeParse failure returns
    // { ok: false, status: 0 } — not 404, not >= 500, so fetchOnce()
    // routes it through the fatal branch. Equivalent to the pre-migration
    // RecentUsersResponseSchema.safeParse path that returned kind: 'fatal'.
    // Guards against a future change where transport.ts starts throwing
    // instead of returning {ok:false} on schema validation failure.
    mockRecentUsers.mockResolvedValue({ ok: false, status: 0, error: 'schema failed' });

    await prewarmer.run();

    expect(mockClient.users.fetch).not.toHaveBeenCalled();
    expect(mockRecentUsers).toHaveBeenCalledTimes(1); // no retry
  });

  it('returns silently when the recent-users list is empty', async () => {
    mockRecentUsers.mockResolvedValue(okResult({ discordIds: [], sinceDays: 30 }));

    await prewarmer.run();

    expect(mockClient.users.fetch).not.toHaveBeenCalled();
    expect(mockSleep).not.toHaveBeenCalled();
  });

  it('calls the recent-users endpoint with sinceDays=30', async () => {
    mockRecentUsers.mockResolvedValue(okResult({ discordIds: [], sinceDays: 30 }));

    await prewarmer.run();

    expect(mockRecentUsers).toHaveBeenCalledWith({ sinceDays: '30' });
  });
});
