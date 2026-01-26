/**
 * Tests for Persona Autocomplete Handler
 * Tests personality and persona autocomplete functionality.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handlePersonalityAutocomplete,
  handlePersonaAutocomplete,
  CREATE_NEW_PERSONA_VALUE,
} from './autocomplete.js';

// Mock shared autocomplete utilities
const mockSharedPersonalityAutocomplete = vi.fn();
const mockSharedPersonaAutocomplete = vi.fn();
vi.mock('../../utils/autocomplete/index.js', () => ({
  handlePersonalityAutocomplete: (...args: unknown[]) => mockSharedPersonalityAutocomplete(...args),
  handlePersonaAutocomplete: (...args: unknown[]) => mockSharedPersonaAutocomplete(...args),
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

describe('handlePersonalityAutocomplete', () => {
  const mockRespond = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockRespond.mockResolvedValue(undefined);
  });

  function createMockInteraction() {
    return {
      user: { id: '123456789' },
      respond: mockRespond,
    } as unknown as Parameters<typeof handlePersonalityAutocomplete>[0];
  }

  it('should call shared personality autocomplete with correct options', async () => {
    mockSharedPersonalityAutocomplete.mockResolvedValue(true);

    await handlePersonalityAutocomplete(createMockInteraction());

    expect(mockSharedPersonalityAutocomplete).toHaveBeenCalledWith(expect.any(Object), {
      optionName: 'personality',
      ownedOnly: false,
      showVisibility: true,
    });
  });

  it('should respond with empty array if shared handler returns false', async () => {
    mockSharedPersonalityAutocomplete.mockResolvedValue(false);

    await handlePersonalityAutocomplete(createMockInteraction());

    expect(mockRespond).toHaveBeenCalledWith([]);
  });

  it('should handle errors gracefully', async () => {
    mockSharedPersonalityAutocomplete.mockRejectedValue(new Error('Test error'));

    await handlePersonalityAutocomplete(createMockInteraction());

    expect(mockRespond).toHaveBeenCalledWith([]);
  });
});

describe('handlePersonaAutocomplete', () => {
  const mockRespond = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockRespond.mockResolvedValue(undefined);
  });

  function createMockInteraction() {
    return {
      user: { id: '123456789' },
      respond: mockRespond,
    } as unknown as Parameters<typeof handlePersonaAutocomplete>[0];
  }

  it('should call shared persona autocomplete with correct options', async () => {
    mockSharedPersonaAutocomplete.mockResolvedValue(true);

    await handlePersonaAutocomplete(createMockInteraction(), false);

    expect(mockSharedPersonaAutocomplete).toHaveBeenCalledWith(expect.any(Object), {
      optionName: 'persona',
      includeCreateNew: false,
      logPrefix: '[Persona]',
    });
  });

  it('should pass includeCreateNew option when true', async () => {
    mockSharedPersonaAutocomplete.mockResolvedValue(true);

    await handlePersonaAutocomplete(createMockInteraction(), true);

    expect(mockSharedPersonaAutocomplete).toHaveBeenCalledWith(expect.any(Object), {
      optionName: 'persona',
      includeCreateNew: true,
      logPrefix: '[Persona]',
    });
  });

  it('should respond with empty array if shared handler returns false', async () => {
    mockSharedPersonaAutocomplete.mockResolvedValue(false);

    await handlePersonaAutocomplete(createMockInteraction(), false);

    expect(mockRespond).toHaveBeenCalledWith([]);
  });

  it('should handle errors gracefully', async () => {
    mockSharedPersonaAutocomplete.mockRejectedValue(new Error('Test error'));

    await handlePersonaAutocomplete(createMockInteraction(), false);

    expect(mockRespond).toHaveBeenCalledWith([]);
  });
});

describe('CREATE_NEW_PERSONA_VALUE', () => {
  it('should be exported and have the expected value', () => {
    expect(CREATE_NEW_PERSONA_VALUE).toBe('__create_new__');
  });
});
