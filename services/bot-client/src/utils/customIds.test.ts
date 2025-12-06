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
  MeCustomIds,
  WalletCustomIds,
  PresetCustomIds,
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

      it('should build listPage customId with page number', () => {
        expect(CharacterCustomIds.listPage(0)).toBe('character::list::0');
        expect(CharacterCustomIds.listPage(5)).toBe('character::list::5');
      });

      it('should build listInfo customId', () => {
        expect(CharacterCustomIds.listInfo()).toBe('character::list::info');
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
    });

    describe('parse', () => {
      it('should return null for non-character customIds', () => {
        expect(CharacterCustomIds.parse('wallet::set::openrouter')).toBeNull();
        expect(CharacterCustomIds.parse('me::profile::create')).toBeNull();
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

      it('should parse list customId with page number', () => {
        const result = CharacterCustomIds.parse('character::list::3');
        expect(result).toEqual({
          command: 'character',
          action: 'list',
          page: 3,
        });
      });

      it('should parse list info customId (no page)', () => {
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
    });

    describe('isCharacter', () => {
      it('should return true for character customIds', () => {
        expect(CharacterCustomIds.isCharacter('character::seed')).toBe(true);
        expect(CharacterCustomIds.isCharacter('character::menu::abc')).toBe(true);
      });

      it('should return false for non-character customIds', () => {
        expect(CharacterCustomIds.isCharacter('wallet::set::openrouter')).toBe(false);
        expect(CharacterCustomIds.isCharacter('me::profile::create')).toBe(false);
      });
    });
  });

  describe('MeCustomIds', () => {
    describe('profile builders', () => {
      it('should build profile create customId', () => {
        expect(MeCustomIds.profile.create()).toBe('me::profile::create');
      });

      it('should build profile edit customId with personaId', () => {
        expect(MeCustomIds.profile.edit('persona-123')).toBe('me::profile::edit::persona-123');
      });

      it('should build profile editNew customId', () => {
        expect(MeCustomIds.profile.editNew()).toBe('me::profile::edit::new');
      });
    });

    describe('override builders', () => {
      it('should build override createForOverride customId', () => {
        expect(MeCustomIds.override.createForOverride('personality-456')).toBe(
          'me::override::create::personality-456'
        );
      });
    });

    describe('parse', () => {
      it('should return null for non-me customIds', () => {
        expect(MeCustomIds.parse('character::seed')).toBeNull();
        expect(MeCustomIds.parse('wallet::set::openrouter')).toBeNull();
      });

      it('should return null for malformed customIds', () => {
        expect(MeCustomIds.parse('')).toBeNull();
        expect(MeCustomIds.parse('me')).toBeNull();
        expect(MeCustomIds.parse('me::profile')).toBeNull();
      });

      it('should parse profile create customId', () => {
        const result = MeCustomIds.parse('me::profile::create');
        expect(result).toEqual({
          command: 'me',
          group: 'profile',
          action: 'create',
        });
      });

      it('should parse profile edit customId with entityId', () => {
        const result = MeCustomIds.parse('me::profile::edit::persona-123');
        expect(result).toEqual({
          command: 'me',
          group: 'profile',
          action: 'edit',
          entityId: 'persona-123',
        });
      });

      it('should parse override create customId with entityId', () => {
        const result = MeCustomIds.parse('me::override::create::personality-456');
        expect(result).toEqual({
          command: 'me',
          group: 'override',
          action: 'create',
          entityId: 'personality-456',
        });
      });
    });

    describe('isMe', () => {
      it('should return true for me customIds', () => {
        expect(MeCustomIds.isMe('me::profile::create')).toBe(true);
        expect(MeCustomIds.isMe('me::override::create::abc')).toBe(true);
      });

      it('should return false for non-me customIds', () => {
        expect(MeCustomIds.isMe('character::seed')).toBe(false);
        expect(MeCustomIds.isMe('wallet::set::openrouter')).toBe(false);
      });
    });
  });

  describe('WalletCustomIds', () => {
    describe('builders', () => {
      it('should build set customId with provider', () => {
        expect(WalletCustomIds.set('openrouter')).toBe('wallet::set::openrouter');
        expect(WalletCustomIds.set('gemini')).toBe('wallet::set::gemini');
      });
    });

    describe('parse', () => {
      it('should return null for non-wallet customIds', () => {
        expect(WalletCustomIds.parse('character::seed')).toBeNull();
        expect(WalletCustomIds.parse('me::profile::create')).toBeNull();
      });

      it('should return null for malformed customIds', () => {
        expect(WalletCustomIds.parse('')).toBeNull();
        expect(WalletCustomIds.parse('wallet')).toBeNull();
      });

      it('should parse set customId with provider', () => {
        const result = WalletCustomIds.parse('wallet::set::openrouter');
        expect(result).toEqual({
          command: 'wallet',
          action: 'set',
          provider: 'openrouter',
        });
      });

      it('should parse set customId without provider', () => {
        const result = WalletCustomIds.parse('wallet::set');
        expect(result).toEqual({
          command: 'wallet',
          action: 'set',
          provider: undefined,
        });
      });
    });

    describe('isWallet', () => {
      it('should return true for wallet customIds', () => {
        expect(WalletCustomIds.isWallet('wallet::set::openrouter')).toBe(true);
      });

      it('should return false for non-wallet customIds', () => {
        expect(WalletCustomIds.isWallet('character::seed')).toBe(false);
        expect(WalletCustomIds.isWallet('me::profile::create')).toBe(false);
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
        expect(getCommandFromCustomId('me::profile::create')).toBe('me');
        expect(getCommandFromCustomId('wallet::set::openrouter')).toBe('wallet');
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

    it('should round-trip me profile edit', () => {
      const customId = MeCustomIds.profile.edit('persona-abc');
      const parsed = MeCustomIds.parse(customId);
      expect(parsed?.group).toBe('profile');
      expect(parsed?.action).toBe('edit');
      expect(parsed?.entityId).toBe('persona-abc');
    });

    it('should round-trip wallet set', () => {
      const customId = WalletCustomIds.set('openrouter');
      const parsed = WalletCustomIds.parse(customId);
      expect(parsed?.action).toBe('set');
      expect(parsed?.provider).toBe('openrouter');
    });
  });
});
