import { describe, it, expect, vi } from 'vitest';
import type { AutocompleteInteraction } from 'discord.js';
import { runGuardedAutocomplete, CHARACTER_ID_AUTOCOMPLETE } from './guardedAutocomplete.js';

function makeInteraction(): AutocompleteInteraction & { respond: ReturnType<typeof vi.fn> } {
  return {
    options: {
      getFocused: vi.fn().mockReturnValue({ name: 'character', value: 'lil' }),
      getSubcommand: vi.fn().mockReturnValue('edit'),
    },
    user: { id: 'user-1' },
    guildId: 'guild-1',
    commandName: 'character',
    respond: vi.fn().mockResolvedValue(undefined),
  } as unknown as AutocompleteInteraction & { respond: ReturnType<typeof vi.fn> };
}

const mockError = vi.fn();
const logger = {
  error: mockError,
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
} as never;

describe('runGuardedAutocomplete', () => {
  it('runs the dispatch and stays silent on success (dispatch owns responding)', async () => {
    const interaction = makeInteraction();
    const dispatch = vi.fn().mockResolvedValue(undefined);

    await runGuardedAutocomplete(interaction, logger, dispatch);

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(interaction.respond).not.toHaveBeenCalled();
  });

  it('logs the standard field set and responds empty when the dispatch throws', async () => {
    const interaction = makeInteraction();
    const boom = new Error('gateway down');

    await runGuardedAutocomplete(interaction, logger, vi.fn().mockRejectedValue(boom));

    expect(interaction.respond).toHaveBeenCalledWith([]);
    expect(mockError).toHaveBeenCalledWith(
      expect.objectContaining({
        err: boom,
        option: 'character',
        query: 'lil',
        userId: 'user-1',
        guildId: 'guild-1',
        command: 'character',
        subcommand: 'edit',
      }),
      'Autocomplete error'
    );
  });
});

describe('CHARACTER_ID_AUTOCOMPLETE', () => {
  it('submits personality IDs (the shape override/config APIs expect)', () => {
    expect(CHARACTER_ID_AUTOCOMPLETE).toEqual({
      optionName: 'character',
      ownedOnly: false,
      showVisibility: true,
      valueField: 'id',
    });
  });
});
