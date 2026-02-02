/**
 * Tests for Persona API Helpers
 * Tests fetch, update, and delete functions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchPersona,
  fetchDefaultPersona,
  updatePersona,
  deletePersona,
  isDefaultPersona,
} from './api.js';
import { mockGetPersonaResponse, mockListPersonasResponse } from '@tzurot/common-types';

// Valid UUIDs for tests
const TEST_PERSONA_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const OTHER_PERSONA_ID = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
const TEST_USER_ID = '123456789';

// Mock gateway client
const mockCallGatewayApi = vi.fn();
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
  GATEWAY_TIMEOUTS: { AUTOCOMPLETE: 2500, DEFERRED: 10000 },
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

describe('fetchPersona', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return persona when found', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockGetPersonaResponse({
        persona: { id: TEST_PERSONA_ID, name: 'Test Persona' },
      }),
    });

    const result = await fetchPersona(TEST_PERSONA_ID, TEST_USER_ID);

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      `/user/persona/${TEST_PERSONA_ID}`,
      expect.objectContaining({ userId: TEST_USER_ID })
    );
    expect(result).not.toBeNull();
    expect(result?.name).toBe('Test Persona');
  });

  it('should return null when not found', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'Persona not found',
    });

    const result = await fetchPersona(TEST_PERSONA_ID, TEST_USER_ID);

    expect(result).toBeNull();
  });
});

describe('fetchDefaultPersona', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return default persona when exists', async () => {
    // First call - list personas
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: mockListPersonasResponse([
        { id: TEST_PERSONA_ID, name: 'Default', isDefault: true },
        { id: OTHER_PERSONA_ID, name: 'Other', isDefault: false },
      ]),
    });
    // Second call - get persona details
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: mockGetPersonaResponse({
        persona: { id: TEST_PERSONA_ID, name: 'Default', isDefault: true },
      }),
    });

    const result = await fetchDefaultPersona(TEST_USER_ID);

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/persona',
      expect.objectContaining({ userId: TEST_USER_ID })
    );
    expect(result).not.toBeNull();
    expect(result?.name).toBe('Default');
  });

  it('should return null when no default persona', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListPersonasResponse([{ id: TEST_PERSONA_ID, name: 'Test', isDefault: false }]),
    });

    const result = await fetchDefaultPersona(TEST_USER_ID);

    expect(result).toBeNull();
  });

  it('should return null when list fails', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'Failed to fetch',
    });

    const result = await fetchDefaultPersona(TEST_USER_ID);

    expect(result).toBeNull();
  });
});

describe('updatePersona', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return updated persona on success', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        persona: {
          id: TEST_PERSONA_ID,
          name: 'Updated Name',
          preferredName: 'Tester',
          pronouns: 'they/them',
          description: null,
          content: 'About me',
          isDefault: false,
          shareLtmAcrossPersonalities: false,
        },
      },
    });

    const result = await updatePersona(
      TEST_PERSONA_ID,
      { name: 'Updated Name', preferredName: 'Tester' },
      TEST_USER_ID
    );

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      `/user/persona/${TEST_PERSONA_ID}`,
      expect.objectContaining({
        method: 'PUT',
        userId: TEST_USER_ID,
        body: { name: 'Updated Name', preferredName: 'Tester' },
      })
    );
    expect(result).not.toBeNull();
    expect(result?.name).toBe('Updated Name');
  });

  it('should return null on failure', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'Update failed',
    });

    const result = await updatePersona(TEST_PERSONA_ID, { name: 'Test' }, TEST_USER_ID);

    expect(result).toBeNull();
  });
});

describe('deletePersona', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return success on successful delete', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { message: 'Persona deleted' },
    });

    const result = await deletePersona(TEST_PERSONA_ID, TEST_USER_ID);

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      `/user/persona/${TEST_PERSONA_ID}`,
      expect.objectContaining({
        method: 'DELETE',
        userId: TEST_USER_ID,
      })
    );
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should return error on failure', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'Cannot delete default persona',
    });

    const result = await deletePersona(TEST_PERSONA_ID, TEST_USER_ID);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Cannot delete default persona');
  });
});

describe('isDefaultPersona', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return true for default persona', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListPersonasResponse([
        { id: TEST_PERSONA_ID, name: 'Default', isDefault: true },
        { id: OTHER_PERSONA_ID, name: 'Other', isDefault: false },
      ]),
    });

    const result = await isDefaultPersona(TEST_PERSONA_ID, TEST_USER_ID);

    expect(result).toBe(true);
  });

  it('should return false for non-default persona', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListPersonasResponse([{ id: TEST_PERSONA_ID, name: 'Test', isDefault: false }]),
    });

    const result = await isDefaultPersona(TEST_PERSONA_ID, TEST_USER_ID);

    expect(result).toBe(false);
  });

  it('should return false when persona not in list', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListPersonasResponse([{ id: OTHER_PERSONA_ID, name: 'Other', isDefault: true }]),
    });

    const result = await isDefaultPersona(TEST_PERSONA_ID, TEST_USER_ID);

    expect(result).toBe(false);
  });

  it('should return false on API failure', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'Failed',
    });

    const result = await isDefaultPersona(TEST_PERSONA_ID, TEST_USER_ID);

    expect(result).toBe(false);
  });
});
