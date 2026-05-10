/**
 * Tests for /voice stt autocomplete handler.
 * STT subcommands only autocomplete the `personality` option (provider is
 * static choices). Anything else short-circuits to an empty response.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockHandlePersonalityAutocomplete } = vi.hoisted(() => ({
  mockHandlePersonalityAutocomplete: vi.fn(),
}));

vi.mock('../../../utils/autocomplete/index.js', () => ({
  handlePersonalityAutocomplete: mockHandlePersonalityAutocomplete,
}));

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

const { handleAutocomplete } = await import('./autocomplete.js');

function makeInteraction(focusedName: string) {
  return {
    options: { getFocused: vi.fn(() => ({ name: focusedName, value: '' })) },
    user: { id: 'discord-user-1' },
    responded: false,
    respond: vi.fn(),
  };
}

describe('STT autocomplete handler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('routes the personality option through handlePersonalityAutocomplete', async () => {
    const interaction = makeInteraction('personality');

    await handleAutocomplete(interaction as never);

    expect(mockHandlePersonalityAutocomplete).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({ optionName: 'personality' })
    );
  });

  it('responds with [] for unknown options', async () => {
    const interaction = makeInteraction('something-else');

    await handleAutocomplete(interaction as never);

    expect(mockHandlePersonalityAutocomplete).not.toHaveBeenCalled();
    expect(interaction.respond).toHaveBeenCalledWith([]);
  });

  it('responds with [] when handlePersonalityAutocomplete throws and not responded', async () => {
    mockHandlePersonalityAutocomplete.mockRejectedValueOnce(new Error('boom'));
    const interaction = makeInteraction('personality');

    await handleAutocomplete(interaction as never);

    expect(interaction.respond).toHaveBeenCalledWith([]);
  });
});
