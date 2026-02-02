/**
 * Tests for Destructive Confirmation Utility
 */

import { describe, it, expect, vi } from 'vitest';
import { ButtonStyle, EmbedBuilder, TextInputStyle } from 'discord.js';
import type { APIButtonComponentWithCustomId } from 'discord.js';
import type { ButtonInteraction, ModalSubmitInteraction } from 'discord.js';
import {
  buildDestructiveWarning,
  buildConfirmationModal,
  handleDestructiveCancel,
  handleDestructiveConfirmButton,
  validateConfirmationPhrase,
  handleInvalidConfirmation,
  handleDestructiveModalSubmit,
  createHardDeleteConfig,
  type DestructiveConfirmationConfig,
} from './destructiveConfirmation.js';

// Test configuration
const testConfig: DestructiveConfirmationConfig = {
  source: 'history',
  operation: 'hard-delete',
  entityId: 'test-personality',
  warningTitle: 'Delete History',
  warningDescription: 'This will permanently delete your conversation history.',
  buttonLabel: 'Delete Forever',
  modalTitle: 'Confirm Deletion',
  confirmationLabel: 'Type DELETE to confirm',
  confirmationPhrase: 'DELETE',
  confirmationPlaceholder: 'DELETE',
};

describe('buildDestructiveWarning', () => {
  it('should build embed with correct title and description', () => {
    const result = buildDestructiveWarning(testConfig);

    expect(result.embeds).toHaveLength(1);
    const embed = result.embeds[0];
    expect(embed.data.title).toBe('Delete History');
    expect(embed.data.description).toBe('This will permanently delete your conversation history.');
  });

  it('should build buttons with correct styles', () => {
    const result = buildDestructiveWarning(testConfig);

    expect(result.components).toHaveLength(1);
    const buttons = result.components[0].components;
    expect(buttons).toHaveLength(2);

    // Danger button
    const dangerBtn = buttons[0].data as APIButtonComponentWithCustomId;
    expect(dangerBtn.style).toBe(ButtonStyle.Danger);
    expect(dangerBtn.label).toBe('Delete Forever');

    // Cancel button
    const cancelBtn = buttons[1].data as APIButtonComponentWithCustomId;
    expect(cancelBtn.style).toBe(ButtonStyle.Secondary);
    expect(cancelBtn.label).toBe('Cancel');
  });

  it('should include entityId in custom IDs when provided', () => {
    const result = buildDestructiveWarning(testConfig);
    const buttons = result.components[0].components;

    const confirmBtn = buttons[0].data as APIButtonComponentWithCustomId;
    const cancelBtnData = buttons[1].data as APIButtonComponentWithCustomId;
    expect(confirmBtn.custom_id).toContain('test-personality');
    expect(cancelBtnData.custom_id).toContain('test-personality');
  });

  it('should work without entityId', () => {
    const configWithoutEntity = { ...testConfig, entityId: undefined };
    const result = buildDestructiveWarning(configWithoutEntity);

    const buttons = result.components[0].components;
    const confirmBtn = buttons[0].data as APIButtonComponentWithCustomId;
    const cancelBtn = buttons[1].data as APIButtonComponentWithCustomId;
    expect(confirmBtn.custom_id).toBe('history::destructive::confirm_button::hard-delete');
    expect(cancelBtn.custom_id).toBe('history::destructive::cancel_button::hard-delete');
  });
});

describe('buildConfirmationModal', () => {
  it('should build modal with correct title', () => {
    const modal = buildConfirmationModal(testConfig);

    expect(modal.data.title).toBe('Confirm Deletion');
  });

  it('should include confirmation phrase input', () => {
    const modal = buildConfirmationModal(testConfig);

    expect(modal.components).toHaveLength(1);
    const row = modal.components[0] as { components: Array<{ data: Record<string, unknown> }> };
    expect(row.components).toHaveLength(1);

    const input = row.components[0];
    expect(input.data.custom_id).toBe('confirmation_phrase');
    expect(input.data.label).toBe('Type DELETE to confirm');
    expect(input.data.style).toBe(TextInputStyle.Short);
    expect(input.data.required).toBe(true);
  });

  it('should set correct custom ID with entityId', () => {
    const modal = buildConfirmationModal(testConfig);

    expect(modal.data.custom_id).toBe(
      'history::destructive::modal_submit::hard-delete::test-personality'
    );
  });
});

describe('handleDestructiveCancel', () => {
  it('should update interaction with cancel message', async () => {
    const mockInteraction = {
      update: vi.fn().mockResolvedValue(undefined),
    } as unknown as ButtonInteraction;

    await handleDestructiveCancel(mockInteraction);

    expect(mockInteraction.update).toHaveBeenCalledWith({
      content: 'Operation cancelled.',
      embeds: [],
      components: [],
    });
  });

  it('should use custom cancel message when provided', async () => {
    const mockInteraction = {
      update: vi.fn().mockResolvedValue(undefined),
    } as unknown as ButtonInteraction;

    await handleDestructiveCancel(mockInteraction, 'Deletion cancelled.');

    expect(mockInteraction.update).toHaveBeenCalledWith({
      content: 'Deletion cancelled.',
      embeds: [],
      components: [],
    });
  });
});

