/**
 * Tests for /voice command top-level dispatch.
 *
 * Validates the SlashCommandBuilder shape, subcommand-group routing,
 * autocomplete delegation, and customId-based button/modal routing.
 * Handler-level behavior is covered in the colocated tests for each
 * moved file under voice/tts/ and voice/voices/.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import voiceCommand from './index.js';

const { data, execute, autocomplete, handleButton, handleModal, handleSelectMenu } = voiceCommand;

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

vi.mock('./tts/browse.js', () => ({
  handleTtsBrowse: vi.fn(),
  handleTtsBrowseSelect: vi.fn(),
  handleTtsBrowseButton: vi.fn(),
  isTtsOverrideInteraction: vi.fn(() => false),
  TTS_OVERRIDE_PREFIX: 'voice-tts-override',
}));
vi.mock('./tts/set.js', () => ({ handleTtsSet: vi.fn() }));
vi.mock('./tts/clear.js', () => ({ handleTtsClear: vi.fn() }));
vi.mock('./tts/set-default.js', () => ({ handleTtsSetDefault: vi.fn() }));
vi.mock('./tts/clear-default.js', () => ({ handleTtsClearDefault: vi.fn() }));
vi.mock('./tts/autocomplete.js', () => ({ handleAutocomplete: vi.fn() }));

vi.mock('./voices/browse.js', () => ({
  handleBrowseVoices: vi.fn(),
  handleVoiceBrowsePagination: vi.fn(),
  isVoiceBrowseInteraction: vi.fn(),
}));
vi.mock('./voices/delete.js', () => ({
  handleDeleteVoice: vi.fn(),
  handleVoiceAutocomplete: vi.fn(),
}));
vi.mock('./voices/clear.js', () => ({
  handleClearVoices: vi.fn(),
  handleVoiceClearButton: vi.fn(),
  handleVoiceClearModal: vi.fn(),
  VOICE_CLEAR_OPERATION: 'voice-clear',
}));

import { handleTtsBrowse } from './tts/browse.js';
import { handleTtsSet } from './tts/set.js';
import { handleTtsClear } from './tts/clear.js';
import { handleTtsSetDefault } from './tts/set-default.js';
import { handleTtsClearDefault } from './tts/clear-default.js';
import { handleAutocomplete as handleTtsAutocomplete } from './tts/autocomplete.js';
import {
  handleBrowseVoices,
  handleVoiceBrowsePagination,
  isVoiceBrowseInteraction,
} from './voices/browse.js';
import { handleDeleteVoice, handleVoiceAutocomplete } from './voices/delete.js';
import {
  handleClearVoices,
  handleVoiceClearButton,
  handleVoiceClearModal,
} from './voices/clear.js';

describe('Voice Command', () => {
  const mockEditReply = vi.fn();

  function createMockContext(subcommand: string, subcommandGroup: string | null = null) {
    return {
      user: { id: '123456789' },
      getSubcommand: () => subcommand,
      getSubcommandGroup: () => subcommandGroup,
      editReply: mockEditReply,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('command data', () => {
    it('registers as /voice with the full top-level shape', () => {
      const json = data.toJSON();
      expect(json.name).toBe('voice');

      const groups = (json.options ?? []).map(opt => opt.name).sort();
      // top-level: 4 subcommand groups + 1 direct subcommand (`view`)
      // top-level: 3 subcommand groups (tts/stt/voices) + 1 direct subcommand (view)
      expect(groups).toEqual(['stt', 'tts', 'view', 'voices']);
    });

    it('exposes the symmetric tts subcommand naming', () => {
      const json = data.toJSON();
      const tts = (json.options ?? []).find(opt => opt.name === 'tts');
      expect(tts).toBeDefined();
      const ttsSubcommands = ((tts as { options?: { name: string }[] }).options ?? [])
        .map(s => s.name)
        .sort();
      expect(ttsSubcommands).toEqual(['browse', 'clear', 'clear-default', 'set', 'set-default']);
    });

    it('exposes the voices subcommand shape', () => {
      const json = data.toJSON();
      const voices = (json.options ?? []).find(opt => opt.name === 'voices');
      expect(voices).toBeDefined();
      const voicesSubcommands = ((voices as { options?: { name: string }[] }).options ?? [])
        .map(s => s.name)
        .sort();
      expect(voicesSubcommands).toEqual(['browse', 'clear', 'delete']);
    });
  });

  describe('execute', () => {
    it('routes /voice tts set to handleTtsSet', async () => {
      const ctx = createMockContext('set', 'tts');
      await execute(ctx as any);
      expect(handleTtsSet).toHaveBeenCalledOnce();
    });

    it('routes /voice tts clear to handleTtsClear', async () => {
      const ctx = createMockContext('clear', 'tts');
      await execute(ctx as any);
      expect(handleTtsClear).toHaveBeenCalledOnce();
    });

    it('routes /voice tts set-default to handleTtsSetDefault', async () => {
      const ctx = createMockContext('set-default', 'tts');
      await execute(ctx as any);
      expect(handleTtsSetDefault).toHaveBeenCalledOnce();
    });

    it('routes /voice tts clear-default to handleTtsClearDefault', async () => {
      const ctx = createMockContext('clear-default', 'tts');
      await execute(ctx as any);
      expect(handleTtsClearDefault).toHaveBeenCalledOnce();
    });

    it('routes /voice tts browse to handleTtsBrowse', async () => {
      const ctx = createMockContext('browse', 'tts');
      await execute(ctx as any);
      expect(handleTtsBrowse).toHaveBeenCalledOnce();
    });

    it('routes /voice voices browse to handleBrowseVoices', async () => {
      const ctx = createMockContext('browse', 'voices');
      await execute(ctx as any);
      expect(handleBrowseVoices).toHaveBeenCalledOnce();
    });

    it('routes /voice voices delete to handleDeleteVoice', async () => {
      const ctx = createMockContext('delete', 'voices');
      await execute(ctx as any);
      expect(handleDeleteVoice).toHaveBeenCalledOnce();
    });

    it('routes /voice voices clear to handleClearVoices', async () => {
      const ctx = createMockContext('clear', 'voices');
      await execute(ctx as any);
      expect(handleClearVoices).toHaveBeenCalledOnce();
    });

    it('replies with error on unknown subcommand group', async () => {
      const ctx = createMockContext('whatever', 'unknown-group');
      await execute(ctx as any);
      expect(mockEditReply).toHaveBeenCalledWith({ content: '❌ Unknown voice subcommand.' });
    });
  });

  describe('autocomplete', () => {
    function createMockAutocompleteInteraction(
      focusedName: string,
      subcommandGroup: string | null
    ) {
      return {
        options: {
          getFocused: () => ({ name: focusedName, value: '' }),
          getSubcommandGroup: () => subcommandGroup,
        },
        respond: vi.fn(),
      };
    }

    it('delegates tts autocomplete to handleTtsAutocomplete', async () => {
      const interaction = createMockAutocompleteInteraction('personality', 'tts');
      await autocomplete!(interaction as any);
      expect(handleTtsAutocomplete).toHaveBeenCalledOnce();
    });

    it('delegates voices voice-option autocomplete to handleVoiceAutocomplete', async () => {
      const interaction = createMockAutocompleteInteraction('voice', 'voices');
      await autocomplete!(interaction as any);
      expect(handleVoiceAutocomplete).toHaveBeenCalledOnce();
    });

    it('responds empty for unknown autocomplete shapes', async () => {
      const interaction = createMockAutocompleteInteraction('something-else', null);
      await autocomplete!(interaction as any);
      expect(interaction.respond).toHaveBeenCalledWith([]);
    });

    it('responds empty for voices group with non-voice focused option', async () => {
      // Refactor introduced an explicit fallthrough — previously this case
      // was handled by the shared `else` branch. Verify the inner branch
      // returns empty without delegating to handleVoiceAutocomplete.
      const interaction = createMockAutocompleteInteraction('something-else', 'voices');
      await autocomplete!(interaction as any);
      expect(interaction.respond).toHaveBeenCalledWith([]);
      expect(handleVoiceAutocomplete).not.toHaveBeenCalled();
    });
  });

  describe('handleButton', () => {
    it('routes voice-browse customIds to handleVoiceBrowsePagination', async () => {
      vi.mocked(isVoiceBrowseInteraction).mockReturnValue(true);
      const interaction = { customId: 'voice-voices::browse::all::1' };
      await handleButton!(interaction as any);
      expect(handleVoiceBrowsePagination).toHaveBeenCalledOnce();
    });

    it('routes destructive voice-clear customIds to handleVoiceClearButton', async () => {
      vi.mocked(isVoiceBrowseInteraction).mockReturnValue(false);
      const interaction = {
        customId: 'voice::destructive::confirm_button::voice-clear::all',
      };
      await handleButton!(interaction as any);
      expect(handleVoiceClearButton).toHaveBeenCalledOnce();
    });

    it('does not route destructive customIds for unrelated operations', async () => {
      vi.mocked(isVoiceBrowseInteraction).mockReturnValue(false);
      const interaction = {
        customId: 'voice::destructive::confirm_button::other-op::all',
      };
      await handleButton!(interaction as any);
      expect(handleVoiceClearButton).not.toHaveBeenCalled();
    });
  });

  describe('handleModal', () => {
    it('routes destructive voice-clear modal customIds to handleVoiceClearModal', async () => {
      const interaction = {
        customId: 'voice::destructive::modal_submit::voice-clear::all',
      };
      await handleModal!(interaction as any);
      expect(handleVoiceClearModal).toHaveBeenCalledOnce();
    });

    it('does not route non-destructive modal customIds', async () => {
      const interaction = { customId: 'settings::apikey::modal' };
      await handleModal!(interaction as any);
      expect(handleVoiceClearModal).not.toHaveBeenCalled();
    });
  });

  describe('handleSelectMenu', () => {
    it('is a no-op (no select menus registered in the voice command yet)', async () => {
      const interaction = { customId: 'something::select' };
      await expect(handleSelectMenu!(interaction as any)).resolves.toBeUndefined();
    });
  });
});
