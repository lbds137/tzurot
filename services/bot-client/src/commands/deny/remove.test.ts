import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleRemove } from './remove.js';
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
  adminFetch: vi.fn(),
}));

import { checkDenyPermission } from './permissions.js';
import { adminFetch } from '../../utils/adminApiClient.js';

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

describe('handleRemove', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should remove a denial entry', async () => {
    vi.mocked(checkDenyPermission).mockResolvedValue({ allowed: true, scopeId: '*' });
    vi.mocked(adminFetch).mockResolvedValue(mockOkResponse({ success: true }));
    const context = createMockContext({ target: '999888777', type: 'USER', scope: 'BOT' });

    await handleRemove(context);

    expect(adminFetch).toHaveBeenCalledWith('/admin/denylist/USER/999888777/BOT/*', {
      method: 'DELETE',
      userId: 'user-123',
    });
    expect(context.editReply).toHaveBeenCalledWith(
      '✅ Denial removed for `999888777` (bot scope).'
    );
  });

  it('should handle not found', async () => {
    vi.mocked(checkDenyPermission).mockResolvedValue({ allowed: true, scopeId: '*' });
    vi.mocked(adminFetch).mockResolvedValue(mockErrorResponse(404, { message: 'Not found' }));
    const context = createMockContext({ target: '999888777' });

    await handleRemove(context);

    expect(context.editReply).toHaveBeenCalledWith('❌ No matching denial entry found.');
  });

  it('should stop when permission denied', async () => {
    vi.mocked(checkDenyPermission).mockResolvedValue({ allowed: false, scopeId: '' });
    const context = createMockContext({ target: '999888777' });

    await handleRemove(context);

    expect(adminFetch).not.toHaveBeenCalled();
  });
});
