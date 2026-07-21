/**
 * Tests for /chat (top-level character chat command surface)
 *
 * The turn logic itself is covered by services/character/characterTurn.test.ts;
 * this file pins the command wiring: definition shape, delegation, and the
 * autocomplete pool scope.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AutocompleteInteraction } from 'discord.js';
import type { SafeCommandContext } from '../../utils/commandContext/types.js';

vi.mock('../../services/character/characterTurn.js', () => ({
  handleChat: vi.fn().mockResolvedValue(undefined),
}));

const mockHandlePersonalityAutocomplete = vi.fn();
vi.mock('../../utils/autocomplete/index.js', () => ({
  handlePersonalityAutocomplete: (...args: unknown[]) => mockHandlePersonalityAutocomplete(...args),
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

import chatCommand from './index.js';
import { handleChat } from '../../services/character/characterTurn.js';

describe('/chat command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHandlePersonalityAutocomplete.mockResolvedValue(true);
  });

  describe('command definition', () => {
    it('is named chat and defers ephemerally', () => {
      expect(chatCommand.data.name).toBe('chat');
      expect(chatCommand.deferralMode).toBe('ephemeral');
    });

    it('requires both character and message options', () => {
      const json = chatCommand.data.toJSON();
      const byName = new Map(json.options?.map(opt => [opt.name, opt]));
      expect(byName.get('character')?.required).toBe(true);
      expect(byName.get('message')?.required).toBe(true);
    });
  });

  describe('execute', () => {
    it('delegates to the character-turn engine', async () => {
      const context = { interaction: {} } as unknown as SafeCommandContext;
      await chatCommand.execute(context);
      expect(handleChat).toHaveBeenCalledWith(context);
    });
  });

  describe('autocomplete', () => {
    function createMockInteraction(): AutocompleteInteraction {
      return {
        user: { id: 'user-123' },
        options: { getFocused: vi.fn().mockReturnValue({ name: 'character', value: '' }) },
        respond: vi.fn().mockResolvedValue(undefined),
        responded: false,
      } as unknown as AutocompleteInteraction;
    }

    it('offers the full accessible pool (not owner-scoped)', async () => {
      await chatCommand.autocomplete!(createMockInteraction());

      expect(mockHandlePersonalityAutocomplete).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ optionName: 'character', ownedOnly: false })
      );
    });

    it('responds empty when the focused option is not character', async () => {
      mockHandlePersonalityAutocomplete.mockResolvedValue(false);
      const interaction = createMockInteraction();

      await chatCommand.autocomplete!(interaction);

      expect(interaction.respond).toHaveBeenCalledWith([]);
    });
  });
});
