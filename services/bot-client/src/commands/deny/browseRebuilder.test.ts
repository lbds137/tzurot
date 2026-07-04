import { describe, it, expect, vi } from 'vitest';
import { makeOk, makeErr, asOwnerClient } from '../../test/gatewayClientStubs.js';

vi.mock('@tzurot/common-types/constants/discord', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/constants/discord')>(
    '@tzurot/common-types/constants/discord'
  );
  return {
    ...actual,
    DISCORD_COLORS: { ERROR: 0xff0000 },
  };
});

vi.mock('@tzurot/common-types/utils/dateFormatting', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/dateFormatting')>(
    '@tzurot/common-types/utils/dateFormatting'
  );
  return {
    ...actual,
    formatDateShort: vi.fn((date: string | Date) => {
      const d = typeof date === 'string' ? new Date(date) : date;
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
    }),
  };
});

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

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
}));

vi.mock('../../utils/commandContext/index.js', () => ({
  requireBotOwnerContext: vi.fn(),
}));

// Mock the browse utility module so the rebuilder's buildBrowseResponse call
// doesn't try to construct real Discord.js builders.
vi.mock('../../utils/browse/index.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../utils/browse/index.js')>();
  return {
    ...actual,
    createBrowseCustomIdHelpers: vi.fn(() => ({
      build: vi.fn(() => 'deny::browse::0::all::date::'),
      buildSelect: vi.fn(() => 'deny::browse-select::0::all::date::'),
      buildInfo: vi.fn(() => 'deny::browse::info'),
      parse: vi.fn(() => null),
      parseSelect: vi.fn(() => null),
      isBrowse: vi.fn(() => false),
      isBrowseSelect: vi.fn(() => false),
      browsePrefix: 'deny::browse',
      browseSelectPrefix: 'deny::browse-select',
    })),
    buildBrowseButtons: vi.fn(() => ({ type: 'action-row', components: [] })),
    createBrowseSortToggle: vi.fn(() => ({
      next: (current: string) => (current === 'date' ? 'name' : 'date'),
      labelFor: () => ({ label: 'Sort', emoji: '🔤' }),
    })),
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
    buildBrowseSelectMenu: vi.fn(() => ({ type: 'select-menu-row' })),
  };
});

// Mock the dashboard index so registration is observable and doesn't pollute
// the real browse-rebuilder registry across test files.
vi.mock('../../utils/dashboard/index.js', () => ({
  registerBrowseRebuilder: vi.fn(),
}));

// Importing `./browseRebuilder.js` fires the registerBrowseRebuilder call at
// module-load time. Pulling it through a side-effect import keeps the test's
// subject-under-test explicit.
import './browseRebuilder.js';
import { registerBrowseRebuilder } from '../../utils/dashboard/index.js';

const sampleEntries = [
  {
    id: 'entry-1',
    type: 'USER' as const,
    discordId: '111222333444555666',
    scope: 'BOT' as const,
    scopeId: '*',
    mode: 'BLOCK' as const,
    reason: 'Spamming',
    addedAt: new Date('2026-01-15T00:00:00.000Z'),
    addedBy: 'owner-1',
  },
];

// Capture the rebuilder callback registered at module-load BEFORE any
// `vi.clearAllMocks()` wipes the call history.
const denyRebuilderCall = vi.mocked(registerBrowseRebuilder).mock.calls.find(c => c[0] === 'deny');
if (denyRebuilderCall === undefined) {
  throw new Error('deny rebuilder was not registered at module load');
}
const denyRebuilder = denyRebuilderCall[1];

describe('deny browse rebuilder', () => {
  function createMockInteraction() {
    return { user: { id: 'user-123' } } as unknown as Parameters<typeof denyRebuilder>[0];
  }

  it('returns rebuilt view with banner on success', async () => {
    clientsForMock.mockReturnValue({
      ownerClient: asOwnerClient({
        listDenylistEntries: vi.fn().mockResolvedValue(makeOk({ entries: sampleEntries })),
      }),
    });

    const result = await denyRebuilder(
      createMockInteraction(),
      { source: 'browse', page: 0, filter: 'all', sort: 'date' },
      '✅ Banner'
    );

    expect(result).not.toBeNull();
    expect(result).toEqual({
      content: '✅ Banner',
      embeds: expect.any(Array),
      components: expect.any(Array),
    });
  });

  it('returns null when fetchEntries returns null (owner API fails)', async () => {
    clientsForMock.mockReturnValue({
      ownerClient: asOwnerClient({
        listDenylistEntries: vi.fn().mockResolvedValue(makeErr(500, 'Error')),
      }),
    });

    const result = await denyRebuilder(
      createMockInteraction(),
      { source: 'browse', page: 0, filter: 'all', sort: 'date' },
      '✅ Banner'
    );

    expect(result).toBeNull();
  });
});
