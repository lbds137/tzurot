/**
 * Tests for /channel autocomplete handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AutocompleteInteraction } from 'discord.js';
import { handleAutocomplete } from './autocomplete.js';

// Mock the shared personality autocomplete
vi.mock('../../utils/autocomplete/index.js', () => ({
  handlePersonalityAutocomplete: vi.fn(),
}));

// Mock logger
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
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

import { handlePersonalityAutocomplete } from '../../utils/autocomplete/index.js';

describe('/channel autocomplete', () => {
  const mockHandlePersonalityAutocomplete = vi.mocked(handlePersonalityAutocomplete);

  function createMockInteraction(subcommand: string = 'activate'): AutocompleteInteraction {
    return {
      options: {
        getSubcommand: vi.fn().mockReturnValue(subcommand),
      },
      user: { id: 'user-123' },
      guildId: '987654321098765432',
      commandName: 'channel',
      respond: vi.fn().mockResolvedValue(undefined),
    } as unknown as AutocompleteInteraction;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call handlePersonalityAutocomplete with correct options', async () => {
    const interaction = createMockInteraction();
    mockHandlePersonalityAutocomplete.mockResolvedValue(true);

    await handleAutocomplete(interaction);

    expect(mockHandlePersonalityAutocomplete).toHaveBeenCalledWith(interaction, {
      optionName: 'personality',
      ownedOnly: false,
      showVisibility: true,
    });
  });

  it('should respond with empty array if autocomplete not handled', async () => {
    const interaction = createMockInteraction();
    mockHandlePersonalityAutocomplete.mockResolvedValue(false);

    await handleAutocomplete(interaction);

    expect(interaction.respond).toHaveBeenCalledWith([]);
  });

  it('should not respond twice if autocomplete was handled', async () => {
    const interaction = createMockInteraction();
    mockHandlePersonalityAutocomplete.mockResolvedValue(true);

    await handleAutocomplete(interaction);

    expect(interaction.respond).not.toHaveBeenCalled();
  });

  it('should handle errors gracefully', async () => {
    const interaction = createMockInteraction();
    mockHandlePersonalityAutocomplete.mockRejectedValue(new Error('Network error'));

    await handleAutocomplete(interaction);

    expect(interaction.respond).toHaveBeenCalledWith([]);
  });

  it('should work for activate subcommand', async () => {
    const interaction = createMockInteraction('activate');
    mockHandlePersonalityAutocomplete.mockResolvedValue(true);

    await handleAutocomplete(interaction);

    expect(mockHandlePersonalityAutocomplete).toHaveBeenCalled();
  });
});
