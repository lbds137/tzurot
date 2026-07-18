/**
 * Tests for Tier-B destructive confirmation (typed-phrase flow).
 */

import { describe, it, expect, vi } from 'vitest';
import { ButtonStyle, EmbedBuilder, MessageFlags } from 'discord.js';
import type {
  APIButtonComponentWithCustomId,
  ButtonInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import { DestructiveCustomIds } from '../customIds.js';
import {
  buildDestructiveWarning,
  buildConfirmationModal,
  handleDestructiveCancel,
  handleDestructiveConfirmButton,
  handleDestructiveModalSubmit,
  validateConfirmationPhrase,
  createHardDeleteConfig,
  dynamicDeletePhrase,
  hardDeleteModalDisplay,
  FIXED_DELETE_PHRASE,
  type DestructiveConfirmationConfig,
} from './confirmDestructive.js';

const INVOKER = '123456789012345678';
const OTHER_USER = '999999999999999999';

const testConfig: DestructiveConfirmationConfig = {
  source: 'history',
  operation: 'hard-delete',
  entityId: 'test-personality|555',
  warningTitle: 'Delete History',
  warningDescription: 'This will permanently delete your conversation history.',
  buttonLabel: 'Delete Forever',
  modalTitle: 'Confirm Deletion',
  confirmationLabel: 'Type: DELETE',
  confirmationPhrase: 'DELETE',
  confirmationPlaceholder: 'DELETE',
};

const display = hardDeleteModalDisplay('test', 'DELETE');

function buttonInteraction(
  customId: string,
  userId: string = INVOKER,
  options: { noMetadata?: boolean } = {}
): ButtonInteraction & {
  reply: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  showModal: ReturnType<typeof vi.fn>;
} {
  return {
    customId,
    user: { id: userId },
    // Invoker ownership is read from the parent message's metadata (the
    // original slash invoker), never from the customId.
    message:
      options.noMetadata === true
        ? { interactionMetadata: null }
        : { interactionMetadata: { user: { id: INVOKER } } },
    reply: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    showModal: vi.fn().mockResolvedValue(undefined),
  } as unknown as ButtonInteraction & {
    reply: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    showModal: ReturnType<typeof vi.fn>;
  };
}

function modalInteraction(
  customId: string,
  typed: string,
  options: { userId?: string; fromMessage?: boolean; parentEditThrows?: boolean } = {}
): ModalSubmitInteraction & {
  reply: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  editReply: ReturnType<typeof vi.fn>;
  message: { edit: ReturnType<typeof vi.fn> } | null;
} {
  const parentEdit =
    options.parentEditThrows === true
      ? vi.fn().mockRejectedValue(new Error('parent gone'))
      : vi.fn().mockResolvedValue(undefined);
  return {
    customId,
    user: { id: options.userId ?? INVOKER },
    fields: { getTextInputValue: vi.fn().mockReturnValue(typed) },
    isFromMessage: vi.fn().mockReturnValue(options.fromMessage ?? true),
    message: { edit: parentEdit, interactionMetadata: { user: { id: INVOKER } } },
    reply: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  } as unknown as ModalSubmitInteraction & {
    reply: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    editReply: ReturnType<typeof vi.fn>;
    message: { edit: ReturnType<typeof vi.fn> } | null;
  };
}

describe('buildDestructiveWarning', () => {
  it('orders buttons Cancel first, Danger last', () => {
    const result = buildDestructiveWarning(testConfig);
    const buttons = result.components[0].components.map(
      b => b.data as APIButtonComponentWithCustomId
    );

    expect(buttons).toHaveLength(2);
    expect(buttons[0].style).toBe(ButtonStyle.Secondary);
    expect(buttons[0].label).toBe('Cancel');
    expect(buttons[1].style).toBe(ButtonStyle.Danger);
    expect(buttons[1].label).toBe('Delete Forever');
  });

  it('carries source, operation, and entity in the custom IDs', () => {
    const result = buildDestructiveWarning(testConfig);
    const [cancel, confirm] = result.components[0].components.map(
      b => (b.data as APIButtonComponentWithCustomId).custom_id
    );

    expect(confirm).toBe('history::destructive::confirm_button::hard-delete::test-personality|555');
    expect(cancel).toBe('history::destructive::cancel_button::hard-delete::test-personality|555');
  });

  it('renders the warning embed title and description', () => {
    const result = buildDestructiveWarning(testConfig);

    expect(result.embeds[0].data.title).toBe('Delete History');
    expect(result.embeds[0].data.description).toBe(
      'This will permanently delete your conversation history.'
    );
  });
});

describe('buildConfirmationModal', () => {
  it('derives the modal customId from the parsed button customId', () => {
    const buttonId = DestructiveCustomIds.confirmButton('voice', 'voice-clear', 'all');
    const parsed = DestructiveCustomIds.parse(buttonId);
    expect(parsed).not.toBeNull();
    if (parsed === null) {
      return;
    }

    const modal = buildConfirmationModal(parsed, display);

    expect(modal.data.custom_id).toBe('voice::destructive::modal_submit::voice-clear::all');
  });

  it('bounds the input length to the phrase length plus buffer', () => {
    const buttonId = DestructiveCustomIds.confirmButton('history', 'hard-delete');
    const parsed = DestructiveCustomIds.parse(buttonId);
    if (parsed === null) {
      throw new Error('parse failed');
    }

    const modal = buildConfirmationModal(parsed, hardDeleteModalDisplay('lilith'));
    const row = modal.components[0] as { components: Array<{ data: Record<string, unknown> }> };
    const input = row.components[0];

    expect(input.data.min_length).toBe('DELETE LILITH'.length);
    expect(input.data.max_length).toBe('DELETE LILITH'.length + 5);
  });
});

describe('handleDestructiveConfirmButton', () => {
  it('shows a modal whose routing derives from the button, not the display config', async () => {
    // Regression: the voice-clear confirm handler once re-built its config with
    // source 'settings', routing the modal to a command with no destructive
    // branch — the typed confirmation was silently dropped.
    const interaction = buttonInteraction(
      DestructiveCustomIds.confirmButton('voice', 'voice-clear', 'all')
    );

    await handleDestructiveConfirmButton(interaction, display);

    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    const modal = interaction.showModal.mock.calls[0][0] as { data: { custom_id: string } };
    expect(modal.data.custom_id.startsWith('voice::destructive::modal_submit::')).toBe(true);
  });

  it('rejects a click from a different user without showing the modal', async () => {
    const interaction = buttonInteraction(
      DestructiveCustomIds.confirmButton('history', 'hard-delete'),
      OTHER_USER
    );

    await handleDestructiveConfirmButton(interaction, display);

    expect(interaction.showModal).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral })
    );
  });

  it('rejects a malformed customId', async () => {
    const interaction = buttonInteraction('not-a-destructive-id');

    await handleDestructiveConfirmButton(interaction, display);

    expect(interaction.showModal).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral })
    );
  });

  it('fails OPEN when the parent message has no interactionMetadata', async () => {
    // Defense-in-depth posture: the ephemeral surface is the primary gate;
    // missing metadata must not lock the invoker out of their own confirm.
    const interaction = buttonInteraction(
      DestructiveCustomIds.confirmButton('history', 'hard-delete'),
      INVOKER,
      { noMetadata: true }
    );

    await handleDestructiveConfirmButton(interaction, display);

    expect(interaction.showModal).toHaveBeenCalledTimes(1);
  });
});

