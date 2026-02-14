import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleEdit, handleEditModal } from './detailEdit.js';
import type { ButtonInteraction, ModalSubmitInteraction } from 'discord.js';

vi.mock('@tzurot/common-types', () => ({
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

vi.mock('../../utils/dashboard/messages.js', () => ({
  DASHBOARD_MESSAGES: {
    SESSION_EXPIRED: '⏰ Session expired.',
    OPERATION_FAILED: (action: string) => `❌ Failed to ${action}.`,
  },
}));

vi.mock('../../utils/adminApiClient.js', () => ({
  adminPostJson: vi.fn(),
  adminFetch: vi.fn(),
}));

// Mock detailTypes so we don't construct Discord.js builders
vi.mock('./detailTypes.js', () => ({
  ENTITY_TYPE: 'deny-detail',
  VALID_SCOPES: ['BOT', 'GUILD', 'CHANNEL', 'PERSONALITY'],
  buildDetailEmbed: vi.fn(() => ({ data: { title: 'Detail' } })),
  buildDetailButtons: vi.fn(() => [{ type: 'action-row' }]),
}));

import { adminPostJson, adminFetch } from '../../utils/adminApiClient.js';

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

function createMockModalInteraction(
  customId: string,
  fields: Record<string, string>
): ModalSubmitInteraction {
  return {
    customId,
    user: { id: 'user-123' },
    channelId: 'chan-1',
    guildId: 'guild-456',
    message: { id: 'msg-1' },
    deferUpdate: vi.fn(),
    editReply: vi.fn(),
    reply: vi.fn(),
    fields: {
      getTextInputValue: vi.fn((name: string) => fields[name] ?? ''),
    },
  } as unknown as ModalSubmitInteraction;
}

describe('handleEdit', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should show modal with pre-filled values', async () => {
    mockSessionManager.get.mockResolvedValue(sampleSession);
    const interaction = createMockButtonInteraction('deny::edit::entry-uuid-1234');

    await handleEdit(interaction, 'entry-uuid-1234');

    expect(interaction.showModal).toHaveBeenCalled();
    expect(interaction.deferUpdate).not.toHaveBeenCalled();
  });

  it('should handle session expiry', async () => {
    mockSessionManager.get.mockResolvedValue(null);
    const interaction = createMockButtonInteraction('deny::edit::entry-uuid-1234');

    await handleEdit(interaction, 'entry-uuid-1234');

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Session expired') })
    );
  });
});

describe('handleEditModal', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should update reason via modal', async () => {
    mockSessionManager.get.mockResolvedValue(sampleSession);
    mockSessionManager.update.mockResolvedValue(sampleSession);
    vi.mocked(adminPostJson).mockResolvedValue(
      mockOkResponse({ entry: { ...sampleEntry, reason: 'New reason' } })
    );
    const interaction = createMockModalInteraction('deny::modal::entry-uuid-1234::edit', {
      scope: 'BOT',
      scopeId: '*',
      reason: 'New reason',
    });

    await handleEditModal(interaction, 'entry-uuid-1234');

    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(adminPostJson).toHaveBeenCalledWith(
      '/admin/denylist',
      expect.objectContaining({ reason: 'New reason', scope: 'BOT', scopeId: '*' }),
      'user-123'
    );
    // Should NOT call adminFetch for delete since scope didn't change
    expect(adminFetch).not.toHaveBeenCalled();
  });

  it('should handle scope change — create new + delete old', async () => {
    mockSessionManager.get.mockResolvedValue(sampleSession);
    mockSessionManager.update.mockResolvedValue(sampleSession);
    vi.mocked(adminPostJson).mockResolvedValue(
      mockOkResponse({ entry: { ...sampleEntry, scope: 'CHANNEL', scopeId: 'chan-999' } })
    );
    vi.mocked(adminFetch).mockResolvedValue(mockOkResponse({ success: true }));
    const interaction = createMockModalInteraction('deny::modal::entry-uuid-1234::edit', {
      scope: 'CHANNEL',
      scopeId: 'chan-999',
      reason: 'Spamming',
    });

    await handleEditModal(interaction, 'entry-uuid-1234');

    expect(adminPostJson).toHaveBeenCalledWith(
      '/admin/denylist',
      expect.objectContaining({ scope: 'CHANNEL', scopeId: 'chan-999' }),
      'user-123'
    );
    expect(adminFetch).toHaveBeenCalledWith('/admin/denylist/USER/111222333444555666/BOT/*', {
      method: 'DELETE',
      userId: 'user-123',
    });
  });

  it('should reject invalid scope', async () => {
    mockSessionManager.get.mockResolvedValue(sampleSession);
    const interaction = createMockModalInteraction('deny::modal::entry-uuid-1234::edit', {
      scope: 'INVALID',
      scopeId: '*',
      reason: '',
    });

    await handleEditModal(interaction, 'entry-uuid-1234');

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Invalid scope') })
    );
    expect(adminPostJson).not.toHaveBeenCalled();
  });

  it('should reject non-* scopeId for BOT scope', async () => {
    mockSessionManager.get.mockResolvedValue(sampleSession);
    const interaction = createMockModalInteraction('deny::modal::entry-uuid-1234::edit', {
      scope: 'BOT',
      scopeId: 'something',
      reason: '',
    });

    await handleEditModal(interaction, 'entry-uuid-1234');

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('BOT scope requires') })
    );
    expect(adminPostJson).not.toHaveBeenCalled();
  });

  it('should handle session expiry', async () => {
    mockSessionManager.get.mockResolvedValue(null);
    const interaction = createMockModalInteraction('deny::modal::entry-uuid-1234::edit', {
      scope: 'BOT',
      scopeId: '*',
      reason: '',
    });

    await handleEditModal(interaction, 'entry-uuid-1234');

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Session expired') })
    );
  });

  it('should handle API error on edit', async () => {
    mockSessionManager.get.mockResolvedValue(sampleSession);
    vi.mocked(adminPostJson).mockResolvedValue(mockErrorResponse(400, { message: 'Bad request' }));
    const interaction = createMockModalInteraction('deny::modal::entry-uuid-1234::edit', {
      scope: 'BOT',
      scopeId: '*',
      reason: 'New reason',
    });

    await handleEditModal(interaction, 'entry-uuid-1234');

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Failed to update') })
    );
  });

  it('should reject reason exceeding max length', async () => {
    mockSessionManager.get.mockResolvedValue(sampleSession);
    const longReason = 'x'.repeat(501);
    const interaction = createMockModalInteraction('deny::modal::entry-uuid-1234::edit', {
      scope: 'BOT',
      scopeId: '*',
      reason: longReason,
    });

    await handleEditModal(interaction, 'entry-uuid-1234');

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Reason too long') })
    );
    expect(adminPostJson).not.toHaveBeenCalled();
  });

  it('should clear reason when empty string submitted', async () => {
    mockSessionManager.get.mockResolvedValue(sampleSession);
    mockSessionManager.update.mockResolvedValue(sampleSession);
    vi.mocked(adminPostJson).mockResolvedValue(mockOkResponse({ entry: sampleEntry }));
    const interaction = createMockModalInteraction('deny::modal::entry-uuid-1234::edit', {
      scope: 'BOT',
      scopeId: '*',
      reason: '',
    });

    await handleEditModal(interaction, 'entry-uuid-1234');

    expect(adminPostJson).toHaveBeenCalledWith(
      '/admin/denylist',
      expect.not.objectContaining({ reason: '' }),
      'user-123'
    );
  });
});
