/**
 * Tests for Tier-A confirmation (simple two-button confirm).
 */

import { describe, it, expect } from 'vitest';
import { ButtonStyle } from 'discord.js';
import type { APIButtonComponentWithCustomId } from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { buildConfirmAction, buildDeleteConfirmation } from './confirmAction.js';

function rowButtons(components: ReturnType<typeof buildConfirmAction>['components']) {
  return components[0].components.map(b => b.data as APIButtonComponentWithCustomId);
}

describe('buildConfirmAction', () => {
  const baseOptions = {
    title: 'Confirm Deletion',
    description: 'You are about to delete 12 memories.',
    confirmCustomId: 'memory-batch-delete::confirm',
    cancelCustomId: 'memory-batch-delete::cancel',
    confirmLabel: 'Delete 12 Memories',
  };

  it('orders buttons Cancel first, Danger last', () => {
    const { components } = buildConfirmAction(baseOptions);
    const [first, second] = rowButtons(components);

    expect(first.style).toBe(ButtonStyle.Secondary);
    expect(first.custom_id).toBe('memory-batch-delete::cancel');
    expect(second.style).toBe(ButtonStyle.Danger);
    expect(second.custom_id).toBe('memory-batch-delete::confirm');
  });

  it('sets labels and the confirm emoji separately from the label', () => {
    const { components } = buildConfirmAction({ ...baseOptions, confirmEmoji: '🗑️' });
    const [cancel, confirm] = rowButtons(components);

    expect(cancel.label).toBe('Cancel');
    expect(confirm.label).toBe('Delete 12 Memories');
    expect(confirm.emoji?.name).toBe('🗑️');
    expect(confirm.label).not.toContain('🗑️');
  });

  it('omits the confirm emoji when not provided', () => {
    const { components } = buildConfirmAction(baseOptions);
    const [, confirm] = rowButtons(components);

    expect(confirm.emoji).toBeUndefined();
  });

  it('defaults the embed color to WARNING and renders title/description', () => {
    const { embed } = buildConfirmAction(baseOptions);

    expect(embed.data.color).toBe(DISCORD_COLORS.WARNING);
    expect(embed.data.title).toBe('Confirm Deletion');
    expect(embed.data.description).toBe('You are about to delete 12 memories.');
  });

  it('honors a custom cancel label and color', () => {
    const { embed, components } = buildConfirmAction({
      ...baseOptions,
      cancelLabel: 'Keep Them',
      color: DISCORD_COLORS.ERROR,
    });
    const [cancel] = rowButtons(components);

    expect(cancel.label).toBe('Keep Them');
    expect(embed.data.color).toBe(DISCORD_COLORS.ERROR);
  });
});

describe('buildDeleteConfirmation', () => {
  const baseOptions = {
    entityType: 'Persona',
    entityName: 'My Persona',
    confirmCustomId: 'persona::confirm-delete::abc',
    cancelCustomId: 'persona::cancel-delete::abc',
  };

  it('builds the default delete title and warning description', () => {
    const { embed } = buildDeleteConfirmation(baseOptions);

    expect(embed.data.title).toBe('🗑️ Delete Persona?');
    expect(embed.data.description).toContain('**My Persona**');
    expect(embed.data.description).toContain('This action cannot be undone.');
  });

  it('appends the additional warning and deleted-items list', () => {
    const { embed } = buildDeleteConfirmation({
      ...baseOptions,
      additionalWarning: 'Overrides will be cleared.',
      deletedItems: ['42 messages', '5 memories'],
    });

    expect(embed.data.description).toContain('Overrides will be cleared.');
    expect(embed.data.description).toContain('**This will also delete:**');
    expect(embed.data.description).toContain('• 42 messages');
    expect(embed.data.description).toContain('• 5 memories');
  });

  it('keeps Cancel→Danger order with the delete emoji on the Danger button', () => {
    const { components } = buildDeleteConfirmation(baseOptions);
    const [cancel, confirm] = rowButtons(components);

    expect(cancel.style).toBe(ButtonStyle.Secondary);
    expect(confirm.style).toBe(ButtonStyle.Danger);
    expect(confirm.label).toBe('Delete');
    expect(confirm.emoji?.name).toBe('🗑️');
  });

  it('honors custom title and button labels', () => {
    const { embed, components } = buildDeleteConfirmation({
      ...baseOptions,
      title: 'Remove entry?',
      confirmLabel: 'Remove',
      cancelLabel: 'Back',
    });
    const [cancel, confirm] = rowButtons(components);

    expect(embed.data.title).toBe('Remove entry?');
    expect(confirm.label).toBe('Remove');
    expect(cancel.label).toBe('Back');
  });
});