describe('handleDestructiveCancel', () => {
  it('updates the message with the cancel text for the invoker', async () => {
    const interaction = buttonInteraction(
      DestructiveCustomIds.cancelButton('history', 'hard-delete')
    );

    await handleDestructiveCancel(interaction, 'Deletion cancelled.');

    expect(interaction.update).toHaveBeenCalledWith({
      content: 'Deletion cancelled.',
      embeds: [],
      components: [],
    });
  });

  it('rejects a cancel from a different user', async () => {
    const interaction = buttonInteraction(
      DestructiveCustomIds.cancelButton('history', 'hard-delete'),
      OTHER_USER
    );

    await handleDestructiveCancel(interaction);

    expect(interaction.update).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral })
    );
  });
});

describe('validateConfirmationPhrase', () => {
  it.each([
    ['DELETE', true],
    ['delete', true],
    ['  DELETE  ', true],
    ['REMOVE', false],
    ['', false],
  ])('input %j → %s', (typed, expected) => {
    const interaction = modalInteraction('x', typed);
    expect(validateConfirmationPhrase(interaction, 'DELETE')).toBe(expected);
  });
});

describe('handleDestructiveModalSubmit', () => {
  const modalId = DestructiveCustomIds.modalSubmit('history', 'hard-delete', 'e|c');

  it('acks with progress, runs the operation with the entered phrase, and renders success', async () => {
    const interaction = modalInteraction(modalId, 'delete lilith');
    const executeOperation = vi
      .fn()
      .mockResolvedValue({ success: true, successMessage: 'Deleted!' });

    await handleDestructiveModalSubmit(interaction, 'DELETE LILITH', executeOperation, {
      progressContent: 'Deleting…',
    });

    expect(interaction.update).toHaveBeenCalledWith({
      content: 'Deleting…',
      embeds: [],
      components: [],
    });
    expect(executeOperation).toHaveBeenCalledWith('delete lilith');
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Deleted!',
      embeds: [],
      components: [],
    });
  });

  it('renders a success embed when provided', async () => {
    const interaction = modalInteraction(modalId, 'DELETE');
    const embed = new EmbedBuilder().setTitle('Done');
    const executeOperation = vi.fn().mockResolvedValue({ success: true, successEmbed: embed });

    await handleDestructiveModalSubmit(interaction, 'DELETE', executeOperation);

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: '',
      embeds: [embed],
      components: [],
    });
  });

  it('renders the failure message when the operation fails', async () => {
    const interaction = modalInteraction(modalId, 'DELETE');
    const executeOperation = vi
      .fn()
      .mockResolvedValue({ success: false, errorMessage: 'Gateway said no.' });

    await handleDestructiveModalSubmit(interaction, 'DELETE', executeOperation);

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Gateway said no.',
      embeds: [],
      components: [],
    });
  });

  it('on phrase mismatch: ephemeral notice + parent cleanup, no operation', async () => {
    const interaction = modalInteraction(modalId, 'WRONG');
    const executeOperation = vi.fn();

    await handleDestructiveModalSubmit(interaction, 'DELETE', executeOperation);

    expect(executeOperation).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: MessageFlags.Ephemeral,
        content: expect.stringContaining('did not match'),
      })
    );
    expect(interaction.message?.edit).toHaveBeenCalled();
  });

  it('escapes markdown in the echoed mismatch input', async () => {
    const interaction = modalInteraction(modalId, 'WRONG`injection`');

    await handleDestructiveModalSubmit(interaction, 'DELETE', vi.fn());

    const call = interaction.reply.mock.calls[0][0] as { content: string };
    expect(call.content).toContain('\\`injection\\`');
  });

  it('survives a failing parent-message edit on mismatch', async () => {
    const interaction = modalInteraction(modalId, 'WRONG', { parentEditThrows: true });

    await expect(
      handleDestructiveModalSubmit(interaction, 'DELETE', vi.fn())
    ).resolves.toBeUndefined();
    expect(interaction.reply).toHaveBeenCalled();
  });

  it('rejects a submit from a different user without running the operation', async () => {
    const interaction = modalInteraction(modalId, 'DELETE', { userId: OTHER_USER });
    const executeOperation = vi.fn();

    await handleDestructiveModalSubmit(interaction, 'DELETE', executeOperation);

    expect(executeOperation).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral })
    );
  });

  it('rejects a modal without a parent message before running the operation', async () => {
    const interaction = modalInteraction(modalId, 'DELETE', { fromMessage: false });
    const executeOperation = vi.fn();

    await handleDestructiveModalSubmit(interaction, 'DELETE', executeOperation);

    expect(executeOperation).not.toHaveBeenCalled();
    expect(interaction.update).not.toHaveBeenCalled();
  });

  it('uses the default progress and success texts when none are provided', async () => {
    const interaction = modalInteraction(modalId, 'DELETE');
    const executeOperation = vi.fn().mockResolvedValue({ success: true });

    await handleDestructiveModalSubmit(interaction, 'DELETE', executeOperation);

    expect(interaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Working…' })
    );
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Operation completed successfully.' })
    );
  });

  it('renders the catalog fallback when a failure has no errorMessage', async () => {
    const interaction = modalInteraction(modalId, 'DELETE');
    const executeOperation = vi.fn().mockResolvedValue({ success: false });

    await handleDestructiveModalSubmit(interaction, 'DELETE', executeOperation);

    const call = interaction.editReply.mock.calls[0][0] as { content: string };
    expect(call.content.length).toBeGreaterThan(0);
  });

  it('rejects a malformed modal customId before any work', async () => {
    const interaction = modalInteraction('nope', 'DELETE');
    const executeOperation = vi.fn();

    await handleDestructiveModalSubmit(interaction, 'DELETE', executeOperation);

    expect(executeOperation).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral })
    );
  });
});

