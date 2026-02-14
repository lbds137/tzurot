import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleBrowse,
  handleBrowsePagination,
  handleBrowseSelect,
  isDenyBrowseInteraction,
  isDenyBrowseSelectInteraction,
  buildBrowseResponse,
} from './browse.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';

// Mock dependencies
vi.mock('@tzurot/common-types', () => ({
  isBotOwner: vi.fn(),
  GATEWAY_TIMEOUTS: { DEFERRED: 10000 },
  getConfig: vi.fn(() => ({ BOT_OWNER_ID: 'owner-1' })),
  DISCORD_COLORS: { ERROR: 0xff0000 },
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

// Mock browse utilities — return simple objects instead of Discord.js builders
vi.mock('../../utils/browse/index.js', () => ({
  createBrowseCustomIdHelpers: vi.fn(() => ({
    build: vi.fn(
      (page: number, filter: string, sort: string, _query: string | null) =>
        `deny::browse::${String(page)}::${filter}::${sort}::`
    ),
    buildSelect: vi.fn(
      (page: number, filter: string, sort: string, _query: string | null) =>
        `deny::browse-select::${String(page)}::${filter}::${sort}::`
    ),
    buildInfo: vi.fn(() => 'deny::browse::info'),
    parse: vi.fn((customId: string) => {
      if (!customId.startsWith('deny::browse::')) return null;
      const parts = customId.split('::');
      if (parts.length < 5) return null;
      const page = parseInt(parts[2], 10);
      if (isNaN(page)) return null;
      return { page, filter: parts[3], sort: parts[4], query: null };
    }),
    parseSelect: vi.fn((customId: string) => {
      if (!customId.startsWith('deny::browse-select::')) return null;
      const parts = customId.split('::');
      if (parts.length < 5) return null;
      const page = parseInt(parts[2], 10);
      if (isNaN(page)) return null;
      return { page, filter: parts[3], sort: parts[4], query: null };
    }),
    isBrowse: vi.fn((customId: string) => customId.startsWith('deny::browse::')),
    isBrowseSelect: vi.fn((customId: string) => customId.startsWith('deny::browse-select::')),
    browsePrefix: 'deny::browse',
    browseSelectPrefix: 'deny::browse-select',
  })),
  buildBrowseButtons: vi.fn(() => ({ type: 'action-row', components: [] })),
  calculatePaginationState: vi.fn(
    (totalItems: number, itemsPerPage: number, requestedPage: number) => {
      const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
      const safePage = Math.min(Math.max(0, requestedPage), totalPages - 1);
      return {
        page: safePage,
        safePage,
        totalPages,
        totalItems,
        itemsPerPage,
        startIndex: safePage * itemsPerPage,
        endIndex: Math.min(safePage * itemsPerPage + itemsPerPage, totalItems),
      };
    }
  ),
  ITEMS_PER_PAGE: 10,
  truncateForSelect: vi.fn((text: string) => text),
}));

// Mock detail.js for handleBrowseSelect
vi.mock('./detail.js', () => ({
  showDetailView: vi.fn(),
}));

import { isBotOwner } from '@tzurot/common-types';
import { adminFetch } from '../../utils/adminApiClient.js';
import { requireBotOwnerContext } from '../../utils/commandContext/index.js';
import { showDetailView } from './detail.js';

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

function createMockButtonInteraction(customId: string): ButtonInteraction {
  return {
    customId,
    user: { id: 'user-123' },
    deferUpdate: vi.fn(),
    editReply: vi.fn(),
  } as unknown as ButtonInteraction;
}

function createMockSelectInteraction(
  customId: string,
  values: string[]
): StringSelectMenuInteraction {
  return {
    customId,
    user: { id: 'user-123' },
    values,
    channelId: 'chan-1',
    guildId: 'guild-456',
    message: { id: 'msg-1' },
    deferUpdate: vi.fn(),
    editReply: vi.fn(),
  } as unknown as StringSelectMenuInteraction;
}

const sampleEntries = [
  {
    id: 'entry-1',
    type: 'USER',
    discordId: '111222333444555666',
    scope: 'BOT',
    scopeId: '*',
    mode: 'BLOCK',
    reason: 'Spamming',
    addedAt: '2026-01-15T00:00:00.000Z',
    addedBy: 'owner-1',
  },
  {
    id: 'entry-2',
    type: 'GUILD',
    discordId: '999888777666555444',
    scope: 'BOT',
    scopeId: '*',
    mode: 'BLOCK',
    reason: null,
    addedAt: '2026-01-10T00:00:00.000Z',
    addedBy: 'owner-1',
  },
  {
    id: 'entry-3',
    type: 'USER',
    discordId: '555666777888999000',
    scope: 'CHANNEL',
    scopeId: '123456789',
    mode: 'MUTE',
    reason: 'Abusive behavior',
    addedAt: '2026-01-05T00:00:00.000Z',
    addedBy: 'owner-1',
  },
];

describe('isDenyBrowseInteraction', () => {
  it('should return true for browse custom IDs', () => {
    expect(isDenyBrowseInteraction('deny::browse::0::all::date::')).toBe(true);
  });

  it('should return false for non-browse custom IDs', () => {
    expect(isDenyBrowseInteraction('deny::something::else')).toBe(false);
  });

  it('should return false for other commands', () => {
    expect(isDenyBrowseInteraction('channel::browse::0::current::date::')).toBe(false);
  });
});

describe('isDenyBrowseSelectInteraction', () => {
  it('should return true for browse-select custom IDs', () => {
    expect(isDenyBrowseSelectInteraction('deny::browse-select::0::all::date::')).toBe(true);
  });

  it('should return false for browse button custom IDs', () => {
    expect(isDenyBrowseSelectInteraction('deny::browse::0::all::date::')).toBe(false);
  });

  it('should return false for other commands', () => {
    expect(isDenyBrowseSelectInteraction('channel::browse-select::0::current::date::')).toBe(false);
  });
});

describe('handleBrowse', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireBotOwnerContext).mockResolvedValue(true);
  });

  it('should display entries in an embed with components', async () => {
    vi.mocked(adminFetch).mockResolvedValue(mockOkResponse({ entries: sampleEntries }));
    const context = createMockContext();

    await handleBrowse(context);

    expect(adminFetch).toHaveBeenCalledWith('/admin/denylist', { userId: 'user-123' });
    expect(context.editReply).toHaveBeenCalledWith({
      embeds: expect.any(Array),
      components: expect.any(Array),
    });
  });

  it('should show empty message when no entries', async () => {
    vi.mocked(adminFetch).mockResolvedValue(mockOkResponse({ entries: [] }));
    const context = createMockContext();

    await handleBrowse(context);

    const call = vi.mocked(context.editReply).mock.calls[0][0];
    expect(call).toEqual({
      embeds: expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({
            description: expect.stringContaining('No denylist entries found'),
          }),
        }),
      ]),
      components: expect.any(Array),
    });
  });

  it('should deny non-owner access', async () => {
    vi.mocked(requireBotOwnerContext).mockResolvedValue(false);
    const context = createMockContext();

    await handleBrowse(context);

    expect(adminFetch).not.toHaveBeenCalled();
  });

  it('should filter by user type', async () => {
    vi.mocked(adminFetch).mockResolvedValue(mockOkResponse({ entries: sampleEntries }));
    const context = createMockContext({ filter: 'user' });

    await handleBrowse(context);

    const call = vi.mocked(context.editReply).mock.calls[0][0] as {
      embeds: { data: { footer: { text: string } } }[];
    };
    expect(call.embeds[0].data.footer.text).toContain('users only');
  });

  it('should filter by guild type', async () => {
    vi.mocked(adminFetch).mockResolvedValue(mockOkResponse({ entries: sampleEntries }));
    const context = createMockContext({ filter: 'guild' });

    await handleBrowse(context);

    const call = vi.mocked(context.editReply).mock.calls[0][0] as {
      embeds: { data: { footer: { text: string } } }[];
    };
    expect(call.embeds[0].data.footer.text).toContain('guilds only');
  });

  it('should default to all filter', async () => {
    vi.mocked(adminFetch).mockResolvedValue(mockOkResponse({ entries: sampleEntries }));
    const context = createMockContext();

    await handleBrowse(context);

    const call = vi.mocked(context.editReply).mock.calls[0][0] as {
      embeds: { data: { footer: { text: string } } }[];
    };
    expect(call.embeds[0].data.footer.text).toContain('all types');
  });

  it('should handle API error', async () => {
    vi.mocked(adminFetch).mockResolvedValue(mockErrorResponse(500, { message: 'Error' }));
    const context = createMockContext();

    await handleBrowse(context);

    expect(context.editReply).toHaveBeenCalledWith('❌ Failed to fetch denylist entries.');
  });

  it('should handle fetch exception', async () => {
    vi.mocked(adminFetch).mockRejectedValue(new Error('Network error'));
    const context = createMockContext();

    await handleBrowse(context);

    expect(context.editReply).toHaveBeenCalledWith('❌ Failed to fetch denylist entries.');
  });

  it('should include entry details in embed description', async () => {
    vi.mocked(adminFetch).mockResolvedValue(
      mockOkResponse({
        entries: [sampleEntries[0]],
      })
    );
    const context = createMockContext();

    await handleBrowse(context);

    const call = vi.mocked(context.editReply).mock.calls[0][0] as {
      embeds: { data: { description: string } }[];
    };
    expect(call.embeds[0].data.description).toContain('<@111222333444555666>');
    expect(call.embeds[0].data.description).toContain('(`111222333444555666`)');
    expect(call.embeds[0].data.description).toContain('Bot-wide');
    expect(call.embeds[0].data.description).toContain('Spamming');
  });

  it('should show MUTE badge for MUTE-mode entries', async () => {
    vi.mocked(adminFetch).mockResolvedValue(
      mockOkResponse({
        entries: [sampleEntries[2]],
      })
    );
    const context = createMockContext();

    await handleBrowse(context);

    const call = vi.mocked(context.editReply).mock.calls[0][0] as {
      embeds: { data: { description: string } }[];
    };
    expect(call.embeds[0].data.description).toContain('**MUTE**');
  });

  it('should not show mode badge for BLOCK-mode entries', async () => {
    vi.mocked(adminFetch).mockResolvedValue(
      mockOkResponse({
        entries: [sampleEntries[0]],
      })
    );
    const context = createMockContext();

    await handleBrowse(context);

    const call = vi.mocked(context.editReply).mock.calls[0][0] as {
      embeds: { data: { description: string } }[];
    };
    expect(call.embeds[0].data.description).not.toContain('**MUTE**');
    expect(call.embeds[0].data.description).not.toContain('**BLOCK**');
  });

  it('should show scope details for non-BOT scopes', async () => {
    vi.mocked(adminFetch).mockResolvedValue(
      mockOkResponse({
        entries: [sampleEntries[2]],
      })
    );
    const context = createMockContext();

    await handleBrowse(context);

    const call = vi.mocked(context.editReply).mock.calls[0][0] as {
      embeds: { data: { description: string } }[];
    };
    expect(call.embeds[0].data.description).toContain('CHANNEL:123456789');
  });

  it('should include select menu in components when entries exist', async () => {
    vi.mocked(adminFetch).mockResolvedValue(mockOkResponse({ entries: sampleEntries }));
    const context = createMockContext();

    await handleBrowse(context);

    const call = vi.mocked(context.editReply).mock.calls[0][0] as {
      components: unknown[];
    };
    // Should have browse buttons + select menu = 2 rows
    expect(call.components.length).toBe(2);
  });

  it('should not include select menu when no entries', async () => {
    vi.mocked(adminFetch).mockResolvedValue(mockOkResponse({ entries: [] }));
    const context = createMockContext();

    await handleBrowse(context);

    const call = vi.mocked(context.editReply).mock.calls[0][0] as {
      components: unknown[];
    };
    // No browse buttons and no select menu
    expect(call.components.length).toBe(0);
  });
});

