/**
 * Tests for /chime-in (top-level character summon command surface)
 *
 * The turn logic itself is covered by services/character/characterTurn.test.ts;
 * this file pins the command wiring: definition shape, delegation, and the
 * autocomplete pool scope.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AutocompleteInteraction } from 'discord.js';
import type { SafeCommandContext } from '../../utils/commandContext/types.js';

vi.mock('../../services/character/characterTurn.js', () => ({
  handleChimeIn: vi.fn().mockResolvedValue(undefined),
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

import chimeInCommand from './index.js';
import { handleChimeIn } from '../../services/character/characterTurn.js';

describe('/chime-in command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHandlePersonalityAutocomplete.mockResolvedValue(true);
  });

  describe('command definition', () => {
    it('is named chime-in and defers ephemerally', () => {
      expect(chimeInCommand.data.name).toBe('chime-in');
      expect(chimeInCommand.deferralMode).toBe('ephemeral');
    });

    it('requires character; incognito stays optional', () => {
      const json = chimeInCommand.data.toJSON();
      const byName = new Map(json.options?.map(opt => [opt.name, opt]));
      expect(byName.get('character')?.required).toBe(true);
      expect(byName.get('incognito')?.required).not.toBe(true);
    });
  });

  describe('execute', () => {
    it('delegates to the character-turn engine', async () => {
      const context = { interaction: {} } as unknown as SafeCommandContext;
      await chimeInCommand.execute(context);
      expect(handleChimeIn).toHaveBeenCalledWith(context);
    });
  });

  describe('autocomplete', () => {
    it('offers the full accessible pool (not owner-scoped)', async () => {
      const interaction = {
        user: { id: 'user-123' },
        options: { getFocused: vi.fn().mockReturnValue({ name: 'character', value: '' }) },
        respond: vi.fn().mockResolvedValue(undefined),
        responded: false,
      } as unknown as AutocompleteInteraction;

      await chimeInCommand.autocomplete!(interaction);

      expect(mockHandlePersonalityAutocomplete).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ optionName: 'character', ownedOnly: false })
      );
    });
  });
});