describe('handleDestructiveConfirmButton', () => {
  it('should show confirmation modal', async () => {
    const mockInteraction = {
      showModal: vi.fn().mockResolvedValue(undefined),
    } as unknown as ButtonInteraction;

    await handleDestructiveConfirmButton(mockInteraction, testConfig);

    expect(mockInteraction.showModal).toHaveBeenCalled();
    const modal = (mockInteraction.showModal as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(modal.data.title).toBe('Confirm Deletion');
  });
});

describe('validateConfirmationPhrase', () => {
  it('should return true for exact match', () => {
    const mockInteraction = {
      fields: {
        getTextInputValue: vi.fn().mockReturnValue('DELETE'),
      },
    } as unknown as ModalSubmitInteraction;

    const result = validateConfirmationPhrase(mockInteraction, 'DELETE');
    expect(result).toBe(true);
  });

  it('should return true for case-insensitive match', () => {
    const mockInteraction = {
      fields: {
        getTextInputValue: vi.fn().mockReturnValue('delete'),
      },
    } as unknown as ModalSubmitInteraction;

    const result = validateConfirmationPhrase(mockInteraction, 'DELETE');
    expect(result).toBe(true);
  });

  it('should return true for match with whitespace', () => {
    const mockInteraction = {
      fields: {
        getTextInputValue: vi.fn().mockReturnValue('  DELETE  '),
      },
    } as unknown as ModalSubmitInteraction;

    const result = validateConfirmationPhrase(mockInteraction, 'DELETE');
    expect(result).toBe(true);
  });

  it('should return false for wrong phrase', () => {
    const mockInteraction = {
      fields: {
        getTextInputValue: vi.fn().mockReturnValue('REMOVE'),
      },
    } as unknown as ModalSubmitInteraction;

    const result = validateConfirmationPhrase(mockInteraction, 'DELETE');
    expect(result).toBe(false);
  });

  it('should return false for empty input', () => {
    const mockInteraction = {
      fields: {
        getTextInputValue: vi.fn().mockReturnValue(''),
      },
    } as unknown as ModalSubmitInteraction;

    const result = validateConfirmationPhrase(mockInteraction, 'DELETE');
    expect(result).toBe(false);
  });
});

describe('handleInvalidConfirmation', () => {
  it('should reply with error message', async () => {
    const mockInteraction = {
      reply: vi.fn().mockResolvedValue(undefined),
    } as unknown as ModalSubmitInteraction;

    await handleInvalidConfirmation(mockInteraction, 'DELETE');

    expect(mockInteraction.reply).toHaveBeenCalledWith({
      content: 'Confirmation failed. You must type `DELETE` exactly to proceed.',
      ephemeral: true,
    });
  });
});

describe('handleDestructiveModalSubmit', () => {
  it('should call executeOperation when phrase is valid', async () => {
    const mockInteraction = {
      fields: {
        getTextInputValue: vi.fn().mockReturnValue('DELETE'),
      },
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    } as unknown as ModalSubmitInteraction;

    const executeOperation = vi.fn().mockResolvedValue({
      success: true,
      successMessage: 'Deleted successfully!',
    });

    await handleDestructiveModalSubmit(mockInteraction, 'DELETE', executeOperation);

    expect(executeOperation).toHaveBeenCalled();
    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      content: 'Deleted successfully!',
      embeds: [],
      components: [],
    });
  });

  it('should not call executeOperation when phrase is invalid', async () => {
    const mockInteraction = {
      fields: {
        getTextInputValue: vi.fn().mockReturnValue('WRONG'),
      },
      reply: vi.fn().mockResolvedValue(undefined),
    } as unknown as ModalSubmitInteraction;

    const executeOperation = vi.fn();

    await handleDestructiveModalSubmit(mockInteraction, 'DELETE', executeOperation);

    expect(executeOperation).not.toHaveBeenCalled();
    expect(mockInteraction.reply).toHaveBeenCalledWith({
      content: 'Confirmation failed. You must type `DELETE` exactly to proceed.',
      ephemeral: true,
    });
  });

  it('should handle operation failure', async () => {
    const mockInteraction = {
      fields: {
        getTextInputValue: vi.fn().mockReturnValue('DELETE'),
      },
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    } as unknown as ModalSubmitInteraction;

    const executeOperation = vi.fn().mockResolvedValue({
      success: false,
      errorMessage: 'Database error',
    });

    await handleDestructiveModalSubmit(mockInteraction, 'DELETE', executeOperation);

    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      content: 'Database error',
      embeds: [],
      components: [],
    });
  });

  it('should handle success with embed', async () => {
    const successEmbed = new EmbedBuilder().setTitle('Deleted').setDescription('All gone!');

    const mockInteraction = {
      fields: {
        getTextInputValue: vi.fn().mockReturnValue('DELETE'),
      },
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    } as unknown as ModalSubmitInteraction;

    const executeOperation = vi.fn().mockResolvedValue({
      success: true,
      successEmbed,
    });

    await handleDestructiveModalSubmit(mockInteraction, 'DELETE', executeOperation);

    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      content: undefined,
      embeds: [successEmbed],
      components: [],
    });
  });
});

describe('createHardDeleteConfig', () => {
  it('should create standard hard-delete config', () => {
    const config = createHardDeleteConfig({
      entityType: 'conversation history',
      entityName: 'Lilith',
      additionalWarning: 'This cannot be undone!',
      source: 'history',
      operation: 'hard-delete',
      entityId: 'lilith',
    });

    expect(config.source).toBe('history');
    expect(config.operation).toBe('hard-delete');
    expect(config.entityId).toBe('lilith');
    expect(config.warningTitle).toBe('Delete conversation history');
    expect(config.warningDescription).toContain('permanently delete');
    expect(config.warningDescription).toContain('Lilith');
    expect(config.warningDescription).toContain('This cannot be undone!');
    expect(config.buttonLabel).toBe('Delete Forever');
    expect(config.confirmationPhrase).toBe('DELETE');
  });

  it('should work without entityId', () => {
    const config = createHardDeleteConfig({
      entityType: 'all data',
      entityName: 'everything',
      additionalWarning: 'Warning!',
      source: 'admin',
      operation: 'purge',
    });

    expect(config.entityId).toBeUndefined();
  });
});