describe('handleBrowsePagination', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(isBotOwner).mockReturnValue(true);
  });

  it('should defer update and rebuild page', async () => {
    vi.mocked(adminFetch).mockResolvedValue(mockOkResponse({ entries: sampleEntries }));
    const interaction = createMockButtonInteraction('deny::browse::1::all::date::');

    await handleBrowsePagination(interaction);

    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      embeds: expect.any(Array),
      components: expect.any(Array),
    });
  });

  it('should silently deny non-owners', async () => {
    vi.mocked(isBotOwner).mockReturnValue(false);
    const interaction = createMockButtonInteraction('deny::browse::1::all::date::');

    await handleBrowsePagination(interaction);

    expect(interaction.deferUpdate).not.toHaveBeenCalled();
    expect(adminFetch).not.toHaveBeenCalled();
  });

  it('should return early for invalid custom ID', async () => {
    const interaction = createMockButtonInteraction('invalid::custom::id');

    await handleBrowsePagination(interaction);

    expect(interaction.deferUpdate).not.toHaveBeenCalled();
    expect(adminFetch).not.toHaveBeenCalled();
  });

  it('should apply sort from custom ID', async () => {
    vi.mocked(adminFetch).mockResolvedValue(mockOkResponse({ entries: sampleEntries }));
    const interaction = createMockButtonInteraction('deny::browse::0::all::name::');

    await handleBrowsePagination(interaction);

    const call = vi.mocked(interaction.editReply).mock.calls[0][0] as {
      embeds: { data: { footer: { text: string } } }[];
    };
    expect(call.embeds[0].data.footer.text).toContain('by target ID');
  });

  it('should apply filter from custom ID', async () => {
    vi.mocked(adminFetch).mockResolvedValue(mockOkResponse({ entries: sampleEntries }));
    const interaction = createMockButtonInteraction('deny::browse::0::user::date::');

    await handleBrowsePagination(interaction);

    const call = vi.mocked(interaction.editReply).mock.calls[0][0] as {
      embeds: { data: { footer: { text: string } } }[];
    };
    expect(call.embeds[0].data.footer.text).toContain('users only');
  });

  it('should silently handle API error', async () => {
    vi.mocked(adminFetch).mockResolvedValue(mockErrorResponse(500, { message: 'Error' }));
    const interaction = createMockButtonInteraction('deny::browse::1::all::date::');

    await handleBrowsePagination(interaction);

    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
  });
});

