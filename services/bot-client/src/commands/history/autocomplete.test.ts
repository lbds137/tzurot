/**
 * Tests for History Command Autocomplete
 *
 * Tests that history autocomplete delegates to the shared utilities correctly.
 * The shared utilities have their own comprehensive tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handlePersonalityAutocomplete, handlePersonaProfileAutocomplete } from './autocomplete.js';

// Mock the shared personality autocomplete utility
const mockSharedPersonalityAutocomplete = vi.fn();
vi.mock('../../utils/autocomplete/personalityAutocomplete.js', () => ({
  handlePersonalityAutocomplete: (...args: unknown[]) => mockSharedPersonalityAutocomplete(...args),
}));

// Mock the shared persona autocomplete utility
const mockSharedPersonaAutocomplete = vi.fn();
vi.mock('../../utils/autocomplete/personaAutocomplete.js', () => ({
  handlePersonaAutocomplete: (...args: unknown[]) => mockSharedPersonaAutocomplete(...args),
}));

describe('handlePersonalityAutocomplete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should delegate to shared personality autocomplete with correct options', async () => {
    const mockInteraction = {} as Parameters<typeof handlePersonalityAutocomplete>[0];

    await handlePersonalityAutocomplete(mockInteraction);

    expect(mockSharedPersonalityAutocomplete).toHaveBeenCalledWith(mockInteraction, {
      optionName: 'personality',
      showVisibility: true,
      ownedOnly: false,
    });
  });

  it('should pass interaction unchanged to shared utility', async () => {
    const mockInteraction = {
      user: { id: '123456789' },
      options: { getFocused: vi.fn() },
    } as unknown as Parameters<typeof handlePersonalityAutocomplete>[0];

    await handlePersonalityAutocomplete(mockInteraction);

    expect(mockSharedPersonalityAutocomplete).toHaveBeenCalledTimes(1);
    expect(mockSharedPersonalityAutocomplete.mock.calls[0][0]).toBe(mockInteraction);
  });
});

describe('handlePersonaProfileAutocomplete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should delegate to shared persona autocomplete with correct options', async () => {
    const mockInteraction = {} as Parameters<typeof handlePersonaProfileAutocomplete>[0];

    await handlePersonaProfileAutocomplete(mockInteraction);

    expect(mockSharedPersonaAutocomplete).toHaveBeenCalledWith(mockInteraction, {
      optionName: 'profile',
      includeCreateNew: false,
      logPrefix: '[History]',
    });
  });
});
