import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleAdd } from './add.js';
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

vi.mock('./permissions.js', () => ({
  checkDenyPermission: vi.fn(),
}));

vi.mock('../../utils/adminApiClient.js', () => ({
  adminPostJson: vi.fn(),
}));

import { checkDenyPermission } from './permissions.js';
import { adminPostJson } from '../../utils/adminApiClient.js';

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

function mockErrorResponse(status: number, data: unknown): Response {
  return { ok: false, status, json: () => Promise.resolve(data) } as Response;
}

describe('handleAdd', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should add a bot-wide user denial', async () => {
    vi.mocked(checkDenyPermission).mockResolvedValue({ allowed: true, scopeId: '*' });
    vi.mocked(adminPostJson).mockResolvedValue(mockOkResponse({ success: true }));
    const context = createMockContext({ target: '999888777', type: 'USER', scope: 'BOT' });

    await handleAdd(context);

    expect(adminPostJson).toHaveBeenCalledWith(
      '/admin/denylist',
      {
        type: 'USER',
        discordId: '999888777',
        scope: 'BOT',
        scopeId: '*',
        mode: 'BLOCK',
        reason: undefined,
      },
      'user-123'
    );
    expect(context.editReply).toHaveBeenCalledWith(
      '✅ User <@999888777> (`999888777`) denied (bot-wide).'
    );
  });

  it('should add a channel-scoped denial with reason', async () => {
    vi.mocked(checkDenyPermission).mockResolvedValue({ allowed: true, scopeId: 'chan-123' });
    vi.mocked(adminPostJson).mockResolvedValue(mockOkResponse({ success: true }));
    const context = createMockContext({
      target: '999888777',
      scope: 'CHANNEL',
      reason: 'Spam',
    });

    await handleAdd(context);

    expect(adminPostJson).toHaveBeenCalledWith(
      '/admin/denylist',
      expect.objectContaining({
        scope: 'CHANNEL',
        scopeId: 'chan-123',
        reason: 'Spam',
      }),
      'user-123'
    );
    expect(context.editReply).toHaveBeenCalledWith(
      '✅ User <@999888777> (`999888777`) denied (channel-scoped).'
    );
  });

  it('should reject GUILD type with non-BOT scope', async () => {
    const context = createMockContext({ target: '111222333', type: 'GUILD', scope: 'CHANNEL' });

    await handleAdd(context);

    expect(context.editReply).toHaveBeenCalledWith('❌ Server denials only support Bot scope.');
    expect(checkDenyPermission).not.toHaveBeenCalled();
  });

  it('should stop when permission denied', async () => {
    vi.mocked(checkDenyPermission).mockResolvedValue({ allowed: false, scopeId: '' });
    const context = createMockContext({ target: '999888777' });

    await handleAdd(context);

    expect(adminPostJson).not.toHaveBeenCalled();
  });

  it('should strip Discord mention wrapper from target', async () => {
    vi.mocked(checkDenyPermission).mockResolvedValue({ allowed: true, scopeId: '*' });
    vi.mocked(adminPostJson).mockResolvedValue(mockOkResponse({ success: true }));
    const context = createMockContext({ target: '<@999888777>' });

    await handleAdd(context);

    expect(adminPostJson).toHaveBeenCalledWith(
      '/admin/denylist',
      expect.objectContaining({ discordId: '999888777' }),
      'user-123'
    );
  });

  it('should strip nickname mention wrapper from target', async () => {
    vi.mocked(checkDenyPermission).mockResolvedValue({ allowed: true, scopeId: '*' });
    vi.mocked(adminPostJson).mockResolvedValue(mockOkResponse({ success: true }));
    const context = createMockContext({ target: '<@!999888777>' });

    await handleAdd(context);

    expect(adminPostJson).toHaveBeenCalledWith(
      '/admin/denylist',
      expect.objectContaining({ discordId: '999888777' }),
      'user-123'
    );
  });

  it('should handle API error', async () => {
    vi.mocked(checkDenyPermission).mockResolvedValue({ allowed: true, scopeId: '*' });
    vi.mocked(adminPostJson).mockResolvedValue(
      mockErrorResponse(400, { message: 'Cannot deny the bot owner' })
    );
    const context = createMockContext({ target: '999888777' });

    await handleAdd(context);

    expect(context.editReply).toHaveBeenCalledWith('❌ Failed: Cannot deny the bot owner');
  });
});
