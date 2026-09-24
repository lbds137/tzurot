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
  PersonaCustomIds,
  getCommandFromCustomId,
} from './customIds.js';
import { buildDashboardCustomId } from './dashboard/types.js';

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

      it('should build viewEdit customId that parses back to the slug', () => {
        const customId = CharacterCustomIds.viewEdit('my-character');
        expect(customId).toBe('character::view-edit::my-character');
        expect(CharacterCustomIds.parse(customId)).toEqual({
          command: 'character',
          action: 'view-edit',
          characterId: 'my-character',
        });
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
    it('should round-trip character browse page', () => {
      const customId = CharacterCustomIds.listPage(5, 'date');
      const parsed = CharacterCustomIds.parse(customId);
      expect(parsed?.page).toBe(5);
      expect(parsed?.sort).toBe('date');
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
      expect(parsed).toEqual({ action: 'menu', entityId: 'persona-abc' });
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

    it('should round-trip preset menu', () => {
      const customId = PresetCustomIds.menu('preset-abc');
      const parsed = PresetCustomIds.parse(customId);
      expect(parsed?.action).toBe('menu');
      expect(parsed?.presetId).toBe('preset-abc');
    });

    it('should round-trip preset modal', () => {
      const customId = PresetCustomIds.modal('preset-abc', 'identity');
      const parsed = PresetCustomIds.parse(customId);
      expect(parsed?.action).toBe('modal');
      expect(parsed?.presetId).toBe('preset-abc');
      expect(parsed?.sectionId).toBe('identity');
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
      it('listPage', () =>
        assertValidCustomId(CharacterCustomIds.listPage(1, 'date'), 'character'));
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

      it('should derive modalSubmit from a parsed button customId', () => {
        const parsed = DestructiveCustomIds.parse(
          DestructiveCustomIds.confirmButton('voice', 'voice-clear', 'all')
        );
        if (parsed === null) {
          throw new Error('expected parse to succeed');
        }
        expect(DestructiveCustomIds.modalSubmitFromParsed(parsed)).toBe(
          'voice::destructive::modal_submit::voice-clear::all'
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

  describe('PersonaCustomIds', () => {
    const ID = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
    const PID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

    describe('builders — byte-identical to the pre-family templates', () => {
      it.each([
        ['menu', () => PersonaCustomIds.menu(ID), `persona::menu::${ID}`],
        ['modal', () => PersonaCustomIds.modal(ID, 'identity'), `persona::modal::${ID}::identity`],
        ['close', () => PersonaCustomIds.close(ID), `persona::close::${ID}`],
        ['refresh', () => PersonaCustomIds.refresh(ID), `persona::refresh::${ID}`],
        ['delete', () => PersonaCustomIds.delete(ID), `persona::delete::${ID}`],
        [
          'confirmDelete',
          () => PersonaCustomIds.confirmDelete(ID),
          `persona::confirm-delete::${ID}`,
        ],
        ['cancelDelete', () => PersonaCustomIds.cancelDelete(ID), `persona::cancel-delete::${ID}`],
        ['create', () => PersonaCustomIds.create(), 'persona::create'],
        ['expand', () => PersonaCustomIds.expand(ID, 'content'), `persona::expand::${ID}::content`],
        [
          'overrideCreate',
          () => PersonaCustomIds.overrideCreate(PID),
          `persona::override-create::${PID}`,
        ],
      ])('%s', (_name, build, expected) => {
        expect(build()).toBe(expected);
      });
    });

    describe('parse shapes', () => {
      it('parses menu', () => {
        expect(PersonaCustomIds.parse(`persona::menu::${ID}`)).toEqual({
          action: 'menu',
          entityId: ID,
        });
      });

      it('parses modal', () => {
        expect(PersonaCustomIds.parse(`persona::modal::${ID}::identity`)).toEqual({
          action: 'modal',
          entityId: ID,
          sectionId: 'identity',
        });
      });

      it('parses expand', () => {
        expect(PersonaCustomIds.parse(`persona::expand::${ID}::content`)).toEqual({
          action: 'expand',
          entityId: ID,
          field: 'content',
        });
      });

      it('parses override-create', () => {
        expect(PersonaCustomIds.parse(`persona::override-create::${PID}`)).toEqual({
          action: 'override-create',
          personalityId: PID,
        });
      });

      it('parses cancel_edit with a sectionId', () => {
        expect(PersonaCustomIds.parse(`persona::cancel_edit::${ID}::identity`)).toEqual({
          action: 'cancel_edit',
          entityId: ID,
          sectionId: 'identity',
        });
      });

      it('parses cancel_edit without a sectionId — no sectionId key', () => {
        const result = PersonaCustomIds.parse(`persona::cancel_edit::${ID}`);
        expect(result).toEqual({ action: 'cancel_edit', entityId: ID });
        expect(Object.hasOwn(result ?? {}, 'sectionId')).toBe(false);
      });
    });

    describe('rejects', () => {
      it.each([
        ['modal with too few segments', 'persona::modal::abc'],
        ['extra segments on menu', 'persona::menu::a::b'],
        ['unknown action', 'persona::fake_action::x'],
        ['wrong prefix', 'character::menu::x'],
        [
          'browse is not a persona-family action (live browse ids come from createBrowseCustomIdHelpers)',
          'persona::browse::info',
        ],
      ])('%s', (_label, customId) => {
        expect(PersonaCustomIds.parse(customId)).toBeNull();
      });
    });

    describe('cross-convention agreement with buildDashboardCustomId', () => {
      it.each(['menu', 'close', 'refresh', 'back', 'delete'] as const)(
        '%s: family and dashboard builder agree on segment order',
        action => {
          const customId = buildDashboardCustomId('persona', action, ID);
          expect(PersonaCustomIds.parse(customId)).toEqual({ action, entityId: ID });
        }
      );

      it.each(['modal', 'view_full', 'edit_truncated', 'open_editor', 'cancel_edit'] as const)(
        '%s: family and dashboard builder agree on segment order (with sectionId)',
        action => {
          const customId = buildDashboardCustomId('persona', action, ID, 'identity');
          expect(PersonaCustomIds.parse(customId)).toEqual({
            action,
            entityId: ID,
            sectionId: 'identity',
          });
        }
      );
    });

    describe('isPersona', () => {
      it('returns true for persona customIds', () => {
        expect(PersonaCustomIds.isPersona('persona::menu::abc')).toBe(true);
      });

      it('returns false for non-persona customIds', () => {
        expect(PersonaCustomIds.isPersona('character::menu::abc')).toBe(false);
      });
    });
  });
});
