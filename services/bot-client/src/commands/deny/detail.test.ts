import { describe, it, expect, vi, beforeEach } from 'vitest';
import { showDetailView, handleDetailButton, handleDetailModal } from './detail.js';
import type { ButtonInteraction, ModalSubmitInteraction } from 'discord.js';
import { makeOk, makeErr, asOwnerClient } from '../../test/gatewayClientStubs.js';

// Mock dependencies
vi.mock('@tzurot/common-types/constants/discord', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/constants/discord')>(
    '@tzurot/common-types/constants/discord'
  );
  return {
    ...actual,
    DISCORD_COLORS: { ERROR: 0xff0000, WARNING: 0xffaa00 },
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

const mockSessionManager = {
  set: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../../utils/dashboard/SessionManager.js', () => ({
  getSessionManager: vi.fn(() => mockSessionManager),
}));

vi.mock('../../utils/confirmation/confirmAction.js', () => ({
  buildDeleteConfirmation: vi.fn(() => ({
    embed: { data: { title: 'Delete?' } },
    components: [{ type: 'action-row' }],
  })),
}));

vi.mock('../../utils/dashboard/messages.js', () => ({
  DASHBOARD_MESSAGES: {
    SESSION_EXPIRED: '⏰ Session expired.',
    OPERATION_FAILED: (action: string) => `❌ Failed to ${action}.`,
  },
  formatSessionExpiredMessage: (cmd: string) => `⏰ Session expired — use ${cmd}.`,
  formatSuccessBanner: (verb: string, name: string) => `✅ **${verb}** · ${name}`,
}));

// Stub the post-action helpers at their source so the deny tests can assert
// on handler-level dispatch without exercising their internals (which have
// their own test coverage).
const mockRenderPostActionScreen = vi.fn();
vi.mock('../../utils/dashboard/postActionScreen.js', () => ({
  renderPostActionScreen: (...args: unknown[]) => mockRenderPostActionScreen(...args),
}));
const mockHandleSharedBackButton = vi.fn();
vi.mock('../../utils/dashboard/sharedBackButtonHandler.js', () => ({
  handleSharedBackButton: (...args: unknown[]) => mockHandleSharedBackButton(...args),
}));

vi.mock('../../utils/dashboard/types.js', () => ({
  parseDashboardCustomId: vi.fn((customId: string) => {
    const parts = customId.split('::');
    if (parts.length < 2) return null;
    return {
      entityType: parts[0],
      action: parts[1],
      entityId: parts[2],
      sectionId: parts[3],
    };
  }),
}));

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
}));

vi.mock('./browse.js', () => ({
  fetchEntries: vi.fn(),
  buildBrowseResponse: vi.fn(() => ({
    embed: { data: { title: 'Browse' } },
    components: [],
  })),
}));

// Mock detailTypes so we don't construct Discord.js builders
vi.mock('./detailTypes.js', () => ({
  ENTITY_TYPE: 'deny',
  buildDetailEmbed: vi.fn(() => ({ data: { title: 'Detail' } })),
  buildDetailButtons: vi.fn(() => [{ type: 'action-row' }]),
}));

vi.mock('./detailEdit.js', () => ({
  handleEdit: vi.fn(),
  handleEditModal: vi.fn(),
}));

import { isBotOwner } from '@tzurot/common-types/utils/ownerMiddleware';
import { buildDeleteConfirmation } from '../../utils/confirmation/confirmAction.js';
import { handleEdit, handleEditModal } from './detailEdit.js';

interface OwnerStub {
  addDenylistEntry: ReturnType<typeof vi.fn>;
  removeDenylistEntry: ReturnType<typeof vi.fn>;
}

function createStub(): OwnerStub {
  return {
    addDenylistEntry: vi.fn(),
    removeDenylistEntry: vi.fn(),
  };
}

const sampleEntry = {
  id: 'entry-uuid-1234',
  type: 'USER' as const,
  discordId: '111222333444555666',
  scope: 'BOT' as const,
  scopeId: '*',
  mode: 'BLOCK' as const,
  reason: 'Spamming',
  addedAt: new Date('2026-01-15T00:00:00.000Z'),
  addedBy: 'owner-1',
};

