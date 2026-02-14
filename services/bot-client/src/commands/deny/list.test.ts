import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleList } from './list.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

// Mock dependencies
vi.mock('@tzurot/common-types', () => ({
  isBotOwner: vi.fn(),
  GATEWAY_TIMEOUTS: { DEFERRED: 10000 },
  getConfig: vi.fn(() => ({ BOT_OWNER_ID: 'owner-1' })),
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

vi.mock('../../utils/adminApiClient.js', () => ({
  adminFetch: vi.fn(),
}));

vi.mock('../../utils/commandContext/index.js', () => ({
  requireBotOwnerContext: vi.fn(),
}));

import { adminFetch } from '../../utils/adminApiClient.js';
import { requireBotOwnerContext } from '../../utils/commandContext/index.js';

function createMockContext(options: Record<string, unknown> = {}): DeferredCommandContext {
  const optionMap = new Map(Object.entries(options));
  return {
    user: { id: 'user-123' },
    guildId: 'guild-456',
    interaction: {
      options: {
        getChannel: vi.fn().mockReturnValue(options.channel ?? null),
      },
    },
    getOption: vi.fn((name: string) => optionMap.get(name) ?? null),
    getRequiredOption: vi.fn((name: string) => optionMap.get(name)),
    editReply: vi.fn(),
  } as unknown as DeferredCommandContext;
}

function mockOkResponse(data: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(data) } as Response;
}

describe('handleList', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireBotOwnerContext).mockResolvedValue(true);
  });

  it('should list all entries', async () => {
    const entries = [
      { type: 'USER', discordId: '111', scope: 'BOT', scopeId: '*', reason: 'Spam' },
      { type: 'GUILD', discordId: '222', scope: 'BOT', scopeId: '*', reason: null },
    ];
    vi.mocked(adminFetch).mockResolvedValue(mockOkResponse({ entries }));
    const context = createMockContext();

    await handleList(context);

    expect(context.editReply).toHaveBeenCalledWith(expect.stringContaining('Denylist Entries'));
    expect(context.editReply).toHaveBeenCalledWith(expect.stringContaining('`111`'));
  });

  it('should show empty message when no entries', async () => {
    vi.mocked(adminFetch).mockResolvedValue(mockOkResponse({ entries: [] }));
    const context = createMockContext();

    await handleList(context);

    expect(context.editReply).toHaveBeenCalledWith('No denylist entries found.');
  });

  it('should deny non-owner', async () => {
    vi.mocked(requireBotOwnerContext).mockResolvedValue(false);
    const context = createMockContext();

    await handleList(context);

    expect(adminFetch).not.toHaveBeenCalled();
  });

  it('should pass type filter to API', async () => {
    vi.mocked(adminFetch).mockResolvedValue(mockOkResponse({ entries: [] }));
    const context = createMockContext({ type: 'USER' });

    await handleList(context);

    expect(adminFetch).toHaveBeenCalledWith('/admin/denylist?type=USER', { userId: 'user-123' });
  });
});
