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
import { ChannelType } from 'discord.js';
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
vi.mock('./browse.js', () => ({
  handleBrowse: (...args: unknown[]) => mockHandleBrowse(...args),
  handleBrowsePagination: vi.fn(),
  handleBrowseSelect: vi.fn(),
  isDenyBrowseInteraction: vi.fn(() => false),
  isDenyBrowseSelectInteraction: vi.fn(() => false),
}));

vi.mock('./detail.js', () => ({
  handleDetailButton: vi.fn(),
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

  interface ScopeGroupJson {
    options: {
      name: string;
      options: {
        name: string;
        options?: { name: string; required?: boolean }[];
      }[];
    }[];
  }

  function subcommandsOf(groupName: string): {
    name: string;
    options?: { name: string; required?: boolean }[];
  }[] {
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
  });
});
