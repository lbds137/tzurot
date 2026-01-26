/**
 * Unit tests for customIds.ts
 *
 * Tests the centralized customId builders and parsers.
 * Critical because customId parsing failures would break all Discord interactions.
 */

import { describe, it, expect } from 'vitest';
import {
  CUSTOM_ID_DELIMITER,
  CharacterCustomIds,
  ApikeyCustomIds,
  PresetCustomIds,
  DestructiveCustomIds,
  ChannelCustomIds,
  PersonaCustomIds,
  getCommandFromCustomId,
} from './customIds.js';

describe('customIds', () => {
  describe('CUSTOM_ID_DELIMITER', () => {
    it('should be :: to avoid conflicts with UUIDs containing hyphens', () => {
      expect(CUSTOM_ID_DELIMITER).toBe('::');
    });
  });

  describe('CharacterCustomIds', () => {
    describe('builders', () => {
      it('should build seed customId', () => {
        expect(CharacterCustomIds.seed()).toBe('character::seed');
      });

      it('should build menu customId with characterId', () => {
        expect(CharacterCustomIds.menu('abc123')).toBe('character::menu::abc123');
      });

      it('should build menu customId with UUID containing hyphens', () => {
        const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
        expect(CharacterCustomIds.menu(uuid)).toBe(`character::menu::${uuid}`);
      });

      it('should build modal customId with characterId and sectionId', () => {
        expect(CharacterCustomIds.modal('char-123', 'identity')).toBe(
          'character::modal::char-123::identity'
        );
      });

      it('should build close customId', () => {
        expect(CharacterCustomIds.close('abc123')).toBe('character::close::abc123');
      });

      it('should build refresh customId', () => {
        expect(CharacterCustomIds.refresh('abc123')).toBe('character::refresh::abc123');
      });

      it('should build listPage customId with page number and sort', () => {
        expect(CharacterCustomIds.listPage(0, 'date')).toBe('character::list::0::date');
        expect(CharacterCustomIds.listPage(5, 'name')).toBe('character::list::5::name');
      });

      it('should build listInfo customId', () => {
        expect(CharacterCustomIds.listInfo()).toBe('character::list::info');
      });

      it('should build sortToggle customId with page and sort', () => {
        expect(CharacterCustomIds.sortToggle(0, 'name')).toBe('character::sort::0::name');
        expect(CharacterCustomIds.sortToggle(2, 'date')).toBe('character::sort::2::date');
      });

      it('should build viewPage customId with slug and page', () => {
        expect(CharacterCustomIds.viewPage('my-character', 2)).toBe(
          'character::view::my-character::2'
        );
      });

      it('should build viewInfo customId with slug', () => {
        expect(CharacterCustomIds.viewInfo('my-character')).toBe(
          'character::view::my-character::info'
        );
      });

      it('should build expand customId with slug and fieldName', () => {
        expect(CharacterCustomIds.expand('my-character', 'characterInfo')).toBe(
          'character::expand::my-character::characterInfo'
        );
      });

      it('should build deleteConfirm customId with slug', () => {
        expect(CharacterCustomIds.deleteConfirm('my-character')).toBe(
          'character::delete_confirm::my-character'
        );
      });

      it('should build deleteCancel customId with slug', () => {
        expect(CharacterCustomIds.deleteCancel('my-character')).toBe(
          'character::delete_cancel::my-character'
        );
      });
    });

    describe('parse', () => {
      it('should return null for non-character customIds', () => {
        expect(CharacterCustomIds.parse('settings::apikey::set::openrouter')).toBeNull();
        expect(CharacterCustomIds.parse('persona::create')).toBeNull();
      });

      it('should return null for malformed customIds', () => {
        expect(CharacterCustomIds.parse('')).toBeNull();
        expect(CharacterCustomIds.parse('character')).toBeNull();
      });

      it('should parse seed customId', () => {
        const result = CharacterCustomIds.parse('character::seed');
        expect(result).toEqual({
          command: 'character',
          action: 'seed',
        });
      });

      it('should parse menu customId', () => {
        const result = CharacterCustomIds.parse('character::menu::abc123');
        expect(result).toEqual({
          command: 'character',
          action: 'menu',
          characterId: 'abc123',
        });
      });

      it('should parse menu customId with UUID containing hyphens', () => {
        const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
        const result = CharacterCustomIds.parse(`character::menu::${uuid}`);
        expect(result).toEqual({
          command: 'character',
          action: 'menu',
          characterId: uuid,
        });
      });

      it('should parse modal customId with sectionId', () => {
        const result = CharacterCustomIds.parse('character::modal::char-123::identity');
        expect(result).toEqual({
          command: 'character',
          action: 'modal',
          characterId: 'char-123',
          sectionId: 'identity',
        });
      });

      it('should parse list customId with page number and sort', () => {
        const result = CharacterCustomIds.parse('character::list::3::date');
        expect(result).toEqual({
          command: 'character',
          action: 'list',
          page: 3,
          sort: 'date',
        });
      });

      it('should parse list customId with name sort', () => {
        const result = CharacterCustomIds.parse('character::list::5::name');
        expect(result).toEqual({
          command: 'character',
          action: 'list',
          page: 5,
          sort: 'name',
        });
      });

      it('should parse sort toggle customId', () => {
        const result = CharacterCustomIds.parse('character::sort::0::name');
        expect(result).toEqual({
          command: 'character',
          action: 'sort',
          page: 0,
          sort: 'name',
        });
      });

      it('should parse list info customId (no page or sort)', () => {
        const result = CharacterCustomIds.parse('character::list::info');
        expect(result).toEqual({
          command: 'character',
          action: 'list',
        });
      });

      it('should handle NaN page numbers gracefully', () => {
        const result = CharacterCustomIds.parse('character::list::abc');
        expect(result).toEqual({
          command: 'character',
          action: 'list',
          // page should be undefined, not NaN
        });
        expect(result?.page).toBeUndefined();
      });

      it('should parse view customId with slug and page', () => {
        const result = CharacterCustomIds.parse('character::view::my-char::2');
        expect(result).toEqual({
          command: 'character',
          action: 'view',
          characterId: 'my-char',
          viewPage: 2,
        });
      });

      it('should parse view info customId (no page)', () => {
        const result = CharacterCustomIds.parse('character::view::my-char::info');
        expect(result).toEqual({
          command: 'character',
          action: 'view',
          characterId: 'my-char',
        });
      });

      it('should handle NaN viewPage numbers gracefully', () => {
        const result = CharacterCustomIds.parse('character::view::my-char::abc');
        expect(result).toEqual({
          command: 'character',
          action: 'view',
          characterId: 'my-char',
        });
        expect(result?.viewPage).toBeUndefined();
      });

      it('should parse expand customId with slug and fieldName', () => {
        const result = CharacterCustomIds.parse('character::expand::my-char::characterInfo');
        expect(result).toEqual({
          command: 'character',
          action: 'expand',
          characterId: 'my-char',
          fieldName: 'characterInfo',
        });
      });

      it('should parse close customId', () => {
        const result = CharacterCustomIds.parse('character::close::abc123');
        expect(result).toEqual({
          command: 'character',
          action: 'close',
          characterId: 'abc123',
        });
      });

      it('should parse refresh customId', () => {
        const result = CharacterCustomIds.parse('character::refresh::abc123');
        expect(result).toEqual({
          command: 'character',
          action: 'refresh',
          characterId: 'abc123',
        });
      });

      it('should parse delete_confirm customId', () => {
        const result = CharacterCustomIds.parse('character::delete_confirm::my-char');
        expect(result).toEqual({
          command: 'character',
          action: 'delete_confirm',
          characterId: 'my-char',
        });
      });

      it('should parse delete_cancel customId', () => {
        const result = CharacterCustomIds.parse('character::delete_cancel::my-char');
        expect(result).toEqual({
          command: 'character',
          action: 'delete_cancel',
          characterId: 'my-char',
        });
      });
    });

    describe('isCharacter', () => {
      it('should return true for character customIds', () => {
        expect(CharacterCustomIds.isCharacter('character::seed')).toBe(true);
        expect(CharacterCustomIds.isCharacter('character::menu::abc')).toBe(true);
      });

      it('should return false for non-character customIds', () => {
        expect(CharacterCustomIds.isCharacter('settings::apikey::set::openrouter')).toBe(false);
        expect(CharacterCustomIds.isCharacter('persona::create')).toBe(false);
      });
    });
  });

  describe('ApikeyCustomIds', () => {
    describe('builders', () => {
      it('should build set customId with provider', () => {
        expect(ApikeyCustomIds.set('openrouter')).toBe('settings::apikey::set::openrouter');
        expect(ApikeyCustomIds.set('gemini')).toBe('settings::apikey::set::gemini');
      });
    });

    describe('parse', () => {
      it('should return null for non-apikey customIds', () => {
        expect(ApikeyCustomIds.parse('character::seed')).toBeNull();
        expect(ApikeyCustomIds.parse('persona::create')).toBeNull();
      });

      it('should return null for malformed customIds', () => {
        expect(ApikeyCustomIds.parse('')).toBeNull();
        expect(ApikeyCustomIds.parse('settings')).toBeNull();
        expect(ApikeyCustomIds.parse('settings::apikey')).toBeNull();
      });

      it('should parse set customId with provider', () => {
        const result = ApikeyCustomIds.parse('settings::apikey::set::openrouter');
        expect(result).toEqual({
          command: 'settings',
          subcommandGroup: 'apikey',
          action: 'set',
          provider: 'openrouter',
        });
      });

      it('should parse set customId without provider', () => {
        const result = ApikeyCustomIds.parse('settings::apikey::set');
        expect(result).toEqual({
          command: 'settings',
          subcommandGroup: 'apikey',
          action: 'set',
          provider: undefined,
        });
      });
    });

    describe('isApikey', () => {
      it('should return true for apikey customIds', () => {
        expect(ApikeyCustomIds.isApikey('settings::apikey::set::openrouter')).toBe(true);
      });

      it('should return false for non-apikey customIds', () => {
        expect(ApikeyCustomIds.isApikey('character::seed')).toBe(false);
        expect(ApikeyCustomIds.isApikey('persona::create')).toBe(false);
        expect(ApikeyCustomIds.isApikey('settings::timezone::set')).toBe(false);
      });
    });
  });

  describe('PresetCustomIds', () => {
    describe('builders', () => {
      it('should build menu customId with presetId', () => {
        expect(PresetCustomIds.menu('preset-123')).toBe('preset::menu::preset-123');
      });

      it('should build modal customId with presetId and sectionId', () => {
        expect(PresetCustomIds.modal('preset-123', 'settings')).toBe(
          'preset::modal::preset-123::settings'
        );
      });
    });

    describe('parse', () => {
      it('should return null for non-preset customIds', () => {
        expect(PresetCustomIds.parse('character::seed')).toBeNull();
      });

      it('should parse menu customId', () => {
        const result = PresetCustomIds.parse('preset::menu::preset-123');
        expect(result).toEqual({
          command: 'preset',
          action: 'menu',
          presetId: 'preset-123',
        });
      });

      it('should parse modal customId with sectionId', () => {
        const result = PresetCustomIds.parse('preset::modal::preset-123::settings');
        expect(result).toEqual({
          command: 'preset',
          action: 'modal',
          presetId: 'preset-123',
          sectionId: 'settings',
        });
      });
    });

    describe('isPreset', () => {
      it('should return true for preset customIds', () => {
        expect(PresetCustomIds.isPreset('preset::menu::abc')).toBe(true);
      });

      it('should return false for non-preset customIds', () => {
        expect(PresetCustomIds.isPreset('character::seed')).toBe(false);
      });
    });
  });

  describe('utility functions', () => {
    describe('getCommandFromCustomId', () => {
      it('should extract command from :: format', () => {
        expect(getCommandFromCustomId('character::seed')).toBe('character');
        expect(getCommandFromCustomId('persona::create')).toBe('persona');
        expect(getCommandFromCustomId('settings::apikey::set::openrouter')).toBe('settings');
      });

      it('should return null for invalid format without :: delimiter', () => {
        expect(getCommandFromCustomId('character-list-5')).toBeNull();
        expect(getCommandFromCustomId('character')).toBeNull();
        expect(getCommandFromCustomId('singleword')).toBeNull();
      });
    });
  });

  describe('round-trip tests (build then parse)', () => {
    it('should round-trip character list page', () => {
      const customId = CharacterCustomIds.listPage(5);
      const parsed = CharacterCustomIds.parse(customId);
      expect(parsed?.page).toBe(5);
    });

    it('should round-trip character view page', () => {
      const customId = CharacterCustomIds.viewPage('my-slug', 3);
      const parsed = CharacterCustomIds.parse(customId);
      expect(parsed?.characterId).toBe('my-slug');
      expect(parsed?.viewPage).toBe(3);
    });

    it('should round-trip character expand', () => {
      const customId = CharacterCustomIds.expand('my-slug', 'personalityTraits');
      const parsed = CharacterCustomIds.parse(customId);
      expect(parsed?.characterId).toBe('my-slug');
      expect(parsed?.fieldName).toBe('personalityTraits');
    });

    it('should round-trip persona menu', () => {
      const customId = PersonaCustomIds.menu('persona-abc');
      const parsed = PersonaCustomIds.parse(customId);
      expect(parsed?.action).toBe('menu');
      expect(parsed?.personaId).toBe('persona-abc');
    });

    it('should round-trip apikey set', () => {
      const customId = ApikeyCustomIds.set('openrouter');
      const parsed = ApikeyCustomIds.parse(customId);
      expect(parsed?.action).toBe('set');
      expect(parsed?.provider).toBe('openrouter');
    });

    it('should round-trip character delete confirm', () => {
      const customId = CharacterCustomIds.deleteConfirm('my-char');
      const parsed = CharacterCustomIds.parse(customId);
      expect(parsed?.action).toBe('delete_confirm');
      expect(parsed?.characterId).toBe('my-char');
    });

    it('should round-trip character delete cancel', () => {
      const customId = CharacterCustomIds.deleteCancel('my-char');
      const parsed = CharacterCustomIds.parse(customId);
      expect(parsed?.action).toBe('delete_cancel');
      expect(parsed?.characterId).toBe('my-char');
    });
  });

  /**
   * ENFORCEMENT TEST: Ensures ALL customId builders use the :: delimiter
   *
   * This test prevents future bugs where a developer might accidentally use
   * underscores, hyphens, or other delimiters that would break the routing.
   *
   * If this test fails, it means a new builder was added that doesn't follow
   * the established pattern and would cause "Unknown command" errors in production.
   */
  describe('delimiter enforcement (CRITICAL - prevents routing bugs)', () => {
    // Helper to test that a customId:
    // 1. Contains the :: delimiter
    // 2. Can be routed by getCommandFromCustomId
    function assertValidCustomId(customId: string, expectedCommand: string): void {
      expect(customId).toContain('::');
      expect(getCommandFromCustomId(customId)).toBe(expectedCommand);
    }

    describe('CharacterCustomIds - all builders must use :: delimiter', () => {
      it('seed', () => assertValidCustomId(CharacterCustomIds.seed(), 'character'));
      it('menu', () => assertValidCustomId(CharacterCustomIds.menu('test'), 'character'));
      it('modal', () =>
        assertValidCustomId(CharacterCustomIds.modal('test', 'section'), 'character'));
      it('close', () => assertValidCustomId(CharacterCustomIds.close('test'), 'character'));
      it('refresh', () => assertValidCustomId(CharacterCustomIds.refresh('test'), 'character'));
      it('listPage', () => assertValidCustomId(CharacterCustomIds.listPage(1), 'character'));
      it('listInfo', () => assertValidCustomId(CharacterCustomIds.listInfo(), 'character'));
      it('viewPage', () =>
        assertValidCustomId(CharacterCustomIds.viewPage('test', 1), 'character'));
      it('viewInfo', () => assertValidCustomId(CharacterCustomIds.viewInfo('test'), 'character'));
      it('expand', () =>
        assertValidCustomId(CharacterCustomIds.expand('test', 'field'), 'character'));
      it('deleteConfirm', () =>
        assertValidCustomId(CharacterCustomIds.deleteConfirm('test'), 'character'));
      it('deleteCancel', () =>
        assertValidCustomId(CharacterCustomIds.deleteCancel('test'), 'character'));
    });

    describe('PersonaCustomIds - all builders must use :: delimiter', () => {
      it('menu', () => assertValidCustomId(PersonaCustomIds.menu('test'), 'persona'));
      it('modal', () => assertValidCustomId(PersonaCustomIds.modal('test', 'section'), 'persona'));
      it('close', () => assertValidCustomId(PersonaCustomIds.close('test'), 'persona'));
      it('refresh', () => assertValidCustomId(PersonaCustomIds.refresh('test'), 'persona'));
      it('delete', () => assertValidCustomId(PersonaCustomIds.delete('test'), 'persona'));
      it('create', () => assertValidCustomId(PersonaCustomIds.create(), 'persona'));
      it('expand', () => assertValidCustomId(PersonaCustomIds.expand('test', 'field'), 'persona'));
      it('overrideCreate', () =>
        assertValidCustomId(PersonaCustomIds.overrideCreate('test'), 'persona'));
      it('browsePage', () =>
        assertValidCustomId(PersonaCustomIds.browsePage(1, 'date'), 'persona'));
    });

    describe('ApikeyCustomIds - all builders must use :: delimiter', () => {
      it('set', () => assertValidCustomId(ApikeyCustomIds.set('openrouter'), 'settings'));
    });

    describe('PresetCustomIds - all builders must use :: delimiter', () => {
      it('menu', () => assertValidCustomId(PresetCustomIds.menu('test'), 'preset'));
      it('modal', () => assertValidCustomId(PresetCustomIds.modal('test', 'section'), 'preset'));
    });

    describe('DestructiveCustomIds - all builders must use :: delimiter', () => {
      it('confirmButton with entityId', () => {
        const customId = DestructiveCustomIds.confirmButton('history', 'hard-delete', 'entity-123');
        expect(customId).toContain('::');
        expect(customId.startsWith('history::')).toBe(true);
      });
      it('confirmButton without entityId', () => {
        const customId = DestructiveCustomIds.confirmButton('history', 'hard-delete');
        expect(customId).toContain('::');
        expect(customId.startsWith('history::')).toBe(true);
      });
      it('cancelButton', () => {
        const customId = DestructiveCustomIds.cancelButton('history', 'hard-delete', 'entity-123');
        expect(customId).toContain('::');
        expect(customId.startsWith('history::')).toBe(true);
      });
      it('modalSubmit', () => {
        const customId = DestructiveCustomIds.modalSubmit('history', 'hard-delete', 'entity-123');
        expect(customId).toContain('::');
        expect(customId.startsWith('history::')).toBe(true);
      });
    });
  });

  describe('DestructiveCustomIds', () => {
    describe('builders', () => {
      it('should build confirmButton with entityId', () => {
        expect(
          DestructiveCustomIds.confirmButton('history', 'hard-delete', 'lilith_channel-123')
        ).toBe('history::destructive::confirm_button::hard-delete::lilith_channel-123');
      });

      it('should build confirmButton without entityId', () => {
        expect(DestructiveCustomIds.confirmButton('history', 'hard-delete')).toBe(
          'history::destructive::confirm_button::hard-delete'
        );
      });

      it('should build cancelButton with entityId', () => {
        expect(
          DestructiveCustomIds.cancelButton('history', 'hard-delete', 'lilith_channel-123')
        ).toBe('history::destructive::cancel_button::hard-delete::lilith_channel-123');
      });

      it('should build cancelButton without entityId', () => {
        expect(DestructiveCustomIds.cancelButton('history', 'hard-delete')).toBe(
          'history::destructive::cancel_button::hard-delete'
        );
      });

      it('should build modalSubmit with entityId', () => {
        expect(
          DestructiveCustomIds.modalSubmit('history', 'hard-delete', 'lilith_channel-123')
        ).toBe('history::destructive::modal_submit::hard-delete::lilith_channel-123');
      });

      it('should build modalSubmit without entityId', () => {
        expect(DestructiveCustomIds.modalSubmit('history', 'hard-delete')).toBe(
          'history::destructive::modal_submit::hard-delete'
        );
      });
    });

    describe('parse', () => {
      it('should parse confirm_button action with entityId', () => {
        const result = DestructiveCustomIds.parse(
          'history::destructive::confirm_button::hard-delete::lilith_channel-123'
        );
        expect(result).toEqual({
          source: 'history',
          action: 'confirm_button',
          operation: 'hard-delete',
          entityId: 'lilith_channel-123',
        });
      });

      it('should parse cancel_button action', () => {
        const result = DestructiveCustomIds.parse(
          'history::destructive::cancel_button::hard-delete::entity-123'
        );
        expect(result).toEqual({
          source: 'history',
          action: 'cancel_button',
          operation: 'hard-delete',
          entityId: 'entity-123',
        });
      });

      it('should parse modal_submit action', () => {
        const result = DestructiveCustomIds.parse(
          'history::destructive::modal_submit::hard-delete::entity-123'
        );
        expect(result).toEqual({
          source: 'history',
          action: 'modal_submit',
          operation: 'hard-delete',
          entityId: 'entity-123',
        });
      });

      it('should parse without entityId', () => {
        const result = DestructiveCustomIds.parse(
          'history::destructive::confirm_button::hard-delete'
        );
        expect(result).toEqual({
          source: 'history',
          action: 'confirm_button',
          operation: 'hard-delete',
          entityId: undefined,
        });
      });

      it('should return null for non-destructive customId', () => {
        expect(DestructiveCustomIds.parse('character::seed')).toBeNull();
      });

      it('should return null for malformed destructive customId (too short)', () => {
        expect(DestructiveCustomIds.parse('history::destructive::confirm')).toBeNull();
      });
    });

    describe('isDestructive', () => {
      it('should return true for destructive customIds', () => {
        expect(
          DestructiveCustomIds.isDestructive(
            'history::destructive::confirm_button::hard-delete::entity'
          )
        ).toBe(true);
      });

      it('should return true regardless of source command', () => {
        expect(
          DestructiveCustomIds.isDestructive('character::destructive::confirm_button::delete')
        ).toBe(true);
      });

      it('should return false for non-destructive customIds', () => {
        expect(DestructiveCustomIds.isDestructive('character::seed')).toBe(false);
        expect(DestructiveCustomIds.isDestructive('persona::create')).toBe(false);
      });
    });
  });

  describe('ChannelCustomIds', () => {
    describe('builders', () => {
      it('should build listPage customId with page and sort', () => {
        expect(ChannelCustomIds.listPage(0, 'date')).toBe('channel::list::0::date');
        expect(ChannelCustomIds.listPage(3, 'name')).toBe('channel::list::3::name');
      });

      it('should build listInfo customId', () => {
        expect(ChannelCustomIds.listInfo()).toBe('channel::list::info');
      });

      it('should build sortToggle customId', () => {
        expect(ChannelCustomIds.sortToggle(2, 'name')).toBe('channel::sort::2::name');
        expect(ChannelCustomIds.sortToggle(0, 'date')).toBe('channel::sort::0::date');
      });
    });

    describe('parse', () => {
      it('should return null for non-channel customIds', () => {
        expect(ChannelCustomIds.parse('character::seed')).toBeNull();
        expect(ChannelCustomIds.parse('me::profile::create')).toBeNull();
      });

      it('should return null for malformed customIds (too short)', () => {
        expect(ChannelCustomIds.parse('channel')).toBeNull();
      });

      it('should parse list customId with page and sort', () => {
        const result = ChannelCustomIds.parse('channel::list::2::date');
        expect(result).toEqual({
          command: 'channel',
          action: 'list',
          page: 2,
          sort: 'date',
        });
      });

      it('should parse list customId with name sort', () => {
        const result = ChannelCustomIds.parse('channel::list::5::name');
        expect(result).toEqual({
          command: 'channel',
          action: 'list',
          page: 5,
          sort: 'name',
        });
      });

      it('should parse sort toggle customId', () => {
        const result = ChannelCustomIds.parse('channel::sort::1::name');
        expect(result).toEqual({
          command: 'channel',
          action: 'sort',
          page: 1,
          sort: 'name',
        });
      });

      it('should parse list info customId (no page/sort)', () => {
        const result = ChannelCustomIds.parse('channel::list::info');
        expect(result).toEqual({
          command: 'channel',
          action: 'list',
        });
      });

      it('should handle action without page/sort params', () => {
        const result = ChannelCustomIds.parse('channel::activate');
        expect(result).toEqual({
          command: 'channel',
          action: 'activate',
        });
      });
    });

    describe('isChannel', () => {
      it('should return true for channel customIds', () => {
        expect(ChannelCustomIds.isChannel('channel::list::0::date')).toBe(true);
        expect(ChannelCustomIds.isChannel('channel::sort::1::name')).toBe(true);
      });

      it('should return false for non-channel customIds', () => {
        expect(ChannelCustomIds.isChannel('character::seed')).toBe(false);
        expect(ChannelCustomIds.isChannel('persona::create')).toBe(false);
      });
    });
  });

  describe('ChannelCustomIds round-trip', () => {
    it('should round-trip list page', () => {
      const customId = ChannelCustomIds.listPage(3, 'date');
      const parsed = ChannelCustomIds.parse(customId);
      expect(parsed?.page).toBe(3);
      expect(parsed?.sort).toBe('date');
    });

    it('should round-trip sort toggle', () => {
      const customId = ChannelCustomIds.sortToggle(2, 'name');
      const parsed = ChannelCustomIds.parse(customId);
      expect(parsed?.action).toBe('sort');
      expect(parsed?.page).toBe(2);
      expect(parsed?.sort).toBe('name');
    });
  });

  describe('ChannelCustomIds delimiter enforcement', () => {
    it('listPage', () => {
      const customId = ChannelCustomIds.listPage(1, 'date');
      expect(customId).toContain('::');
      expect(getCommandFromCustomId(customId)).toBe('channel');
    });

    it('listInfo', () => {
      const customId = ChannelCustomIds.listInfo();
      expect(customId).toContain('::');
      expect(getCommandFromCustomId(customId)).toBe('channel');
    });

    it('sortToggle', () => {
      const customId = ChannelCustomIds.sortToggle(0, 'name');
      expect(customId).toContain('::');
      expect(getCommandFromCustomId(customId)).toBe('channel');
    });
  });
});