const sampleSession = {
  data: {
    ...sampleEntry,
    addedAt: '2026-01-15T00:00:00.000Z', // serialized to ISO string by session storage
    browseContext: { source: 'browse' as const, page: 0, filter: 'all', sort: 'date' },
    guildId: 'guild-456',
  },
  userId: 'user-123',
  entityType: 'deny',
  entityId: 'entry-uuid-1234',
  messageId: 'msg-1',
  channelId: 'chan-1',
  createdAt: new Date(),
  lastActivityAt: new Date(),
};

function createMockButtonInteraction(customId: string): ButtonInteraction {
  return {
    customId,
    user: { id: 'user-123' },
    channelId: 'chan-1',
    guildId: 'guild-456',
    message: { id: 'msg-1' },
    deferUpdate: vi.fn(),
    editReply: vi.fn(),
    followUp: vi.fn(),
    showModal: vi.fn(),
  } as unknown as ButtonInteraction;
}

describe('showDetailView', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockSessionManager.set.mockResolvedValue(sampleSession);
  });

  it('should create session and show detail embed', async () => {
    const interaction = createMockButtonInteraction('deny::browse-select::0::all::date::');

    await showDetailView(interaction, sampleEntry, {
      source: 'browse',
      page: 0,
      filter: 'all',
      sort: 'date',
    });

    expect(mockSessionManager.set).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-123',
        entityType: 'deny',
        entityId: 'entry-uuid-1234',
        data: expect.objectContaining({
          id: 'entry-uuid-1234',
          type: 'USER',
          mode: 'BLOCK',
        }),
      })
    );
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: '',
      embeds: expect.any(Array),
      components: expect.any(Array),
    });
  });
});