describe('handleBrowseSelect', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(isBotOwner).mockReturnValue(true);
  });

  it('should find selected entry and show detail view', async () => {
    vi.mocked(adminFetch).mockResolvedValue(mockOkResponse({ entries: sampleEntries }));
    const interaction = createMockSelectInteraction('deny::browse-select::0::all::date::', [
      'entry-1',
    ]);

    await handleBrowseSelect(interaction);

    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(showDetailView).toHaveBeenCalledWith(interaction, sampleEntries[0], {
      page: 0,
      filter: 'all',
      sort: 'date',
    });
  });

  it('should silently deny non-owners', async () => {
    vi.mocked(isBotOwner).mockReturnValue(false);
    const interaction = createMockSelectInteraction('deny::browse-select::0::all::date::', [
      'entry-1',
    ]);

    await handleBrowseSelect(interaction);

    expect(interaction.deferUpdate).not.toHaveBeenCalled();
    expect(adminFetch).not.toHaveBeenCalled();
  });

  it('should handle entry not found', async () => {
    vi.mocked(adminFetch).mockResolvedValue(mockOkResponse({ entries: sampleEntries }));
    const interaction = createMockSelectInteraction('deny::browse-select::0::all::date::', [
      'nonexistent-id',
    ]);

    await handleBrowseSelect(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Entry not found'),
      })
    );
  });

  it('should return early for invalid custom ID', async () => {
    const interaction = createMockSelectInteraction('invalid::custom::id', ['entry-1']);

    await handleBrowseSelect(interaction);

    expect(interaction.deferUpdate).not.toHaveBeenCalled();
  });

  it('should handle API error gracefully', async () => {
    vi.mocked(adminFetch).mockResolvedValue(mockErrorResponse(500, { message: 'Error' }));
    const interaction = createMockSelectInteraction('deny::browse-select::0::all::date::', [
      'entry-1',
    ]);

    await handleBrowseSelect(interaction);

    expect(interaction.deferUpdate).toHaveBeenCalled();
    // Should silently return when fetch fails
    expect(showDetailView).not.toHaveBeenCalled();
  });
});

describe('buildBrowseResponse', () => {
  it('should build a filtered and sorted browse response', () => {
    const result = buildBrowseResponse(sampleEntries, 0, 'user', 'date');

    expect(result.embed).toBeDefined();
    expect(result.components).toBeDefined();
    // Should only show USER entries (2 of 3)
    expect(result.embed.data.footer?.text).toContain('users only');
  });

  it('should handle all filter', () => {
    const result = buildBrowseResponse(sampleEntries, 0, 'all', 'name');

    expect(result.embed.data.footer?.text).toContain('all types');
    expect(result.embed.data.footer?.text).toContain('by target ID');
  });
});
