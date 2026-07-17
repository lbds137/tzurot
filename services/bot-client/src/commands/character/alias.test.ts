/**
 * Tests for /character alias (list | add | remove).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

const mockUserClient = {
  listPersonalityAliases: vi.fn(),
  addPersonalityAlias: vi.fn(),
  removePersonalityAlias: vi.fn(),
};
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: () => ({ userClient: mockUserClient }),
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

import { handleAlias } from './alias.js';

function makeContext(options: { action: string; character: string; alias?: string | null }): {
  context: DeferredCommandContext;
  editReply: ReturnType<typeof vi.fn>;
} {
  const editReply = vi.fn().mockResolvedValue(undefined);
  const context = {
    interaction: {
      options: {
        getString: (name: string, _required?: boolean) => {
          if (name === 'action') {
            return options.action;
          }
          if (name === 'character') {
            return options.character;
          }
          return options.alias ?? null;
        },
      },
    },
    editReply,
  } as unknown as DeferredCommandContext;
  return { context, editReply };
}

describe('handleAlias', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists aliases with the mention-resolution note', async () => {
    mockUserClient.listPersonalityAliases.mockResolvedValue({
      ok: true,
      data: { aliases: [{ alias: 'lila', createdAt: '2026-07-17T00:00:00.000Z' }] },
    });
    const { context, editReply } = makeContext({ action: 'list', character: 'lila-elyona' });

    await handleAlias(context);

    expect(mockUserClient.listPersonalityAliases).toHaveBeenCalledWith('lila-elyona');
    expect(String(editReply.mock.calls[0][0])).toContain('@lila');
  });

  it('renders the empty state with the add hint', async () => {
    mockUserClient.listPersonalityAliases.mockResolvedValue({
      ok: true,
      data: { aliases: [] },
    });
    const { context, editReply } = makeContext({ action: 'list', character: 'lila-elyona' });

    await handleAlias(context);

    expect(String(editReply.mock.calls[0][0])).toContain('no aliases');
  });

  it('requires the alias option for add — no client call without it', async () => {
    const { context, editReply } = makeContext({ action: 'add', character: 'x', alias: null });

    await handleAlias(context);

    expect(mockUserClient.addPersonalityAlias).not.toHaveBeenCalled();
    expect(String(editReply.mock.calls[0][0])).toContain('required');
  });

  it('adds with a trimmed alias (seam: exact payload)', async () => {
    mockUserClient.addPersonalityAlias.mockResolvedValue({
      ok: true,
      data: { alias: { alias: 'Li', createdAt: '2026-07-17T00:00:00.000Z' } },
    });
    const { context, editReply } = makeContext({
      action: 'add',
      character: 'lila-elyona',
      alias: '  Li  ',
    });

    await handleAlias(context);

    expect(mockUserClient.addPersonalityAlias).toHaveBeenCalledWith('lila-elyona', {
      alias: 'Li',
    });
    expect(String(editReply.mock.calls[0][0])).toContain('Added alias');
  });

  it('surfaces the gateway conflict message on 409', async () => {
    mockUserClient.addPersonalityAlias.mockResolvedValue({
      ok: false,
      status: 409,
      error: 'The alias "li" is already in use',
    });
    const { context, editReply } = makeContext({
      action: 'add',
      character: 'lila-elyona',
      alias: 'li',
    });

    await handleAlias(context);

    expect(String(editReply.mock.calls[0][0])).toContain('already in use');
  });

  it('removes and reports the removed alias', async () => {
    mockUserClient.removePersonalityAlias.mockResolvedValue({
      ok: true,
      data: { removedAlias: 'lila' },
    });
    const { context, editReply } = makeContext({
      action: 'remove',
      character: 'lila-elyona',
      alias: 'LILA',
    });

    await handleAlias(context);

    expect(mockUserClient.removePersonalityAlias).toHaveBeenCalledWith('lila-elyona', 'LILA');
    expect(String(editReply.mock.calls[0][0])).toContain('Removed alias');
  });

  it('degrades to a generic failure when the client throws', async () => {
    mockUserClient.listPersonalityAliases.mockRejectedValue(new Error('network'));
    const { context, editReply } = makeContext({ action: 'list', character: 'x' });

    await expect(handleAlias(context)).resolves.toBeUndefined();
    expect(String(editReply.mock.calls[0][0])).toContain('managing aliases');
  });
});