describe('dynamicDeletePhrase', () => {
  it('builds DELETE {NAME} uppercased', () => {
    expect(dynamicDeletePhrase('lilith')).toBe('DELETE LILITH');
    expect(dynamicDeletePhrase('all your Tzurot voices')).toBe('DELETE ALL YOUR TZUROT VOICES');
  });

  it('falls back to the fixed phrase when the dynamic form is too long to type', () => {
    const longName = 'a'.repeat(60);
    expect(dynamicDeletePhrase(longName)).toBe(FIXED_DELETE_PHRASE);
  });
});

describe('hardDeleteModalDisplay', () => {
  it('keeps the phrase consistent across label, phrase, and placeholder', () => {
    const result = hardDeleteModalDisplay('lilith');

    expect(result.confirmationPhrase).toBe('DELETE LILITH');
    expect(result.confirmationPlaceholder).toBe('DELETE LILITH');
    expect(result.confirmationLabel).toBe('Type: DELETE LILITH');
  });

  it('caps the label at the Discord 45-char limit', () => {
    const result = hardDeleteModalDisplay('x', 'D'.repeat(45));
    expect(result.confirmationLabel.length).toBeLessThanOrEqual(45);
  });

  it('honors a wire-contract phrase override', () => {
    const result = hardDeleteModalDisplay('anything', 'DELETE MY ACCOUNT');
    expect(result.confirmationPhrase).toBe('DELETE MY ACCOUNT');
  });
});

describe('createHardDeleteConfig', () => {
  it('uses the dynamic phrase and mentions it in the warning', () => {
    const config = createHardDeleteConfig({
      entityType: 'conversation history',
      entityName: 'lilith',
      additionalWarning: 'Permanent!',
      source: 'history',
      operation: 'hard-delete',
      entityId: 'lilith|555',
    });

    expect(config.confirmationPhrase).toBe('DELETE LILITH');
    expect(config.warningDescription).toContain('`DELETE LILITH`');
  });

  it('honors an explicit phrase override', () => {
    const config = createHardDeleteConfig({
      entityType: 'account',
      entityName: 'everything',
      additionalWarning: 'Permanent!',
      source: 'settings',
      operation: 'account-delete',
      confirmationPhrase: 'DELETE MY ACCOUNT',
    });

    expect(config.confirmationPhrase).toBe('DELETE MY ACCOUNT');
    expect(config.warningDescription).toContain('`DELETE MY ACCOUNT`');
  });
});
