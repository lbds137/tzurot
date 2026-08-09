/**
 * Tests for /random (top-level random-character chat command surface)
 *
 * The turn logic itself is covered by services/character/characterTurn.test.ts;
 * this file pins the command wiring: definition shape and delegation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AutocompleteInteraction } from 'discord.js';
import type { SafeCommandContext } from '../../utils/commandContext/types.js';

vi.mock('../../services/character/characterTurn.js', () => ({
  handleRandom: vi.fn().mockResolvedValue(undefined),
}));

const mockHandleTagAutocomplete = vi.fn();
vi.mock('../../utils/autocomplete/index.js', () => ({
  handleTagAutocomplete: (...args: unknown[]) => mockHandleTagAutocomplete(...args),
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

import randomCommand from './index.js';
import { handleRandom } from '../../services/character/characterTurn.js';

describe('/random command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHandleTagAutocomplete.mockResolvedValue(true);
  });

  describe('command definition', () => {
    it('is named random and defers ephemerally', () => {
      expect(randomCommand.data.name).toBe('random');
      expect(randomCommand.deferralMode).toBe('ephemeral');
    });

    it('has every option optional (bare /random reads the room)', () => {
      const json = randomCommand.data.toJSON();
      const names = json.options?.map(opt => opt.name).sort();
      expect(names).toEqual(['exclude-private', 'incognito', 'message', 'only-mine', 'tag']);
      expect(json.options?.every(opt => opt.required !== true)).toBe(true);
    });

    it('offers autocomplete on the tag option', () => {
      const json = randomCommand.data.toJSON();
      const tagOption = json.options?.find(opt => opt.name === 'tag');
      expect(tagOption).toMatchObject({ autocomplete: true });
    });
  });

  describe('autocomplete', () => {
    it('routes the tag option to the tag-vocabulary handler', async () => {
      const interaction = {
        user: { id: 'user-123' },
        options: { getFocused: vi.fn().mockReturnValue({ name: 'tag', value: '' }) },
        respond: vi.fn().mockResolvedValue(undefined),
        responded: false,
      } as unknown as AutocompleteInteraction;

      await randomCommand.autocomplete!(interaction);

      expect(mockHandleTagAutocomplete).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ optionName: 'tag' })
      );
    });

    it('responds with an empty list when no handler claims the option', async () => {
      mockHandleTagAutocomplete.mockResolvedValue(false);
      const respond = vi.fn().mockResolvedValue(undefined);
      const interaction = {
        user: { id: 'user-123' },
        options: { getFocused: vi.fn().mockReturnValue({ name: 'message', value: '' }) },
        respond,
        responded: false,
      } as unknown as AutocompleteInteraction;

      await randomCommand.autocomplete!(interaction);

      expect(respond).toHaveBeenCalledWith([]);
    });
  });

  describe('execute', () => {
    it('delegates to the character-turn engine', async () => {
      const context = { interaction: {} } as unknown as SafeCommandContext;
      await randomCommand.execute(context);
      expect(handleRandom).toHaveBeenCalledWith(context);
    });
  });
});
