import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkDenyPermission } from './permissions.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

// Mock dependencies
vi.mock('@tzurot/common-types', () => ({
  isBotOwner: vi.fn(),
  GATEWAY_TIMEOUTS: { DEFERRED: 10000 },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

vi.mock('../../utils/permissions.js', () => ({
  requireManageMessagesContext: vi.fn(),
}));

vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: vi.fn(),
}));

import { isBotOwner } from '@tzurot/common-types';
import { requireManageMessagesContext } from '../../utils/permissions.js';
import { callGatewayApi } from '../../utils/userGatewayClient.js';

function createMockContext(
  overrides: Partial<DeferredCommandContext> = {}
): DeferredCommandContext {
  return {
    user: { id: 'user-123' },
    guildId: 'guild-456',
    member: { permissions: { has: vi.fn().mockReturnValue(true) } },
    interaction: {
      options: { getChannel: vi.fn().mockReturnValue(null) },
    },
    editReply: vi.fn(),
    ...overrides,
  } as unknown as DeferredCommandContext;
}

describe('checkDenyPermission', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(isBotOwner).mockReturnValue(false);
    vi.mocked(requireManageMessagesContext).mockResolvedValue(true);
  });

  describe('BOT scope', () => {
    it('should allow bot owner', async () => {
      vi.mocked(isBotOwner).mockReturnValue(true);
      const context = createMockContext();

      const result = await checkDenyPermission(context, 'BOT', null, null);

      expect(result).toEqual({ allowed: true, scopeId: '*' });
    });

    it('should deny non-owner', async () => {
      const context = createMockContext();

      const result = await checkDenyPermission(context, 'BOT', null, null);

      expect(result.allowed).toBe(false);
      expect(context.editReply).toHaveBeenCalledWith(
        '❌ Only the bot owner can manage bot-wide denials.'
      );
    });
  });

  describe('GUILD scope', () => {
    it('should allow bot owner in a guild', async () => {
      vi.mocked(isBotOwner).mockReturnValue(true);
      const context = createMockContext({ guildId: 'guild-789' });

      const result = await checkDenyPermission(context, 'GUILD', null, null);

      expect(result).toEqual({ allowed: true, scopeId: 'guild-789' });
    });

    it('should deny bot owner not in a guild', async () => {
      vi.mocked(isBotOwner).mockReturnValue(true);
      const context = createMockContext({ guildId: null });

      const result = await checkDenyPermission(context, 'GUILD', null, null);

      expect(result.allowed).toBe(false);
      expect(context.editReply).toHaveBeenCalledWith('❌ Guild scope requires being in a server.');
    });

    it('should allow server mod in their guild', async () => {
      const context = createMockContext({ guildId: 'guild-456' });

      const result = await checkDenyPermission(context, 'GUILD', null, null);

      expect(result).toEqual({ allowed: true, scopeId: 'guild-456' });
      expect(requireManageMessagesContext).toHaveBeenCalledWith(context);
    });

    it('should deny user without ManageMessages', async () => {
      vi.mocked(requireManageMessagesContext).mockResolvedValue(false);
      const context = createMockContext();

      const result = await checkDenyPermission(context, 'GUILD', null, null);

      expect(result.allowed).toBe(false);
    });
  });

  describe('CHANNEL scope', () => {
    it('should allow bot owner with channel', async () => {
      vi.mocked(isBotOwner).mockReturnValue(true);
      const context = createMockContext();

      const result = await checkDenyPermission(context, 'CHANNEL', 'channel-789', null);

      expect(result).toEqual({ allowed: true, scopeId: 'channel-789' });
    });

    it('should deny when channel option missing', async () => {
      vi.mocked(isBotOwner).mockReturnValue(true);
      const context = createMockContext();

      const result = await checkDenyPermission(context, 'CHANNEL', null, null);

      expect(result.allowed).toBe(false);
      expect(context.editReply).toHaveBeenCalledWith(
        '❌ Channel scope requires the `channel` option.'
      );
    });

    it('should allow server mod with channel', async () => {
      const context = createMockContext();

      const result = await checkDenyPermission(context, 'CHANNEL', 'channel-789', null);

      expect(result).toEqual({ allowed: true, scopeId: 'channel-789' });
      expect(requireManageMessagesContext).toHaveBeenCalledWith(context);
    });

    it('should deny non-mod without ManageMessages', async () => {
      vi.mocked(requireManageMessagesContext).mockResolvedValue(false);
      const context = createMockContext();

      const result = await checkDenyPermission(context, 'CHANNEL', 'channel-789', null);

      expect(result.allowed).toBe(false);
    });
  });

  describe('PERSONALITY scope', () => {
    it('should allow bot owner and resolve personality ID', async () => {
      vi.mocked(isBotOwner).mockReturnValue(true);
      vi.mocked(callGatewayApi).mockResolvedValue({
        ok: true,
        data: { personality: { id: 'pers-uuid-123' }, canEdit: true },
      });
      const context = createMockContext();

      const result = await checkDenyPermission(context, 'PERSONALITY', null, 'my-character');

      expect(result).toEqual({ allowed: true, scopeId: 'pers-uuid-123' });
    });

    it('should allow character creator with canEdit', async () => {
      vi.mocked(callGatewayApi).mockResolvedValue({
        ok: true,
        data: { personality: { id: 'pers-uuid-456' }, canEdit: true },
      });
      const context = createMockContext();

      const result = await checkDenyPermission(context, 'PERSONALITY', null, 'their-character');

      expect(result).toEqual({ allowed: true, scopeId: 'pers-uuid-456' });
    });

    it('should deny user without canEdit', async () => {
      vi.mocked(callGatewayApi).mockResolvedValue({
        ok: true,
        data: { personality: { id: 'pers-uuid-789' }, canEdit: false },
      });
      const context = createMockContext();

      const result = await checkDenyPermission(context, 'PERSONALITY', null, 'other-character');

      expect(result.allowed).toBe(false);
      expect(context.editReply).toHaveBeenCalledWith(
        '❌ You can only manage denials for characters you own.'
      );
    });

    it('should deny when personality not found', async () => {
      vi.mocked(callGatewayApi).mockResolvedValue({
        ok: false,
        error: 'Not found',
        status: 404,
      });
      const context = createMockContext();

      const result = await checkDenyPermission(context, 'PERSONALITY', null, 'missing-character');

      expect(result.allowed).toBe(false);
      expect(context.editReply).toHaveBeenCalledWith('❌ Character "missing-character" not found.');
    });

    it('should deny when personality option missing', async () => {
      const context = createMockContext();

      const result = await checkDenyPermission(context, 'PERSONALITY', null, null);

      expect(result.allowed).toBe(false);
      expect(context.editReply).toHaveBeenCalledWith(
        '❌ Personality scope requires the `personality` option.'
      );
    });
  });

  describe('invalid scope', () => {
    it('should deny with error', async () => {
      const context = createMockContext();

      const result = await checkDenyPermission(context, 'INVALID', null, null);

      expect(result.allowed).toBe(false);
      expect(context.editReply).toHaveBeenCalledWith('❌ Invalid scope.');
    });
  });
});
