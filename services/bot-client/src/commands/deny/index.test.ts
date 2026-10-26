/**
 * Deny Command Router
 *
 * Covers the group-dispatch seam in `execute()` — group `add`/`remove` must
 * route to their scope-group handlers, and everything else must fall through
 * to the flat subcommand router (`browse`/`view`) — plus structural
 * assertions on the channel option that `buildChannel` shares between the
 * `add` and `remove` groups.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChannelType, type ButtonInteraction, type StringSelectMenuInteraction } from 'discord.js';
import type { SafeCommandContext } from '../../utils/defineCommand.js';

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

// Registration side effect only — importing it for real would pull in
// browse.js's fetchEntries/buildBrowseResponse, which the browse.js mock
// below does not provide.
vi.mock('./browseRebuilder.js', () => ({}));

const mockHandleAdd = vi.fn();
vi.mock('./add.js', () => ({
  handleAdd: (...args: unknown[]) => mockHandleAdd(...args),
}));

const mockHandleRemove = vi.fn();
vi.mock('./remove.js', () => ({
  handleRemove: (...args: unknown[]) => mockHandleRemove(...args),
}));

const mockHandleView = vi.fn();
vi.mock('./view.js', () => ({
  handleView: (...args: unknown[]) => mockHandleView(...args),
}));

const mockHandleBrowse = vi.fn();
const mockHandleBrowsePagination = vi.fn();
const mockHandleBrowseSelect = vi.fn();
vi.mock('./browse.js', () => ({
  handleBrowse: (...args: unknown[]) => mockHandleBrowse(...args),
  handleBrowsePagination: (...args: unknown[]) => mockHandleBrowsePagination(...args),
  handleBrowseSelect: (...args: unknown[]) => mockHandleBrowseSelect(...args),
  isDenyBrowseInteraction: vi.fn((customId: string) => customId.startsWith('deny::browse::')),
  isDenyBrowseSelectInteraction: vi.fn((customId: string) =>
    customId.startsWith('deny::browse-select::')
  ),
}));

const mockHandleDenyBatchButton = vi.fn();
const mockHandleDenyBatchPick = vi.fn();
vi.mock('./browseBatch.js', () => ({
  handleDenyBatchButton: (...args: unknown[]) => mockHandleDenyBatchButton(...args),
  handleDenyBatchPick: (...args: unknown[]) => mockHandleDenyBatchPick(...args),
  isDenyBatchButton: vi.fn((customId: string) =>
    /^deny::batch-(select|confirm|cancel)::\d+::(all|user|guild)::(name|date)$/.test(customId)
  ),
  isDenyBatchSelect: vi.fn((customId: string) =>
    /^deny::batch-select::\d+::(all|user|guild)::(name|date)$/.test(customId)
  ),
}));

const mockHandleDetailButton = vi.fn();
vi.mock('./detail.js', () => ({
  handleDetailButton: (...args: unknown[]) => mockHandleDetailButton(...args),
  handleDetailModal: vi.fn(),
}));

// Imported after the mocks above so the module picks up the mocked deps.
const { default: denyCommand } = await import('./index.js');

function createMockContext(group: string | null, subcommand: string | null): SafeCommandContext {
  return {
    user: { id: 'user-123' },
    getSubcommandGroup: vi.fn(() => group),
    getSubcommand: vi.fn(() => subcommand),
    editReply: vi.fn(),
  } as unknown as SafeCommandContext;
}

describe('deny execute() group dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes group "add" to handleAdd and not handleRemove', async () => {
    const context = createMockContext('add', 'everywhere');

    await denyCommand.execute(context);

    expect(mockHandleAdd).toHaveBeenCalledWith(context);
    expect(mockHandleRemove).not.toHaveBeenCalled();
    expect(mockHandleBrowse).not.toHaveBeenCalled();
  });

  it('routes group "remove" to handleRemove and not handleAdd', async () => {
    const context = createMockContext('remove', 'everywhere');

    await denyCommand.execute(context);

    expect(mockHandleRemove).toHaveBeenCalledWith(context);
    expect(mockHandleAdd).not.toHaveBeenCalled();
    expect(mockHandleBrowse).not.toHaveBeenCalled();
  });

  it('falls through to the flat router for a null group, without calling either group handler', async () => {
    const context = createMockContext(null, 'browse');

    await denyCommand.execute(context);

    expect(mockHandleAdd).not.toHaveBeenCalled();
    expect(mockHandleRemove).not.toHaveBeenCalled();
    expect(mockHandleBrowse).toHaveBeenCalledWith(context);
  });
});

describe('deny add/remove channel command structure', () => {
  function findChannelTypes(groupName: string): number[] | undefined {
    const json = denyCommand.data.toJSON() as {
      options: {
        name: string;
        options: {
          name: string;
          options?: { name: string; channel_types?: number[] }[];
        }[];
      }[];
    };

    const group = json.options.find(opt => opt.name === groupName);
    const channelSub = group?.options.find(opt => opt.name === 'channel');
    const channelOption = channelSub?.options?.find(opt => opt.name === 'channel');
    return channelOption?.channel_types;
  }

  it('includes thread channel types on the add group channel option', () => {
    expect(findChannelTypes('add')).toEqual(
      expect.arrayContaining([
        ChannelType.GuildText,
        ChannelType.GuildVoice,
        ChannelType.GuildForum,
        ChannelType.PublicThread,
        ChannelType.PrivateThread,
        ChannelType.AnnouncementThread,
      ])
    );
  });

  it('includes thread channel types on the remove group channel option', () => {
    expect(findChannelTypes('remove')).toEqual(
      expect.arrayContaining([
        ChannelType.GuildText,
        ChannelType.GuildVoice,
        ChannelType.GuildForum,
        ChannelType.PublicThread,
        ChannelType.PrivateThread,
        ChannelType.AnnouncementThread,
      ])
    );
  });

  /** One shape for both structural tests below, so the cast cannot drift between them. */
  interface ScopeSubcommandJson {
    name: string;
    description: string;
    options?: { name: string; required?: boolean }[];
  }

  interface ScopeGroupJson {
    options: { name: string; options: ScopeSubcommandJson[] }[];
  }

  function subcommandsOf(groupName: string): ScopeSubcommandJson[] {
    const json = denyCommand.data.toJSON() as ScopeGroupJson;
    return json.options.find(opt => opt.name === groupName)?.options ?? [];
  }

  // The invariant TASK-787 bought: every scope subcommand names exactly ONE
  // target, and it is required — so no runtime code has to arbitrate between
  // two optional target options. Asserting the whole shape rather than the
  // `server` subcommand alone also pins `everywhere`'s user: optional→required
  // flip, which is the other half of the same change.
  describe.each(['add', 'remove'])('%s group target options', groupName => {
    it('exposes exactly one required target option per scope subcommand', () => {
      const subcommands = subcommandsOf(groupName);
      expect(subcommands.map(sub => sub.name)).toEqual([
        'everywhere',
        'server',
        'this-server',
        'channel',
        'character',
      ]);

      for (const sub of subcommands) {
        const targets = (sub.options ?? []).filter(
          opt => opt.name === 'user' || opt.name === 'server'
        );
        expect(targets, `${groupName} ${sub.name} target options`).toHaveLength(1);
        expect(targets[0]?.required, `${groupName} ${sub.name} target required`).toBe(true);
      }
    });

    // The subcommand name answers WHERE for four of the five entries, so the
    // description is the only place the picker can say WHAT is denied. Owner
    // verdict on the live picker (doc-87): leaving that implicit reads as
    // confusing. This pins it so a sixth subcommand cannot land silent.
    it('names its target in every scope subcommand description', () => {
      for (const sub of subcommandsOf(groupName)) {
        // Per-subcommand, not one loose alternation over every target word. A
        // single regex accepting any of them passes on "Deny in one
        // server-side channel" — the `server` branch matches while the
        // description still never says who is denied.
        const expected = sub.name === 'server' ? /\bserver\b/ : /\b(a user|user denial)\b/;
        expect(sub.description, `${groupName} ${sub.name} description`).toMatch(expected);
      }
    });
  });
});

