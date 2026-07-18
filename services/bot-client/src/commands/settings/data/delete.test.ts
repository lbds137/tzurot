/**
 * Tests for /settings data delete (warning embed, button routing, modal
 * handshake).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ButtonInteraction, ModalSubmitInteraction } from 'discord.js';
import {
  handleDataDelete,
  handleDataDeleteButton,
  handleDataDeleteModal,
  SETTINGS_ACCOUNT_DELETE_OPERATION,
} from './delete.js';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { makeOk, makeErr, asUserClient } from '../../../test/gatewayClientStubs.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
}));

const PREVIEW = {
  confirmationPhrase: 'DELETE MY ACCOUNT',
  ownedCharacters: [{ id: 'x1', name: 'XBot', otherUsersWithMemories: 2 }],
  counts: { personas: 2, characters: 1, conversationMessages: 10, memories: 5, facts: 3 },
  hasActiveExport: false,
};

describe('handleDataDelete', () => {
  const mockEditReply = vi.fn();
  let stub: { previewAccountDelete: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockEditReply.mockResolvedValue(undefined);
    stub = { previewAccountDelete: vi.fn() };
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
  });

  function createMockContext(): DeferredCommandContext {
    return {
      user: { id: '123456789', username: 'testuser' },
      editReply: mockEditReply,
      interaction: { user: { id: '123456789' } },
    } as unknown as DeferredCommandContext;
  }

  it('shows the danger embed with counts, character reach, and both buttons', async () => {
    stub.previewAccountDelete.mockResolvedValue(makeOk(PREVIEW));

    await handleDataDelete(createMockContext());

    const call = mockEditReply.mock.calls[0][0];
    const description = call.embeds[0].data.description as string;
    expect(description).toContain('**2** persona(s)');
    expect(description).toContain('deleted for EVERYONE');
    expect(description).toContain('**2** other user(s) have memories');
    expect(description).toContain('export downloads stop');
    expect(description).toContain('DELETE MY ACCOUNT');
    const customIds = call.components[0].components.map(
      (c: { data: { custom_id: string } }) => c.data.custom_id
    );
    // Cancel → Danger order (design-system button rule: Danger is always last).
    expect(customIds).toEqual([
      `settings::destructive::cancel_button::${SETTINGS_ACCOUNT_DELETE_OPERATION}`,
      `settings::destructive::confirm_button::${SETTINGS_ACCOUNT_DELETE_OPERATION}`,
    ]);
  });

  it('renders the superuser 403 as a permission message', async () => {
    stub.previewAccountDelete.mockResolvedValue(makeErr(403, 'superuser'));

    await handleDataDelete(createMockContext());

    expect(mockEditReply.mock.calls[0][0].content).toContain('bot-owner');
  });

  it('warns when an export is currently running', async () => {
    stub.previewAccountDelete.mockResolvedValue(makeOk({ ...PREVIEW, hasActiveExport: true }));

    await handleDataDelete(createMockContext());

    const description = mockEditReply.mock.calls[0][0].embeds[0].data.description as string;
    expect(description).toContain('export currently running');
  });
});

describe('handleDataDeleteButton', () => {
  function makeButton(customId: string, userId = '123456789'): ButtonInteraction {
    return {
      customId,
      user: { id: userId },
      // Invoker ownership is read from the parent message's interactionMetadata.
      message: { interactionMetadata: { user: { id: '123456789' } } },
      update: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
      showModal: vi.fn().mockResolvedValue(undefined),
    } as unknown as ButtonInteraction;
  }

  it('cancel clears the warning', async () => {
    const interaction = makeButton(
      `settings::destructive::cancel_button::${SETTINGS_ACCOUNT_DELETE_OPERATION}`
    );
    await handleDataDeleteButton(interaction);
    expect(interaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Deletion cancelled.' })
    );
  });

  it('proceed shows the typed-phrase modal as the FIRST response', async () => {
    const interaction = makeButton(
      `settings::destructive::confirm_button::${SETTINGS_ACCOUNT_DELETE_OPERATION}`
    );
    await handleDataDeleteButton(interaction);

    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    const modal = (interaction.showModal as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // Derived from the button's own customId by the Tier-B factory.
    expect(modal.data.custom_id).toBe(
      `settings::destructive::modal_submit::${SETTINGS_ACCOUNT_DELETE_OPERATION}`
    );
  });

  it('rejects clicks from a different user', async () => {
    const interaction = makeButton(
      `settings::destructive::confirm_button::${SETTINGS_ACCOUNT_DELETE_OPERATION}`,
      'user-OTHER'
    );
    await handleDataDeleteButton(interaction);

    expect(interaction.showModal).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('original command invoker') })
    );
  });
});

describe('handleDataDeleteModal', () => {
  const mockEditReply = vi.fn();
  let stub: {
    issueAccountDeleteToken: ReturnType<typeof vi.fn>;
    deleteAccount: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    stub = { issueAccountDeleteToken: vi.fn(), deleteAccount: vi.fn() };
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
  });

  // Returned as the raw mock shape (not ModalSubmitInteraction) so tests can
  // assert on `update`, which only exists post-isFromMessage() narrowing.
  function makeModal(phrase: string) {
    return {
      customId: `settings::destructive::modal_submit::${SETTINGS_ACCOUNT_DELETE_OPERATION}`,
      user: { id: '123456789' },
      fields: { getTextInputValue: vi.fn().mockReturnValue(phrase) },
      reply: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
      editReply: mockEditReply,
      isFromMessage: vi.fn().mockReturnValue(true),
      message: {
        edit: vi.fn().mockResolvedValue(undefined),
        interactionMetadata: { user: { id: '123456789' } },
      },
    };
  }

  it('cancels on a mismatched phrase without any gateway call', async () => {
    const interaction = makeModal('DELETE MY STUFF');
    await handleDataDeleteModal(interaction as unknown as ModalSubmitInteraction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('did not match') })
    );
    expect(stub.issueAccountDeleteToken).not.toHaveBeenCalled();
  });

  it('runs the token handshake and shows the summary (case-insensitive phrase)', async () => {
    stub.issueAccountDeleteToken.mockResolvedValue(makeOk({ deleteToken: 'acctdel_tok' }));
    stub.deleteAccount.mockResolvedValue(
      makeOk({
        success: true,
        summary: {
          personas: 2,
          characters: 1,
          conversationMessages: 10,
          memories: 5,
          facts: 3,
          factsSweptByTag: 4,
          pendingMemories: 1,
          diagnosticLogs: 1,
          characterNames: ['XBot'],
        },
      })
    );

    const interaction = makeModal('delete my account');
    await handleDataDeleteModal(interaction as unknown as ModalSubmitInteraction);

    expect(interaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Deleting your account…' })
    );
    expect(stub.issueAccountDeleteToken).toHaveBeenCalledWith({
      confirmationPhrase: 'delete my account',
    });
    expect(stub.deleteAccount).toHaveBeenCalledWith({ deleteToken: 'acctdel_tok' });

    const embed = mockEditReply.mock.calls[0][0].embeds[0];
    expect(embed.data.title).toContain('Account Deleted');
    expect(embed.data.description).toContain('XBot');
    expect(embed.data.description).toContain('fresh empty account');
  });

  it('surfaces a failed deletion without a success embed', async () => {
    stub.issueAccountDeleteToken.mockResolvedValue(makeOk({ deleteToken: 'acctdel_tok' }));
    stub.deleteAccount.mockResolvedValue(makeErr(500, 'boom'));

    const interaction = makeModal('DELETE MY ACCOUNT');
    await handleDataDeleteModal(interaction as unknown as ModalSubmitInteraction);

    const call = mockEditReply.mock.calls[0][0];
    expect(call.embeds).toEqual([]);
    expect(call.content).toBeTruthy();
  });
});
