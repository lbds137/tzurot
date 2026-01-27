/**
 * Dashboard Messages Tests
 */

import { describe, it, expect } from 'vitest';
import {
  DASHBOARD_MESSAGES,
  formatSessionExpiredMessage,
  formatNotFoundMessage,
} from './messages.js';

describe('DASHBOARD_MESSAGES', () => {
  it('should have static message constants', () => {
    expect(DASHBOARD_MESSAGES.SESSION_EXPIRED).toBe(
      '⏰ Session expired. Please run the command again.'
    );
    expect(DASHBOARD_MESSAGES.DASHBOARD_CLOSED).toBe('✅ Dashboard closed.');
    expect(DASHBOARD_MESSAGES.CANNOT_EDIT).toBe('❌ You do not have permission to edit this.');
    expect(DASHBOARD_MESSAGES.CANNOT_DELETE).toBe('❌ You do not have permission to delete this.');
    expect(DASHBOARD_MESSAGES.UNKNOWN_SECTION).toBe('❌ Unknown section.');
    expect(DASHBOARD_MESSAGES.UNKNOWN_FORM).toBe('❌ Unknown form submission.');
    expect(DASHBOARD_MESSAGES.DELETE_WARNING).toBe('This action cannot be undone.');
    expect(DASHBOARD_MESSAGES.CANCEL_LABEL).toBe('Cancel');
    expect(DASHBOARD_MESSAGES.DELETE_LABEL).toBe('Delete');
    expect(DASHBOARD_MESSAGES.DELETE_CONFIRM_LABEL).toBe('Delete Forever');
  });

  it('should have function message generators', () => {
    expect(DASHBOARD_MESSAGES.NOT_FOUND('Preset')).toBe('❌ Preset not found.');
    expect(DASHBOARD_MESSAGES.NO_PERMISSION('delete')).toBe(
      '❌ You do not have permission to delete.'
    );
    expect(DASHBOARD_MESSAGES.OPERATION_FAILED('save')).toBe(
      '❌ Failed to save. Please try again.'
    );
    expect(DASHBOARD_MESSAGES.LOADING('Deleting')).toBe('🔄 Deleting...');
    expect(DASHBOARD_MESSAGES.SUCCESS('Deleted successfully')).toBe('✅ Deleted successfully');
    expect(DASHBOARD_MESSAGES.DELETE_CONFIRM_TITLE('Persona')).toBe('🗑️ Delete Persona?');
  });
});

describe('formatSessionExpiredMessage', () => {
  it('should format message with command hint', () => {
    expect(formatSessionExpiredMessage('/persona browse')).toBe(
      '⏰ Session expired. Please run `/persona browse` again.'
    );
  });

  it('should handle different commands', () => {
    expect(formatSessionExpiredMessage('/preset list')).toBe(
      '⏰ Session expired. Please run `/preset list` again.'
    );
  });
});

describe('formatNotFoundMessage', () => {
  it('should format message without entity name', () => {
    expect(formatNotFoundMessage('Character')).toBe('❌ Character not found.');
  });

  it('should format message with entity name', () => {
    expect(formatNotFoundMessage('Preset', 'My Preset')).toBe('❌ Preset "My Preset" not found.');
  });

  it('should handle undefined entity name', () => {
    expect(formatNotFoundMessage('Persona', undefined)).toBe('❌ Persona not found.');
  });
});
