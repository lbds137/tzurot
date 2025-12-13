/**
 * Tests for Me Command Autocomplete Handler
 * Tests both personality and persona autocomplete wrappers that use shared utilities.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleMePersonalityAutocomplete, handlePersonaAutocomplete } from './autocomplete.js';

// Mock the shared autocomplete utilities
const mockHandlePersonalityAutocomplete = vi.fn();
const mockHandlePersonaAutocomplete = vi.fn();
vi.mock('../../utils/autocomplete/index.js', () => ({
  handlePersonalityAutocomplete: (...args: unknown[]) => mockHandlePersonalityAutocomplete(...args),
  handlePersonaAutocomplete: (...args: unknown[]) => mockHandlePersonaAutocomplete(...args),
  CREATE_NEW_PERSONA_VALUE: '__create_new__',
}));

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

describe('handleMePersonalityAutocomplete', () => {
  const mockRespond = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockRespond.mockResolvedValue(undefined);
    mockHandlePersonalityAutocomplete.mockResolvedValue(true);
  });

  function createMockInteraction() {
    return {
      user: { id: '123456789' },
      options: {
        getFocused: vi.fn().mockReturnValue({
          name: 'personality',
          value: 'test',
        }),
      },
      respond: mockRespond,
    } as any;
  }

  it('should call shared handlePersonalityAutocomplete with correct options', async () => {
    const interaction = createMockInteraction();
    await handleMePersonalityAutocomplete(interaction);

    expect(mockHandlePersonalityAutocomplete).toHaveBeenCalledWith(interaction, {
      optionName: 'personality',
      ownedOnly: false,
      showVisibility: true,
    });
  });

  it('should return empty array when shared utility returns false', async () => {
    mockHandlePersonalityAutocomplete.mockResolvedValue(false);
    const interaction = createMockInteraction();

    await handleMePersonalityAutocomplete(interaction);

    expect(interaction.respond).toHaveBeenCalledWith([]);
  });

  it('should handle errors gracefully', async () => {
    mockHandlePersonalityAutocomplete.mockRejectedValue(new Error('Network error'));
    const interaction = createMockInteraction();

    await handleMePersonalityAutocomplete(interaction);

    expect(interaction.respond).toHaveBeenCalledWith([]);
  });
});

describe('handlePersonaAutocomplete', () => {
  const mockRespond = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockRespond.mockResolvedValue(undefined);
    mockHandlePersonaAutocomplete.mockResolvedValue(true);
  });

  function createMockInteraction() {
    return {
      user: { id: '123456789' },
      options: {
        getFocused: vi.fn().mockReturnValue({
          name: 'profile',
          value: 'test',
        }),
      },
      respond: mockRespond,
    } as any;
  }

  it('should call shared handlePersonaAutocomplete with correct options when includeCreateNew is false', async () => {
    const interaction = createMockInteraction();
    await handlePersonaAutocomplete(interaction, false);

    expect(mockHandlePersonaAutocomplete).toHaveBeenCalledWith(interaction, {
      optionName: 'profile',
      includeCreateNew: false,
      logPrefix: '[Me]',
    });
  });

  it('should call shared handlePersonaAutocomplete with correct options when includeCreateNew is true', async () => {
    const interaction = createMockInteraction();
    await handlePersonaAutocomplete(interaction, true);

    expect(mockHandlePersonaAutocomplete).toHaveBeenCalledWith(interaction, {
      optionName: 'profile',
      includeCreateNew: true,
      logPrefix: '[Me]',
    });
  });

  it('should return empty array when shared utility returns false', async () => {
    mockHandlePersonaAutocomplete.mockResolvedValue(false);
    const interaction = createMockInteraction();

    await handlePersonaAutocomplete(interaction);

    expect(interaction.respond).toHaveBeenCalledWith([]);
  });

  it('should not call respond when shared utility returns true (it handles response)', async () => {
    mockHandlePersonaAutocomplete.mockResolvedValue(true);
    const interaction = createMockInteraction();

    await handlePersonaAutocomplete(interaction);

    expect(interaction.respond).not.toHaveBeenCalled();
  });

  it('should handle errors gracefully', async () => {
    mockHandlePersonaAutocomplete.mockRejectedValue(new Error('Network error'));
    const interaction = createMockInteraction();

    await handlePersonaAutocomplete(interaction);

    expect(interaction.respond).toHaveBeenCalledWith([]);
  });
});