describe('handleDetailButton', () => {
  let stub: OwnerStub;

  beforeEach(() => {
    vi.resetAllMocks();
    stub = createStub();
    clientsForMock.mockReturnValue({ ownerClient: asOwnerClient(stub) });
    vi.mocked(isBotOwner).mockReturnValue(true);
  });

  it('should silently deny non-owners', async () => {
    vi.mocked(isBotOwner).mockReturnValue(false);
    const interaction = createMockButtonInteraction('deny::mode::entry-uuid-1234');

    await handleDetailButton(interaction);

    expect(interaction.deferUpdate).not.toHaveBeenCalled();
    expect(mockSessionManager.get).not.toHaveBeenCalled();
  });

  describe('mode toggle', () => {
    it('should flip BLOCK to MUTE', async () => {
      mockSessionManager.get.mockResolvedValue(sampleSession);
      mockSessionManager.update.mockResolvedValue(sampleSession);
      stub.addDenylistEntry.mockResolvedValue(makeOk({ success: true }));
      const interaction = createMockButtonInteraction('deny::mode::entry-uuid-1234');

      await handleDetailButton(interaction);

      expect(interaction.deferUpdate).toHaveBeenCalled();
      expect(stub.addDenylistEntry).toHaveBeenCalledWith(expect.objectContaining({ mode: 'MUTE' }));
      expect(mockSessionManager.update).toHaveBeenCalledWith(
        'user-123',
        'deny',
        'entry-uuid-1234',
        { mode: 'MUTE' }
      );
    });

    it('should flip MUTE to BLOCK', async () => {
      const muteSession = {
        ...sampleSession,
        data: { ...sampleSession.data, mode: 'MUTE' as const },
      };
      mockSessionManager.get.mockResolvedValue(muteSession);
      mockSessionManager.update.mockResolvedValue(muteSession);
      stub.addDenylistEntry.mockResolvedValue(makeOk({ success: true }));
      const interaction = createMockButtonInteraction('deny::mode::entry-uuid-1234');

      await handleDetailButton(interaction);

      expect(stub.addDenylistEntry).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'BLOCK' })
      );
    });

    it('should handle session expiry', async () => {
      mockSessionManager.get.mockResolvedValue(null);
      const interaction = createMockButtonInteraction('deny::mode::entry-uuid-1234');

      await handleDetailButton(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Session expired') })
      );
    });

    it('should handle API error', async () => {
      mockSessionManager.get.mockResolvedValue(sampleSession);
      stub.addDenylistEntry.mockResolvedValue(makeErr(500, 'Error'));
      const interaction = createMockButtonInteraction('deny::mode::entry-uuid-1234');

      await handleDetailButton(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Failed to toggle mode') })
      );
    });
  });

  describe('edit button', () => {
    it('should delegate to handleEdit without deferUpdate', async () => {
      const interaction = createMockButtonInteraction('deny::edit::entry-uuid-1234');

      await handleDetailButton(interaction);

      expect(interaction.deferUpdate).not.toHaveBeenCalled();
      expect(handleEdit).toHaveBeenCalledWith(interaction, 'entry-uuid-1234');
    });
  });

  describe('delete flow', () => {
    it('should show delete confirmation', async () => {
      mockSessionManager.get.mockResolvedValue(sampleSession);
      const interaction = createMockButtonInteraction('deny::del::entry-uuid-1234');

      await handleDetailButton(interaction);

      expect(buildDeleteConfirmation).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'Denylist Entry',
          confirmCustomId: 'deny::confirm-del::entry-uuid-1234',
          cancelCustomId: 'deny::cancel-del::entry-uuid-1234',
        })
      );
    });

    it('should route delete success through renderPostActionScreen', async () => {
      mockSessionManager.get.mockResolvedValue(sampleSession);
      stub.removeDenylistEntry.mockResolvedValue(makeOk({ success: true }));
      const interaction = createMockButtonInteraction('deny::confirm-del::entry-uuid-1234');

      await handleDetailButton(interaction);

      expect(stub.removeDenylistEntry).toHaveBeenCalledWith(
        'USER',
        '111222333444555666',
        'BOT',
        '*'
      );
      // Delete + browse rebuild + session cleanup are owned by the shared
      // renderPostActionScreen helper + the browse rebuilder registered in
      // browse.ts. Assert the handler routes correctly with the right shape.
      expect(mockRenderPostActionScreen).toHaveBeenCalledWith(
        expect.objectContaining({
          session: expect.objectContaining({
            entityType: 'deny',
            entityId: 'entry-uuid-1234',
            browseContext: expect.objectContaining({
              source: 'browse',
              page: 0,
              filter: 'all',
              sort: 'date',
            }),
          }),
          outcome: expect.objectContaining({
            kind: 'success',
            banner: expect.stringContaining('USER'),
          }),
        })
      );
    });

    it('should return to detail view on cancel', async () => {
      mockSessionManager.get.mockResolvedValue(sampleSession);
      const interaction = createMockButtonInteraction('deny::cancel-del::entry-uuid-1234');

      await handleDetailButton(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        embeds: expect.any(Array),
        components: expect.any(Array),
      });
    });

    it('should route delete API errors through renderPostActionScreen as an error outcome', async () => {
      mockSessionManager.get.mockResolvedValue(sampleSession);
      stub.removeDenylistEntry.mockResolvedValue(makeErr(500, 'Error'));
      const interaction = createMockButtonInteraction('deny::confirm-del::entry-uuid-1234');

      await handleDetailButton(interaction);

      expect(mockRenderPostActionScreen).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: expect.objectContaining({
            kind: 'error',
            content: expect.stringContaining('Failed to delete'),
          }),
        })
      );
    });
  });

  describe('back navigation', () => {
    it('should route back button through handleSharedBackButton', async () => {
      const interaction = createMockButtonInteraction('deny::back::entry-uuid-1234');

      await handleDetailButton(interaction);

      expect(mockHandleSharedBackButton).toHaveBeenCalledWith(
        interaction,
        'deny',
        'entry-uuid-1234'
      );
    });
  });
});

describe('handleDetailModal', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(isBotOwner).mockReturnValue(true);
  });

  it('should silently deny non-owners', async () => {
    vi.mocked(isBotOwner).mockReturnValue(false);
    const interaction = {
      customId: 'deny::modal::entry-uuid-1234::edit',
      user: { id: 'user-123' },
    } as unknown as ModalSubmitInteraction;

    await handleDetailModal(interaction);

    expect(handleEditModal).not.toHaveBeenCalled();
  });

  it('should delegate to handleEditModal', async () => {
    const interaction = {
      customId: 'deny::modal::entry-uuid-1234::edit',
      user: { id: 'user-123' },
    } as unknown as ModalSubmitInteraction;

    await handleDetailModal(interaction);

    expect(handleEditModal).toHaveBeenCalledWith(interaction, 'entry-uuid-1234');
  });
});
