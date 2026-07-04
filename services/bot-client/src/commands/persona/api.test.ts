/**
 * Tests for Persona API Helpers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchPersona,
  fetchDefaultPersona,
  updatePersona,
  deletePersona,
  isDefaultPersona,
} from './api.js';
import { mockGetPersonaResponse, mockListPersonasResponse } from '@tzurot/test-factories';
import { makeOk, makeErr, asUserClient } from '../../test/gatewayClientStubs.js';
import { InfraError, GatewayClientError } from '@tzurot/clients';

const TEST_PERSONA_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const OTHER_PERSONA_ID = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
const TEST_USER_ID = '123456789';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
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

interface PersonaClientStub {
  getPersona: ReturnType<typeof vi.fn>;
  listPersonas: ReturnType<typeof vi.fn>;
  updatePersona: ReturnType<typeof vi.fn>;
  deletePersona: ReturnType<typeof vi.fn>;
}

function makeStub(): PersonaClientStub {
  return {
    getPersona: vi.fn(),
    listPersonas: vi.fn(),
    updatePersona: vi.fn(),
    deletePersona: vi.fn(),
  };
}

describe('fetchPersona', () => {
  let stub: PersonaClientStub;

  beforeEach(() => {
    stub = makeStub();
  });

  it('should return persona when found', async () => {
    stub.getPersona.mockResolvedValue(
      makeOk(mockGetPersonaResponse({ persona: { id: TEST_PERSONA_ID, name: 'Test Persona' } }))
    );

    const result = await fetchPersona(TEST_PERSONA_ID, asUserClient(stub), TEST_USER_ID);

    expect(stub.getPersona).toHaveBeenCalledWith(TEST_PERSONA_ID);
    expect(result).not.toBeNull();
    expect(result?.name).toBe('Test Persona');
  });

  it('should return null when not found', async () => {
    stub.getPersona.mockResolvedValue(makeErr(404, 'Persona not found'));

    const result = await fetchPersona(TEST_PERSONA_ID, asUserClient(stub), TEST_USER_ID);

    expect(result).toBeNull();
  });

  it('throws InfraError on an infra failure — never a silent null "not found"', async () => {
    stub.getPersona.mockResolvedValue(makeErr(503, 'Bad Gateway'));

    await expect(fetchPersona(TEST_PERSONA_ID, asUserClient(stub), TEST_USER_ID)).rejects.toThrow(
      InfraError
    );
  });

  it('throws GatewayClientError (not "try again") on a non-404 4xx', async () => {
    stub.getPersona.mockResolvedValue(makeErr(403, 'Forbidden'));

    await expect(fetchPersona(TEST_PERSONA_ID, asUserClient(stub), TEST_USER_ID)).rejects.toThrow(
      GatewayClientError
    );
  });
});

describe('fetchDefaultPersona', () => {
  let stub: PersonaClientStub;

  beforeEach(() => {
    stub = makeStub();
  });

  it('should return default persona when exists', async () => {
    stub.listPersonas.mockResolvedValue(
      makeOk(
        mockListPersonasResponse([
          { id: TEST_PERSONA_ID, name: 'Default', isDefault: true },
          { id: OTHER_PERSONA_ID, name: 'Other', isDefault: false },
        ])
      )
    );
    stub.getPersona.mockResolvedValue(
      makeOk(
        mockGetPersonaResponse({
          persona: { id: TEST_PERSONA_ID, name: 'Default', isDefault: true },
        })
      )
    );

    const result = await fetchDefaultPersona(asUserClient(stub), TEST_USER_ID);

    expect(stub.listPersonas).toHaveBeenCalled();
    expect(result).not.toBeNull();
    expect(result?.name).toBe('Default');
  });

  it('should return null when no default persona', async () => {
    stub.listPersonas.mockResolvedValue(
      makeOk(mockListPersonasResponse([{ id: TEST_PERSONA_ID, name: 'Test', isDefault: false }]))
    );

    const result = await fetchDefaultPersona(asUserClient(stub), TEST_USER_ID);

    expect(result).toBeNull();
  });

  it('throws InfraError when the list fetch fails (infra) — not a silent "no personas"', async () => {
    stub.listPersonas.mockResolvedValue(makeErr(500, 'Failed to fetch'));

    await expect(fetchDefaultPersona(asUserClient(stub), TEST_USER_ID)).rejects.toThrow(InfraError);
  });

  it('throws GatewayClientError on a non-404 4xx (request rejected) — not a silent "no personas"', async () => {
    stub.listPersonas.mockResolvedValue(makeErr(403, 'Forbidden'));

    await expect(fetchDefaultPersona(asUserClient(stub), TEST_USER_ID)).rejects.toThrow(
      GatewayClientError
    );
  });
});

describe('updatePersona', () => {
  let stub: PersonaClientStub;

  beforeEach(() => {
    stub = makeStub();
  });

  it('should return updated persona on success', async () => {
    stub.updatePersona.mockResolvedValue(
      makeOk({
        success: true,
        persona: {
          id: TEST_PERSONA_ID,
          name: 'Updated Name',
          preferredName: 'Tester',
          pronouns: 'they/them',
          description: null,
          content: 'About me',
          isDefault: false,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z',
        },
      })
    );

    const result = await updatePersona(
      TEST_PERSONA_ID,
      {
        name: 'Updated Name',
        content: undefined,
        preferredName: 'Tester',
        description: undefined,
        pronouns: undefined,
      },
      asUserClient(stub),
      TEST_USER_ID
    );

    expect(stub.updatePersona).toHaveBeenCalledWith(
      TEST_PERSONA_ID,
      expect.objectContaining({ name: 'Updated Name', preferredName: 'Tester' })
    );
    expect(result).not.toBeNull();
    expect(result?.name).toBe('Updated Name');
  });

  it('throws DashboardUpdateError carrying the gateway status on failure', async () => {
    stub.updatePersona.mockResolvedValue(makeErr(500, 'Update failed'));

    await expect(
      updatePersona(
        TEST_PERSONA_ID,
        {
          name: 'Test',
          content: undefined,
          preferredName: undefined,
          description: undefined,
          pronouns: undefined,
        },
        asUserClient(stub),
        TEST_USER_ID
      )
    ).rejects.toMatchObject({
      name: 'DashboardUpdateError',
      status: 500,
      message: 'Failed to update persona: 500 - Update failed',
    });
  });

  it('throws with status 0 on a client-side abort', async () => {
    stub.updatePersona.mockResolvedValue(makeErr(0, 'Request timeout', undefined, 'timeout'));

    await expect(
      updatePersona(
        TEST_PERSONA_ID,
        {
          name: 'Test',
          content: undefined,
          preferredName: undefined,
          description: undefined,
          pronouns: undefined,
        },
        asUserClient(stub),
        TEST_USER_ID
      )
    ).rejects.toMatchObject({ name: 'DashboardUpdateError', status: 0, kind: 'timeout' });
  });
});

describe('deletePersona', () => {
  let stub: PersonaClientStub;

  beforeEach(() => {
    stub = makeStub();
  });

  it('should return success on successful delete', async () => {
    stub.deletePersona.mockResolvedValue(makeOk({ message: 'Persona deleted' }));

    const result = await deletePersona(TEST_PERSONA_ID, asUserClient(stub), TEST_USER_ID);

    expect(stub.deletePersona).toHaveBeenCalledWith(TEST_PERSONA_ID);
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should return error on failure', async () => {
    stub.deletePersona.mockResolvedValue(makeErr(400, 'Cannot delete default persona'));

    const result = await deletePersona(TEST_PERSONA_ID, asUserClient(stub), TEST_USER_ID);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Cannot delete default persona');
  });
});

describe('isDefaultPersona', () => {
  let stub: PersonaClientStub;

  beforeEach(() => {
    stub = makeStub();
  });

  it('should return true for default persona', async () => {
    stub.listPersonas.mockResolvedValue(
      makeOk(
        mockListPersonasResponse([
          { id: TEST_PERSONA_ID, name: 'Default', isDefault: true },
          { id: OTHER_PERSONA_ID, name: 'Other', isDefault: false },
        ])
      )
    );

    const result = await isDefaultPersona(TEST_PERSONA_ID, asUserClient(stub));

    expect(result).toBe(true);
  });

  it('should return false for non-default persona', async () => {
    stub.listPersonas.mockResolvedValue(
      makeOk(mockListPersonasResponse([{ id: TEST_PERSONA_ID, name: 'Test', isDefault: false }]))
    );

    const result = await isDefaultPersona(TEST_PERSONA_ID, asUserClient(stub));

    expect(result).toBe(false);
  });

  it('should return false when persona not in list', async () => {
    stub.listPersonas.mockResolvedValue(
      makeOk(mockListPersonasResponse([{ id: OTHER_PERSONA_ID, name: 'Other', isDefault: true }]))
    );

    const result = await isDefaultPersona(TEST_PERSONA_ID, asUserClient(stub));

    expect(result).toBe(false);
  });

  it('throws InfraError on an infra failure — fail-CLOSED so the delete guard cannot be bypassed', async () => {
    stub.listPersonas.mockResolvedValue(makeErr(500, 'Failed'));

    // Old behavior returned false → a transient blip let the default persona be
    // deleted. Now it throws so the delete aborts (caught upstream → "try again").
    await expect(isDefaultPersona(TEST_PERSONA_ID, asUserClient(stub))).rejects.toThrow(InfraError);
  });

  it('throws GatewayClientError on a non-404 4xx — also fail-CLOSED so the delete aborts', async () => {
    stub.listPersonas.mockResolvedValue(makeErr(403, 'Forbidden'));

    await expect(isDefaultPersona(TEST_PERSONA_ID, asUserClient(stub))).rejects.toThrow(
      GatewayClientError
    );
  });
});
