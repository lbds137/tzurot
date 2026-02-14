import { describe, it, expect, vi, beforeEach } from 'vitest';
import { showDetailView, handleDetailButton, handleDetailModal } from './detail.js';
import type { ButtonInteraction, ModalSubmitInteraction } from 'discord.js';

// Mock dependencies
vi.mock('@tzurot/common-types', () => ({
  isBotOwner: vi.fn(),
  DISCORD_COLORS: { ERROR: 0xff0000, WARNING: 0xffaa00 },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

const mockSessionManager = {
  set: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../../utils/dashboard/SessionManager.js', () => ({
  getSessionManager: vi.fn(() => mockSessionManager),
}));

vi.mock('../../utils/dashboard/deleteConfirmation.js', () => ({
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

vi.mock('../../utils/adminApiClient.js', () => ({
  adminPostJson: vi.fn(),
  adminFetch: vi.fn(),
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
  ENTITY_TYPE: 'deny-detail',
  buildDetailEmbed: vi.fn(() => ({ data: { title: 'Detail' } })),
  buildDetailButtons: vi.fn(() => [{ type: 'action-row' }]),
}));

vi.mock('./detailEdit.js', () => ({
  handleEdit: vi.fn(),
  handleEditModal: vi.fn(),
}));

import { isBotOwner } from '@tzurot/common-types';
import { adminPostJson, adminFetch } from '../../utils/adminApiClient.js';
import { buildDeleteConfirmation } from '../../utils/dashboard/deleteConfirmation.js';
import { fetchEntries, buildBrowseResponse } from './browse.js';
import { handleEdit, handleEditModal } from './detailEdit.js';

const sampleEntry = {
  id: 'entry-uuid-1234',
  type: 'USER',
  discordId: '111222333444555666',
  scope: 'BOT',
  scopeId: '*',
  mode: 'BLOCK',
  reason: 'Spamming',
  addedAt: '2026-01-15T00:00:00.000Z',
  addedBy: 'owner-1',
};

const sampleSession = {
  data: {
    ...sampleEntry,
    browseContext: { page: 0, filter: 'all', sort: 'date' },
    guildId: 'guild-456',
  },
  userId: 'user-123',
  entityType: 'deny-detail',
  entityId: 'entry-uuid-1234',
  messageId: 'msg-1',
  channelId: 'chan-1',
  createdAt: new Date(),
  lastActivityAt: new Date(),
};

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

    await showDetailView(interaction, sampleEntry, { page: 0, filter: 'all', sort: 'date' });

    expect(mockSessionManager.set).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-123',
        entityType: 'deny-detail',
        entityId: 'entry-uuid-1234',
        data: expect.objectContaining({
          id: 'entry-uuid-1234',
          type: 'USER',
          mode: 'BLOCK',
        }),
      })
    );
    expect(interaction.editReply).toHaveBeenCalledWith({
      embeds: expect.any(Array),
      components: expect.any(Array),
    });
  });
});