describe('deny handleButton() and handleSelectMenu() routing (P5/P6, C2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes browse pagination buttons to handleBrowsePagination', async () => {
    const interaction = {
      customId: 'deny::browse::0::all::date::',
    } as unknown as ButtonInteraction;

    await denyCommand.handleButton?.(interaction);

    expect(mockHandleBrowsePagination).toHaveBeenCalledWith(interaction);
    expect(mockHandleDenyBatchButton).not.toHaveBeenCalled();
    expect(mockHandleDetailButton).not.toHaveBeenCalled();
  });

  it.each([
    'deny::batch-select::0::all::date',
    'deny::batch-confirm::1::user::name',
    'deny::batch-cancel::2::guild::date',
  ])(
    'routes %s to handleDenyBatchButton before the handleDetailButton catch-all',
    async customId => {
      const interaction = { customId } as unknown as ButtonInteraction;

      await denyCommand.handleButton?.(interaction);

      expect(mockHandleDenyBatchButton).toHaveBeenCalledWith(interaction);
      expect(mockHandleBrowsePagination).not.toHaveBeenCalled();
      expect(mockHandleDetailButton).not.toHaveBeenCalled();
    }
  );

  it('routes detail buttons (deny::del::, deny::mode::, etc.) to handleDetailButton', async () => {
    const interaction = {
      customId: 'deny::del::entry-uuid-1234',
    } as unknown as ButtonInteraction;

    await denyCommand.handleButton?.(interaction);

    expect(mockHandleDetailButton).toHaveBeenCalledWith(interaction);
    expect(mockHandleBrowsePagination).not.toHaveBeenCalled();
    expect(mockHandleDenyBatchButton).not.toHaveBeenCalled();
  });

  it('routes one-pick browse-select to handleBrowseSelect and NOT handleDenyBatchPick (C2)', async () => {
    const interaction = {
      customId: 'deny::browse-select::0::all::date::',
    } as unknown as StringSelectMenuInteraction;

    await denyCommand.handleSelectMenu?.(interaction);

    expect(mockHandleBrowseSelect).toHaveBeenCalledWith(interaction);
    expect(mockHandleDenyBatchPick).not.toHaveBeenCalled();
  });

  it('routes batch-select menu submission to handleDenyBatchPick and NOT handleBrowseSelect', async () => {
    const interaction = {
      customId: 'deny::batch-select::0::all::date',
    } as unknown as StringSelectMenuInteraction;

    await denyCommand.handleSelectMenu?.(interaction);

    expect(mockHandleDenyBatchPick).toHaveBeenCalledWith(interaction);
    expect(mockHandleBrowseSelect).not.toHaveBeenCalled();
  });
});
