import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleEdit, handleEditModal } from './detailEdit.js';
import { DiscordAPIError } from 'discord.js';
import type { ButtonInteraction, ModalSubmitInteraction } from 'discord.js';
import { makeOk, makeErr, asOwnerClient } from '../../test/gatewayClientStubs.js';

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

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
}));

// Mock detailTypes so we don't construct Discord.js builders
vi.mock('./detailTypes.js', () => ({
  ENTITY_TYPE: 'deny',
  VALID_SCOPES: ['BOT', 'GUILD', 'CHANNEL', 'PERSONALITY'],
  buildDetailEmbed: vi.fn(() => ({ data: { title: 'Detail' } })),
  buildDetailButtons: vi.fn(() => [{ type: 'action-row' }]),
}));

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
    reply: vi.fn(),
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
    followUp: vi.fn(),
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

  it('should handle session expiry via reply (unacknowledged button needs initial response)', async () => {
    mockSessionManager.get.mockResolvedValue(null);
    const interaction = createMockButtonInteraction('deny::edit::entry-uuid-1234');

    await handleEdit(interaction, 'entry-uuid-1234');

    // Must use reply (not followUp) — followUp without prior ack lands via the
    // webhook endpoint after Discord's "Application did not respond" banner fires.
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Session expired') })
    );
    expect(interaction.followUp).not.toHaveBeenCalled();
  });

  it('falls back to followUp when the session-expired reply hits 10062 (slow Redis ate the budget)', async () => {
    mockSessionManager.get.mockResolvedValue(null);
    const interaction = createMockButtonInteraction('deny::edit::entry-uuid-1234');
    const timeoutError = new DiscordAPIError(
      { code: 10062, message: 'Unknown interaction' },
      10062,
      404,
      'POST',
      '/interactions/x/y/callback',
      {}
    );
    vi.mocked(interaction.reply).mockRejectedValue(timeoutError);
    // followUp stays the default vi.fn() — resolves undefined, which is all
    // the wrapper's best-effort fallback needs.

    await expect(handleEdit(interaction, 'entry-uuid-1234')).resolves.toBeUndefined();

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Session expired') })
    );
  });
});

describe('handleEditModal', () => {
  let stub: OwnerStub;

  beforeEach(() => {
    vi.resetAllMocks();
    stub = createStub();
    clientsForMock.mockReturnValue({ ownerClient: asOwnerClient(stub) });
  });

  it('should update reason via modal', async () => {
    mockSessionManager.get.mockResolvedValue(sampleSession);
    mockSessionManager.update.mockResolvedValue(sampleSession);
    stub.addDenylistEntry.mockResolvedValue(
      makeOk({ entry: { ...sampleEntry, reason: 'New reason' } })
    );
    const interaction = createMockModalInteraction('deny::modal::entry-uuid-1234::edit', {
      scope: 'BOT',
      scopeId: '*',
      reason: 'New reason',
    });

    await handleEditModal(interaction, 'entry-uuid-1234');

    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(stub.addDenylistEntry).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'New reason', scope: 'BOT', scopeId: '*' })
    );
    // Should NOT call removeDenylistEntry since scope didn't change
    expect(stub.removeDenylistEntry).not.toHaveBeenCalled();
    // A clean edit must null the content to clear any stale partial-failure
    // warning a prior edit left on the message (editReply leaves omitted fields).
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: null }));
  });

  it('should handle scope change — create new + delete old', async () => {
    mockSessionManager.get.mockResolvedValue(sampleSession);
    mockSessionManager.update.mockResolvedValue(sampleSession);
    stub.addDenylistEntry.mockResolvedValue(
      makeOk({ entry: { ...sampleEntry, scope: 'CHANNEL', scopeId: 'chan-999' } })
    );
    stub.removeDenylistEntry.mockResolvedValue(makeOk({ success: true }));
    const interaction = createMockModalInteraction('deny::modal::entry-uuid-1234::edit', {
      scope: 'CHANNEL',
      scopeId: 'chan-999',
      reason: 'Spamming',
    });

    await handleEditModal(interaction, 'entry-uuid-1234');

    expect(stub.addDenylistEntry).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'CHANNEL', scopeId: 'chan-999' })
    );
    expect(stub.removeDenylistEntry).toHaveBeenCalledWith('USER', '111222333444555666', 'BOT', '*');
  });

  it('should warn about a stale entry when old-scope removal fails after scope change', async () => {
    mockSessionManager.get.mockResolvedValue(sampleSession);
    mockSessionManager.update.mockResolvedValue(sampleSession);
    stub.addDenylistEntry.mockResolvedValue(
      makeOk({ entry: { ...sampleEntry, scope: 'CHANNEL', scopeId: 'chan-999' } })
    );
    // New-scope upsert succeeds, but removing the old-scope entry fails — both
    // now exist. The user must be told instead of seeing clean success.
    stub.removeDenylistEntry.mockResolvedValue(makeErr(500, 'gateway down'));
    const interaction = createMockModalInteraction('deny::modal::entry-uuid-1234::edit', {
      scope: 'CHANNEL',
      scopeId: 'chan-999',
      reason: 'Spamming',
    });

    await handleEditModal(interaction, 'entry-uuid-1234');

    expect(stub.removeDenylistEntry).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('old entry could not be removed'),
      })
    );
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
    expect(stub.addDenylistEntry).not.toHaveBeenCalled();
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
    expect(stub.addDenylistEntry).not.toHaveBeenCalled();
  });

  it('defers then followUps on session expiry (ack-first)', async () => {
    mockSessionManager.get.mockResolvedValue(null);
    const interaction = createMockModalInteraction('deny::modal::entry-uuid-1234::edit', {
      scope: 'BOT',
      scopeId: '*',
      reason: '',
    });

    await handleEditModal(interaction, 'entry-uuid-1234');

    // Ack-first: deferUpdate precedes the Redis session read; expiry uses followUp
    // (reply would throw on the already-acked interaction). The old read-then-reply
    // path — with its 10062 reply→followUp fallback — is gone for the modal-submit
    // handler; that fallback now only guards the modal-OPEN handler, which can't
    // defer before showModal.
    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Session expired') })
    );
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('should handle API error on edit', async () => {
    mockSessionManager.get.mockResolvedValue(sampleSession);
    stub.addDenylistEntry.mockResolvedValue(makeErr(400, 'Bad request'));
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
    expect(stub.addDenylistEntry).not.toHaveBeenCalled();
  });

  it('should clear reason when empty string submitted', async () => {
    mockSessionManager.get.mockResolvedValue(sampleSession);
    mockSessionManager.update.mockResolvedValue(sampleSession);
    stub.addDenylistEntry.mockResolvedValue(makeOk({ entry: sampleEntry }));
    const interaction = createMockModalInteraction('deny::modal::entry-uuid-1234::edit', {
      scope: 'BOT',
      scopeId: '*',
      reason: '',
    });

    await handleEditModal(interaction, 'entry-uuid-1234');

    expect(stub.addDenylistEntry).toHaveBeenCalledWith(expect.not.objectContaining({ reason: '' }));
  });
});
