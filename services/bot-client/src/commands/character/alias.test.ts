/**
 * Tests for the alias subcommand-group slash entries (browse entry lives in
 * aliasBrowse.test.ts via the render path; this file owns the Tier-0 add).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

const mockUserClient = {
  listPersonalityAliases: vi.fn(),
  listMyAliases: vi.fn(),
  addPersonalityAlias: vi.fn(),
  removePersonalityAlias: vi.fn(),
};

vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: () => ({ userClient: mockUserClient }),
}));

import { handleAliasAdd } from './alias.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

const CREATED_AT = '2026-07-18T00:00:00.000Z';

function makeContext(options: Record<string, string | null>): DeferredCommandContext {
  return {
    interaction: {
      options: {
        getString: vi.fn((name: string, required?: boolean) => {
          const value = options[name] ?? null;
          if (required === true && value === null) {
            throw new Error(`required option ${name} missing`);
          }
          return value;
        }),
      },
    },
    editReply: vi.fn().mockResolvedValue(undefined),
  } as unknown as DeferredCommandContext;
}

describe('alias slash entries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleAliasAdd (Tier-0 inline)', () => {
    it('defaults to the personal tier and renders the scope badge', async () => {
      mockUserClient.addPersonalityAlias.mockResolvedValue({
        ok: true,
        data: { alias: { alias: 'Mommy', scope: 'user', createdAt: CREATED_AT } },
      });
      const context = makeContext({ character: 'lilith', alias: 'Mommy', scope: null });

      await handleAliasAdd(context);

      expect(mockUserClient.addPersonalityAlias).toHaveBeenCalledWith('lilith', {
        alias: 'Mommy',
        scope: 'user',
      });
      const reply = vi.mocked(context.editReply).mock.calls[0][0] as string;
      expect(reply).toContain('🔒');
      expect(reply).toContain('@Mommy');
    });

    it('passes an explicit global scope through (gateway enforces the owner gate)', async () => {
      mockUserClient.addPersonalityAlias.mockResolvedValue({
        ok: true,
        data: { alias: { alias: 'Lila', scope: 'global', createdAt: CREATED_AT } },
      });
      const context = makeContext({ character: 'lila-elyona', alias: 'Lila', scope: 'global' });

      await handleAliasAdd(context);

      expect(mockUserClient.addPersonalityAlias).toHaveBeenCalledWith('lila-elyona', {
        alias: 'Lila',
        scope: 'global',
      });
      expect(vi.mocked(context.editReply).mock.calls[0][0] as string).toContain('🌐');
    });

    it('surfaces a 403 as the permission-denied message', async () => {
      mockUserClient.addPersonalityAlias.mockResolvedValue({
        ok: false,
        status: 403,
        error: 'Global aliases can only be managed by the bot owner',
      });
      const context = makeContext({ character: 'lilith', alias: 'x', scope: 'global' });

      await handleAliasAdd(context);

      const reply = vi.mocked(context.editReply).mock.calls[0][0] as string;
      expect(reply).toContain('❌');
      expect(reply).toContain('permission');
    });
  });
});