describe('handleDetailButton', () => {
  beforeEach(() => {
    vi.resetAllMocks();
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
      vi.mocked(adminPostJson).mockResolvedValue(mockOkResponse({ success: true }));
      const interaction = createMockButtonInteraction('deny::mode::entry-uuid-1234');

      await handleDetailButton(interaction);

      expect(interaction.deferUpdate).toHaveBeenCalled();
      expect(adminPostJson).toHaveBeenCalledWith(
        '/admin/denylist',
        expect.objectContaining({ mode: 'MUTE' }),
        'user-123'
      );
      expect(mockSessionManager.update).toHaveBeenCalledWith(
        'user-123',
        'deny-detail',
        'entry-uuid-1234',
        { mode: 'MUTE' }
      );
    });

    it('should flip MUTE to BLOCK', async () => {
      const muteSession = {
        ...sampleSession,
        data: { ...sampleSession.data, mode: 'MUTE' },
      };
      mockSessionManager.get.mockResolvedValue(muteSession);
      mockSessionManager.update.mockResolvedValue(muteSession);
      vi.mocked(adminPostJson).mockResolvedValue(mockOkResponse({ success: true }));
      const interaction = createMockButtonInteraction('deny::mode::entry-uuid-1234');

      await handleDetailButton(interaction);

      expect(adminPostJson).toHaveBeenCalledWith(
        '/admin/denylist',
        expect.objectContaining({ mode: 'BLOCK' }),
        'user-123'
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
      vi.mocked(adminPostJson).mockResolvedValue(mockErrorResponse(500, { message: 'Error' }));
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

    it('should delete entry and return to browse when entries remain', async () => {
      mockSessionManager.get.mockResolvedValue(sampleSession);
      mockSessionManager.delete.mockResolvedValue(true);
      vi.mocked(adminFetch).mockResolvedValue(mockOkResponse({ success: true }));
      vi.mocked(fetchEntries).mockResolvedValue([sampleEntry]);
      const interaction = createMockButtonInteraction('deny::confirm-del::entry-uuid-1234');

      await handleDetailButton(interaction);

      expect(adminFetch).toHaveBeenCalledWith('/admin/denylist/USER/111222333444555666/BOT/*', {
        method: 'DELETE',
        userId: 'user-123',
      });
      expect(mockSessionManager.delete).toHaveBeenCalledWith(
        'user-123',
        'deny-detail',
        'entry-uuid-1234'
      );
      expect(fetchEntries).toHaveBeenCalledWith('user-123');
      expect(buildBrowseResponse).toHaveBeenCalledWith([sampleEntry], 0, 'all', 'date');
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('has been deleted'),
          embeds: expect.any(Array),
          components: expect.any(Array),
        })
      );
    });

    it('should delete entry and show empty message when no entries remain', async () => {
      mockSessionManager.get.mockResolvedValue(sampleSession);
      mockSessionManager.delete.mockResolvedValue(true);
      vi.mocked(adminFetch).mockResolvedValue(mockOkResponse({ success: true }));
      vi.mocked(fetchEntries).mockResolvedValue([]);
      const interaction = createMockButtonInteraction('deny::confirm-del::entry-uuid-1234');

      await handleDetailButton(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('No entries remaining'),
        embeds: [],
        components: [],
      });
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

    it('should handle delete API error', async () => {
      mockSessionManager.get.mockResolvedValue(sampleSession);
      vi.mocked(adminFetch).mockResolvedValue(mockErrorResponse(500, { message: 'Error' }));
      const interaction = createMockButtonInteraction('deny::confirm-del::entry-uuid-1234');

      await handleDetailButton(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Failed to delete') })
      );
    });
  });

  describe('back navigation', () => {
    it('should return to browse view', async () => {
      mockSessionManager.get.mockResolvedValue(sampleSession);
      mockSessionManager.delete.mockResolvedValue(true);
      vi.mocked(fetchEntries).mockResolvedValue([sampleEntry]);
      const interaction = createMockButtonInteraction('deny::back::entry-uuid-1234');

      await handleDetailButton(interaction);

      expect(mockSessionManager.delete).toHaveBeenCalledWith(
        'user-123',
        'deny-detail',
        'entry-uuid-1234'
      );
      expect(fetchEntries).toHaveBeenCalledWith('user-123');
      expect(buildBrowseResponse).toHaveBeenCalledWith([sampleEntry], 0, 'all', 'date');
    });

    it('should handle fetch failure on back', async () => {
      mockSessionManager.get.mockResolvedValue(sampleSession);
      mockSessionManager.delete.mockResolvedValue(true);
      vi.mocked(fetchEntries).mockResolvedValue(null);
      const interaction = createMockButtonInteraction('deny::back::entry-uuid-1234');

      await handleDetailButton(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Failed to fetch') })
      );
    });

    it('should handle session expiry on back', async () => {
      mockSessionManager.get.mockResolvedValue(null);
      const interaction = createMockButtonInteraction('deny::back::entry-uuid-1234');

      await handleDetailButton(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Session expired') })
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
