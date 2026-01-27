/**
 * Autocomplete Format Utility Tests
 */

import { describe, it, expect } from 'vitest';
import {
  formatAutocompleteOption,
  formatAutocompleteOptions,
  AUTOCOMPLETE_BADGES,
  type AutocompleteOptionConfig,
} from './autocompleteFormat.js';

describe('autocompleteFormat', () => {
  describe('AUTOCOMPLETE_BADGES', () => {
    it('should have all expected scope badges', () => {
      expect(AUTOCOMPLETE_BADGES.GLOBAL).toBe('🌐');
      expect(AUTOCOMPLETE_BADGES.OWNED).toBe('🔒');
      expect(AUTOCOMPLETE_BADGES.PUBLIC).toBe('🌐');
      expect(AUTOCOMPLETE_BADGES.READ_ONLY).toBe('📖');
    });

    it('should have all expected status badges', () => {
      expect(AUTOCOMPLETE_BADGES.DEFAULT).toBe('⭐');
      expect(AUTOCOMPLETE_BADGES.FREE).toBe('🆓');
      expect(AUTOCOMPLETE_BADGES.LOCKED).toBe('🔐');
    });
  });

  describe('formatAutocompleteOption', () => {
    it('should format basic option with just name and value', () => {
      const result = formatAutocompleteOption({
        name: 'My Config',
        value: 'config-123',
      });

      expect(result).toEqual({
        name: 'My Config',
        value: 'config-123',
      });
    });

    it('should add scope badge as prefix', () => {
      const result = formatAutocompleteOption({
        name: 'Global Config',
        value: 'config-123',
        scopeBadge: AUTOCOMPLETE_BADGES.GLOBAL,
      });

      expect(result.name).toBe('🌐 Global Config');
    });

    it('should combine scope and status badges', () => {
      const result = formatAutocompleteOption({
        name: 'Default Config',
        value: 'config-123',
        scopeBadge: AUTOCOMPLETE_BADGES.GLOBAL,
        statusBadges: [AUTOCOMPLETE_BADGES.DEFAULT],
      });

      expect(result.name).toBe('🌐⭐ Default Config');
    });

    it('should support multiple status badges', () => {
      const result = formatAutocompleteOption({
        name: 'Free Default',
        value: 'config-123',
        scopeBadge: AUTOCOMPLETE_BADGES.GLOBAL,
        statusBadges: [AUTOCOMPLETE_BADGES.DEFAULT, AUTOCOMPLETE_BADGES.FREE],
      });

      expect(result.name).toBe('🌐⭐🆓 Free Default');
    });

    it('should limit status badges to 2', () => {
      const result = formatAutocompleteOption({
        name: 'Config',
        value: 'config-123',
        scopeBadge: AUTOCOMPLETE_BADGES.GLOBAL,
        statusBadges: [
          AUTOCOMPLETE_BADGES.DEFAULT,
          AUTOCOMPLETE_BADGES.FREE,
          AUTOCOMPLETE_BADGES.LOCKED, // This should be ignored
        ],
      });

      expect(result.name).toBe('🌐⭐🆓 Config');
      expect(result.name).not.toContain('🔐');
    });

    it('should append identifier in parentheses', () => {
      const result = formatAutocompleteOption({
        name: 'My Character',
        value: 'char-123',
        scopeBadge: AUTOCOMPLETE_BADGES.OWNED,
        identifier: 'my-char',
      });

      expect(result.name).toBe('🔒 My Character (my-char)');
    });

    it('should append metadata after separator', () => {
      const result = formatAutocompleteOption({
        name: 'Premium Config',
        value: 'config-123',
        scopeBadge: AUTOCOMPLETE_BADGES.GLOBAL,
        metadata: 'claude-sonnet-4',
      });

      expect(result.name).toBe('🌐 Premium Config · claude-sonnet-4');
    });

    it('should combine all formatting options', () => {
      const result = formatAutocompleteOption({
        name: 'Full Example',
        value: 'example-123',
        scopeBadge: AUTOCOMPLETE_BADGES.OWNED,
        statusBadges: [AUTOCOMPLETE_BADGES.DEFAULT],
        identifier: 'full-ex',
        metadata: 'extra-info',
      });

      expect(result.name).toBe('🔒⭐ Full Example (full-ex) · extra-info');
    });

    it('should handle owned (private) personality correctly', () => {
      const result = formatAutocompleteOption({
        name: 'My Private Bot',
        value: 'private-bot',
        scopeBadge: AUTOCOMPLETE_BADGES.OWNED,
        identifier: 'private-bot',
      });

      expect(result.name).toBe('🔒 My Private Bot (private-bot)');
    });

    it('should handle public personality correctly', () => {
      const result = formatAutocompleteOption({
        name: 'Shared Bot',
        value: 'shared-bot',
        scopeBadge: AUTOCOMPLETE_BADGES.PUBLIC,
        identifier: 'shared-bot',
      });

      expect(result.name).toBe('🌐 Shared Bot (shared-bot)');
    });

    it('should handle read-only personality correctly', () => {
      const result = formatAutocompleteOption({
        name: "Someone's Bot",
        value: 'others-bot',
        scopeBadge: AUTOCOMPLETE_BADGES.READ_ONLY,
        identifier: 'others-bot',
      });

      expect(result.name).toBe("📖 Someone's Bot (others-bot)");
    });

    it('should handle global preset with default and free flags', () => {
      const result = formatAutocompleteOption({
        name: 'Fast & Free',
        value: 'preset-123',
        scopeBadge: AUTOCOMPLETE_BADGES.GLOBAL,
        statusBadges: [AUTOCOMPLETE_BADGES.DEFAULT, AUTOCOMPLETE_BADGES.FREE],
        metadata: 'llama-3.3-70b',
      });

      expect(result.name).toBe('🌐⭐🆓 Fast & Free · llama-3.3-70b');
    });

    describe('truncation', () => {
      it('should truncate long names to Discord limit (100 chars)', () => {
        const longName = 'A'.repeat(120);
        const result = formatAutocompleteOption({
          name: longName,
          value: 'long-123',
        });

        expect(result.name.length).toBeLessThanOrEqual(100);
        expect(result.name).toContain('...');
      });

      it('should preserve suffix when truncating if possible', () => {
        // Need name long enough to trigger truncation: prefix (3) + name + suffix (8) > 100
        const longName = 'A'.repeat(95);
        const result = formatAutocompleteOption({
          name: longName,
          value: 'long-123',
          scopeBadge: AUTOCOMPLETE_BADGES.GLOBAL,
          metadata: 'model',
        });

        expect(result.name.length).toBeLessThanOrEqual(100);
        expect(result.name).toContain('...');
        expect(result.name).toContain('model'); // Metadata preserved
      });

      it('should respect custom maxLength', () => {
        const result = formatAutocompleteOption({
          name: 'This is a somewhat long name',
          value: 'test-123',
          maxLength: 20,
        });

        expect(result.name.length).toBeLessThanOrEqual(20);
      });

      it('should hard truncate when space is very limited', () => {
        const result = formatAutocompleteOption({
          name: 'A'.repeat(50),
          value: 'test-123',
          scopeBadge: AUTOCOMPLETE_BADGES.GLOBAL,
          statusBadges: [AUTOCOMPLETE_BADGES.DEFAULT, AUTOCOMPLETE_BADGES.FREE],
          metadata: 'very-long-metadata-that-takes-space',
          maxLength: 30,
        });

        expect(result.name.length).toBeLessThanOrEqual(30);
        expect(result.name).toContain('...');
      });
    });

    describe('edge cases', () => {
      it('should handle empty identifier gracefully', () => {
        const result = formatAutocompleteOption({
          name: 'Test',
          value: 'test-123',
          identifier: '',
        });

        expect(result.name).toBe('Test');
        expect(result.name).not.toContain('()');
      });

      it('should handle empty metadata gracefully', () => {
        const result = formatAutocompleteOption({
          name: 'Test',
          value: 'test-123',
          metadata: '',
        });

        expect(result.name).toBe('Test');
        expect(result.name).not.toContain('·');
      });

      it('should handle empty statusBadges array', () => {
        const result = formatAutocompleteOption({
          name: 'Test',
          value: 'test-123',
          scopeBadge: AUTOCOMPLETE_BADGES.GLOBAL,
          statusBadges: [],
        });

        expect(result.name).toBe('🌐 Test');
      });

      it('should preserve value unchanged', () => {
        const result = formatAutocompleteOption({
          name: 'Test',
          value: 'uuid-with-special-chars-123',
          scopeBadge: AUTOCOMPLETE_BADGES.GLOBAL,
        });

        expect(result.value).toBe('uuid-with-special-chars-123');
      });
    });
  });

  describe('formatAutocompleteOptions', () => {
    it('should format multiple options', () => {
      const configs: AutocompleteOptionConfig[] = [
        { name: 'Option 1', value: 'opt-1', scopeBadge: AUTOCOMPLETE_BADGES.GLOBAL },
        { name: 'Option 2', value: 'opt-2', scopeBadge: AUTOCOMPLETE_BADGES.OWNED },
      ];

      const results = formatAutocompleteOptions(configs);

      expect(results).toHaveLength(2);
      expect(results[0].name).toBe('🌐 Option 1');
      expect(results[1].name).toBe('🔒 Option 2');
    });

    it('should handle empty array', () => {
      const results = formatAutocompleteOptions([]);
      expect(results).toEqual([]);
    });
  });
});
