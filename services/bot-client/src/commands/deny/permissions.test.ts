import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkDenyPermission } from './permissions.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { makeOk, makeErr, asUserClient } from '../../test/gatewayClientStubs.js';

// Mock dependencies
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: vi.fn(() => ({
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
    })),
  };
});

vi.mock('@tzurot/common-types/utils/ownerMiddleware', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/ownerMiddleware')>(
    '@tzurot/common-types/utils/ownerMiddleware'
  );
  return {
    ...actual,
    isBotOwner: vi.fn(),
  };
});

vi.mock('../../utils/permissions.js', () => ({
  requireManageMessagesContext: vi.fn(),
}));

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
}));

import { isBotOwner } from '@tzurot/common-types/utils/ownerMiddleware';
import { requireManageMessagesContext } from '../../utils/permissions.js';

interface UserStub {
  getPersonality: ReturnType<typeof vi.fn>;
}

function createStub(): UserStub {
  return { getPersonality: vi.fn() };
}

function createMockContext(
  overrides: Partial<DeferredCommandContext> = {}
): DeferredCommandContext {
  return {
    user: { id: 'user-123' },
    guildId: 'guild-456',
    member: { permissions: { has: vi.fn().mockReturnValue(true) } },
    interaction: {
      user: { id: 'user-123' },
      options: { getChannel: vi.fn().mockReturnValue(null) },
    },
    editReply: vi.fn(),
    ...overrides,
  } as unknown as DeferredCommandContext;
}

describe('checkDenyPermission', () => {
  let stub: UserStub;

  beforeEach(() => {
    vi.resetAllMocks();
    stub = createStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
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
      stub.getPersonality.mockResolvedValue(
        makeOk({ personality: { id: 'pers-uuid-123' }, canEdit: true })
      );
      const context = createMockContext();

      const result = await checkDenyPermission(context, 'PERSONALITY', null, 'my-character');

      expect(result).toEqual({ allowed: true, scopeId: 'pers-uuid-123' });
    });

    it('should allow character creator with canEdit', async () => {
      stub.getPersonality.mockResolvedValue(
        makeOk({ personality: { id: 'pers-uuid-456' }, canEdit: true })
      );
      const context = createMockContext();

      const result = await checkDenyPermission(context, 'PERSONALITY', null, 'their-character');

      expect(result).toEqual({ allowed: true, scopeId: 'pers-uuid-456' });
    });

    it('should deny user without canEdit', async () => {
      stub.getPersonality.mockResolvedValue(
        makeOk({ personality: { id: 'pers-uuid-789' }, canEdit: false })
      );
      const context = createMockContext();

      const result = await checkDenyPermission(context, 'PERSONALITY', null, 'other-character');

      expect(result.allowed).toBe(false);
      expect(context.editReply).toHaveBeenCalledWith(
        '❌ You can only manage denials for characters you own.'
      );
    });

    it('should deny when personality not found', async () => {
      stub.getPersonality.mockResolvedValue(makeErr(404, 'Not found'));
      const context = createMockContext();

      const result = await checkDenyPermission(context, 'PERSONALITY', null, 'missing-character');

      expect(result.allowed).toBe(false);
      expect(context.editReply).toHaveBeenCalledWith('❌ Character "missing-character" not found.');
    });

    it('denies with a "try again" message (not "not found") on an infra failure', async () => {
      // A gateway blip (5xx/network) must not read as "the character doesn't exist".
      stub.getPersonality.mockResolvedValue(makeErr(503, 'Bad gateway'));
      const context = createMockContext();

      const result = await checkDenyPermission(context, 'PERSONALITY', null, 'lilith');

      expect(result.allowed).toBe(false);
      expect(context.editReply).toHaveBeenCalledWith(
        expect.stringContaining('please try again in a moment')
      );
      expect(context.editReply).not.toHaveBeenCalledWith(expect.stringContaining('not found'));
    });

    it('should deny when personality option missing', async () => {
      const context = createMockContext();

      const result = await checkDenyPermission(context, 'PERSONALITY', null, null);

      expect(result.allowed).toBe(false);
      expect(context.editReply).toHaveBeenCalledWith(
        '❌ Personality scope requires the `personality` option.'
      );
    });

    it('rejects the autocomplete-error sentinel before calling the gateway', async () => {
      const context = createMockContext();

      const result = await checkDenyPermission(
        context,
        'PERSONALITY',
        null,
        '__autocomplete_error__'
      );

      expect(result.allowed).toBe(false);
      expect(stub.getPersonality).not.toHaveBeenCalled();
      expect(context.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Autocomplete was unavailable'),
      });
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
