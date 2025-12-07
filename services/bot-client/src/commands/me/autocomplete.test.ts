/**
 * Tests for Me Command Autocomplete Handler
 * Tests both personality and persona autocomplete using gateway APIs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleMePersonalityAutocomplete,
  handlePersonaAutocomplete,
  CREATE_NEW_PERSONA_VALUE,
} from './autocomplete.js';
import { mockListPersonasResponse } from '@tzurot/common-types';

// Test UUIDs for personas (must be valid UUID format: 4th segment starts with 8/9/a/b)
const PERSONA_ID_1 = '11111111-1111-4111-8111-111111111111';
const PERSONA_ID_2 = '22222222-2222-4222-8222-222222222222';

// Mock gateway client
const mockCallGatewayApi = vi.fn();
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
}));

// Mock the shared personality autocomplete utility
const mockHandlePersonalityAutocomplete = vi.fn();
vi.mock('../../utils/autocomplete/index.js', () => ({
  handlePersonalityAutocomplete: (...args: unknown[]) => mockHandlePersonalityAutocomplete(...args),
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
  });

  function createMockInteraction(focusedName: string, focusedValue: string) {
    return {
      user: { id: '123456789' },
      options: {
        getFocused: vi.fn().mockReturnValue({
          name: focusedName,
          value: focusedValue,
        }),
      },
      respond: mockRespond,
    } as any;
  }

  it('should return empty array for non-profile focused option', async () => {
    await handlePersonaAutocomplete(createMockInteraction('other-field', 'test'));

    expect(mockRespond).toHaveBeenCalledWith([]);
    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });

  it('should call gateway API with user ID', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListPersonasResponse([]),
    });

    await handlePersonaAutocomplete(createMockInteraction('profile', ''));

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/persona', {
      userId: '123456789',
    });
  });

  it('should return user profiles with preferredName as display', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListPersonasResponse([
        { id: PERSONA_ID_1, name: 'Work', preferredName: 'Professional Me', isDefault: false },
        { id: PERSONA_ID_2, name: 'Casual', preferredName: 'Relaxed Me', isDefault: false },
      ]),
    });

    await handlePersonaAutocomplete(createMockInteraction('profile', ''));

    expect(mockRespond).toHaveBeenCalledWith([
      { name: 'Professional Me', value: PERSONA_ID_1 },
      { name: 'Relaxed Me', value: PERSONA_ID_2 },
    ]);
  });

  it('should mark default profile with star indicator', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListPersonasResponse([
        { id: PERSONA_ID_1, name: 'Default', preferredName: 'My Default', isDefault: true },
        { id: PERSONA_ID_2, name: 'Other', preferredName: null, isDefault: false },
      ]),
    });

    await handlePersonaAutocomplete(createMockInteraction('profile', ''));

    expect(mockRespond).toHaveBeenCalledWith([
      { name: 'My Default ⭐ (default)', value: PERSONA_ID_1 },
      { name: 'Other', value: PERSONA_ID_2 },
    ]);
  });

  it('should use name as fallback when preferredName is null', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListPersonasResponse([
        { id: PERSONA_ID_1, name: 'WorkProfile', preferredName: null, isDefault: false },
      ]),
    });

    await handlePersonaAutocomplete(createMockInteraction('profile', ''));

    expect(mockRespond).toHaveBeenCalledWith([{ name: 'WorkProfile', value: PERSONA_ID_1 }]);
  });

  it('should include "Create new profile" option when includeCreateNew is true', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListPersonasResponse([
        { id: PERSONA_ID_1, name: 'Existing', preferredName: null, isDefault: false },
      ]),
    });

    await handlePersonaAutocomplete(createMockInteraction('profile', ''), true);

    expect(mockRespond).toHaveBeenCalledWith([
      { name: 'Existing', value: PERSONA_ID_1 },
      { name: '➕ Create new profile...', value: CREATE_NEW_PERSONA_VALUE },
    ]);
  });

  it('should not include "Create new profile" when includeCreateNew is false', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListPersonasResponse([
        { id: PERSONA_ID_1, name: 'Existing', preferredName: null, isDefault: false },
      ]),
    });

    await handlePersonaAutocomplete(createMockInteraction('profile', ''), false);

    const response = mockRespond.mock.calls[0][0];
    expect(response).not.toContainEqual(
      expect.objectContaining({ value: CREATE_NEW_PERSONA_VALUE })
    );
  });

  it('should filter "Create new profile" option based on query', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListPersonasResponse([]),
    });

    // Query matches "create"
    await handlePersonaAutocomplete(createMockInteraction('profile', 'create'), true);
    expect(mockRespond).toHaveBeenCalledWith([
      { name: '➕ Create new profile...', value: CREATE_NEW_PERSONA_VALUE },
    ]);

    vi.clearAllMocks();

    // Query doesn't match
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListPersonasResponse([]),
    });
    await handlePersonaAutocomplete(createMockInteraction('profile', 'xyz'), true);
    expect(mockRespond).toHaveBeenCalledWith([]);
  });

  it('should return empty array when user has no profiles', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListPersonasResponse([]),
    });

    await handlePersonaAutocomplete(createMockInteraction('profile', ''));

    expect(mockRespond).toHaveBeenCalledWith([]);
  });

  it('should return empty array when gateway API fails', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'Gateway error',
    });

    await handlePersonaAutocomplete(createMockInteraction('profile', ''));

    expect(mockRespond).toHaveBeenCalledWith([]);
  });

  it('should handle errors gracefully', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    await handlePersonaAutocomplete(createMockInteraction('profile', 'test'));

    expect(mockRespond).toHaveBeenCalledWith([]);
  });

  it('should filter profiles based on query', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListPersonasResponse([
        { id: PERSONA_ID_1, name: 'Work', preferredName: 'Professional', isDefault: false },
        { id: PERSONA_ID_2, name: 'Personal', preferredName: 'Casual Me', isDefault: false },
      ]),
    });

    await handlePersonaAutocomplete(createMockInteraction('profile', 'work'));

    // Only 'Work' matches the query 'work'
    expect(mockRespond).toHaveBeenCalledWith([{ name: 'Professional', value: PERSONA_ID_1 }]);
  });

  it('should filter by preferredName too', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListPersonasResponse([
        { id: PERSONA_ID_1, name: 'First', preferredName: 'Professional Me', isDefault: false },
        { id: PERSONA_ID_2, name: 'Second', preferredName: 'Casual', isDefault: false },
      ]),
    });

    await handlePersonaAutocomplete(createMockInteraction('profile', 'prof'));

    // 'Professional Me' matches the query 'prof'
    expect(mockRespond).toHaveBeenCalledWith([{ name: 'Professional Me', value: PERSONA_ID_1 }]);
  });

  it('should return all profiles when query is empty', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListPersonasResponse([
        { id: PERSONA_ID_1, name: 'Work', preferredName: null, isDefault: false },
        { id: PERSONA_ID_2, name: 'Personal', preferredName: null, isDefault: false },
      ]),
    });

    await handlePersonaAutocomplete(createMockInteraction('profile', ''));

    expect(mockRespond).toHaveBeenCalledWith([
      { name: 'Work', value: PERSONA_ID_1 },
      { name: 'Personal', value: PERSONA_ID_2 },
    ]);
  });
});
