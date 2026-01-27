/**
 * Tests for Dashboard Delete Confirmation
 */

import { describe, it, expect } from 'vitest';
import { ButtonStyle } from 'discord.js';
import {
  buildDeleteConfirmation,
  buildDeleteSuccessMessage,
  buildDeleteSummary,
} from './deleteConfirmation.js';

describe('deleteConfirmation', () => {
  describe('buildDeleteConfirmation', () => {
    it('should build confirmation with required options', () => {
      const result = buildDeleteConfirmation({
        entityType: 'Persona',
        entityName: 'My Persona',
        confirmCustomId: 'persona::confirm-delete::123',
        cancelCustomId: 'persona::cancel-delete::123',
      });

      expect(result.embed).toBeDefined();
      expect(result.components).toHaveLength(1);

      const embedData = result.embed.toJSON();
      expect(embedData.title).toBe('🗑️ Delete Persona?');
      expect(embedData.description).toContain('**My Persona**');
      expect(embedData.description).toContain('cannot be undone');
    });

    it('should include additional warning when provided', () => {
      const result = buildDeleteConfirmation({
        entityType: 'Preset',
        entityName: 'Test Preset',
        confirmCustomId: 'confirm',
        cancelCustomId: 'cancel',
        additionalWarning: 'All characters using this preset will be affected.',
      });

      const description = result.embed.toJSON().description ?? '';
      expect(description).toContain('All characters using this preset will be affected.');
    });

    it('should include deleted items list when provided', () => {
      const result = buildDeleteConfirmation({
        entityType: 'Character',
        entityName: 'Test Character',
        confirmCustomId: 'confirm',
        cancelCustomId: 'cancel',
        deletedItems: ['Conversation history', 'Long-term memories', 'Channel settings'],
      });

      const description = result.embed.toJSON().description ?? '';
      expect(description).toContain('**This will also delete:**');
      expect(description).toContain('• Conversation history');
      expect(description).toContain('• Long-term memories');
      expect(description).toContain('• Channel settings');
    });

    it('should build buttons with correct styles and custom IDs', () => {
      const result = buildDeleteConfirmation({
        entityType: 'Persona',
        entityName: 'Test',
        confirmCustomId: 'persona::confirm-delete::abc',
        cancelCustomId: 'persona::cancel-delete::abc',
      });

      const row = result.components[0];
      const buttons = row.toJSON().components;

      expect(buttons).toHaveLength(2);

      // Cancel button (first)
      expect(buttons[0].custom_id).toBe('persona::cancel-delete::abc');
      expect(buttons[0].style).toBe(ButtonStyle.Secondary);
      expect(buttons[0].label).toBe('Cancel');

      // Confirm button (second)
      expect(buttons[1].custom_id).toBe('persona::confirm-delete::abc');
      expect(buttons[1].style).toBe(ButtonStyle.Danger);
      expect(buttons[1].label).toBe('Delete');
    });

    it('should use custom labels when provided', () => {
      const result = buildDeleteConfirmation({
        entityType: 'Persona',
        entityName: 'Test',
        confirmCustomId: 'confirm',
        cancelCustomId: 'cancel',
        confirmLabel: 'Yes, Delete Forever',
        cancelLabel: 'No, Keep It',
      });

      const buttons = result.components[0].toJSON().components;
      expect(buttons[0].label).toBe('No, Keep It');
      expect(buttons[1].label).toBe('Yes, Delete Forever');
    });

    it('should use custom title when provided', () => {
      const result = buildDeleteConfirmation({
        entityType: 'Persona',
        entityName: 'Test',
        confirmCustomId: 'confirm',
        cancelCustomId: 'cancel',
        title: '⚠️ Permanently Remove Persona?',
      });

      expect(result.embed.toJSON().title).toBe('⚠️ Permanently Remove Persona?');
    });
  });

  describe('buildDeleteSuccessMessage', () => {
    it('should format success message with entity name', () => {
      const message = buildDeleteSuccessMessage('Persona', 'My Persona');
      expect(message).toBe('✅ **My Persona** has been deleted.');
    });
  });

  describe('buildDeleteSummary', () => {
    it('should format summary with counts', () => {
      const message = buildDeleteSummary('My Character', {
        'conversation messages': 42,
        'long-term memories': 5,
        'channel settings': 3,
      });

      expect(message).toContain('✅ **My Character** has been deleted.');
      expect(message).toContain('**Deleted data:**');
      expect(message).toContain('• 42 conversation messages');
      expect(message).toContain('• 5 long-term memories');
      expect(message).toContain('• 3 channel settings');
    });

    it('should exclude zero counts', () => {
      const message = buildDeleteSummary('Test', {
        conversations: 10,
        memories: 0,
        settings: 0,
      });

      expect(message).toContain('• 10 conversations');
      expect(message).not.toContain('memories');
      expect(message).not.toContain('settings');
    });

    it('should not show deleted data section when all counts are zero', () => {
      const message = buildDeleteSummary('Test', {
        conversations: 0,
        memories: 0,
      });

      expect(message).toBe('✅ **Test** has been deleted.');
      expect(message).not.toContain('**Deleted data:**');
    });
  });
});
