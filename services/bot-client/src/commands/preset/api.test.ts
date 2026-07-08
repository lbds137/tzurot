/**
 * Tests for Preset API Client Functions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchPreset,
  fetchGlobalPreset,
  updatePreset,
  updateGlobalPreset,
  createPreset,
} from './api.js';
import { GatewayApiError } from '@tzurot/clients';
import { makeOk, makeErr, asUserClient, asOwnerClient } from '../../test/gatewayClientStubs.js';
import type { PresetData } from './config.js';

interface UserClientStub {
  getUserLlmConfig: ReturnType<typeof vi.fn>;
  updateUserLlmConfig: ReturnType<typeof vi.fn>;
  createUserLlmConfig: ReturnType<typeof vi.fn>;
}

interface OwnerClientStub {
  getGlobalLlmConfig: ReturnType<typeof vi.fn>;
  updateGlobalLlmConfig: ReturnType<typeof vi.fn>;
}

function createUserStub(): UserClientStub {
  return {
    getUserLlmConfig: vi.fn(),
    updateUserLlmConfig: vi.fn(),
    createUserLlmConfig: vi.fn(),
  };
}

function createOwnerStub(): OwnerClientStub {
  return {
    getGlobalLlmConfig: vi.fn(),
    updateGlobalLlmConfig: vi.fn(),
  };
}

const mockPresetData: PresetData = {
  id: 'preset-123',
  name: 'Test Preset',
  description: 'A test preset',
  model: 'anthropic/claude-sonnet-4',
  provider: 'openrouter',
  isGlobal: false,
  isOwned: true,
  permissions: { canEdit: true, canDelete: true },
  contextWindowTokens: 8192,
  params: {
    temperature: 0.7,
    top_p: 0.9,
  },
};

describe('fetchPreset', () => {
  let stub: UserClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createUserStub();
  });

  it('should fetch preset successfully', async () => {
    stub.getUserLlmConfig.mockResolvedValue(makeOk({ config: mockPresetData }));

    const result = await fetchPreset('preset-123', asUserClient(stub));

    expect(stub.getUserLlmConfig).toHaveBeenCalledWith('preset-123');
    expect(result).toEqual(mockPresetData);
  });

  it('should return null on 404', async () => {
    stub.getUserLlmConfig.mockResolvedValue(makeErr(404));

    const result = await fetchPreset('missing', asUserClient(stub));

    expect(result).toBeNull();
  });

  it('should throw on other errors', async () => {
    stub.getUserLlmConfig.mockResolvedValue(makeErr(500));

    await expect(fetchPreset('preset-123', asUserClient(stub))).rejects.toThrow(
      'Failed to fetch preset: 500'
    );
  });
});

describe('fetchGlobalPreset', () => {
  let stub: OwnerClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createOwnerStub();
  });

  it('should fetch global preset successfully', async () => {
    // The gateway now emits isOwned/permissions on admin/global responses
    // (withAdminOwnership), so fetchGlobalPreset returns the typed detail
    // verbatim — no client-side patching.
    const adminResponseConfig = {
      ...mockPresetData,
      isOwned: true, // Admin owns global presets
      permissions: { canEdit: true, canDelete: true },
    };

    stub.getGlobalLlmConfig.mockResolvedValue(makeOk({ config: adminResponseConfig }));

    const result = await fetchGlobalPreset('preset-123', asOwnerClient(stub));

    expect(stub.getGlobalLlmConfig).toHaveBeenCalledWith('preset-123');
    expect(result).toEqual(adminResponseConfig);
  });

  it('should return null on 404', async () => {
    stub.getGlobalLlmConfig.mockResolvedValue(makeErr(404));

    const result = await fetchGlobalPreset('nonexistent', asOwnerClient(stub));

    expect(result).toBeNull();
  });

  it('should throw on other errors', async () => {
    stub.getGlobalLlmConfig.mockResolvedValue(makeErr(500));

    await expect(fetchGlobalPreset('preset-123', asOwnerClient(stub))).rejects.toThrow(
      'Failed to fetch global preset: 500'
    );
  });
});

describe('updatePreset', () => {
  let stub: UserClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createUserStub();
  });

  it('should update preset successfully', async () => {
    stub.updateUserLlmConfig.mockResolvedValue(makeOk({ config: mockPresetData }));

    const updateData = { name: 'Updated Name' };
    const result = await updatePreset('preset-123', updateData, asUserClient(stub));

    expect(stub.updateUserLlmConfig).toHaveBeenCalledWith('preset-123', updateData);
    expect(result).toEqual(mockPresetData);
  });

  it('should throw on error with message', async () => {
    stub.updateUserLlmConfig.mockResolvedValue(makeErr(400, 'Invalid data'));

    await expect(updatePreset('preset-123', {}, asUserClient(stub))).rejects.toThrow(
      'Failed to update preset: 400 - Invalid data'
    );
  });

  it('should throw on error without message', async () => {
    // `as never` intentionally omits the type-required `error` to exercise the
    // throw site's `?? 'Unknown'` defensive fallback; `kind` is set so the thrown
    // GatewayApiError carries a valid kind rather than undefined.
    stub.updateUserLlmConfig.mockResolvedValue({ ok: false, status: 500, kind: 'http' } as never);

    await expect(updatePreset('preset-123', {}, asUserClient(stub))).rejects.toThrow(
      'Failed to update preset: 500 - Unknown'
    );
  });

  it('throws GatewayApiError carrying status + kind (0/timeout on client-side timeout)', async () => {
    stub.updateUserLlmConfig.mockResolvedValue(makeErr(0, 'Request timeout', undefined, 'timeout'));

    // kind:'timeout' must survive the throw — isSaveTimeout keys on it, so a
    // dropped result.kind would silently hide the "may still be applying" notice.
    await expect(updatePreset('preset-123', {}, asUserClient(stub))).rejects.toMatchObject({
      name: 'GatewayApiError',
      status: 0,
      kind: 'timeout',
    });
  });
});

describe('updateGlobalPreset', () => {
  let stub: OwnerClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createOwnerStub();
  });

  it('should update global preset successfully', async () => {
    // Admin API doesn't return isOwned/permissions, so function adds them
    const apiResponse = { ...mockPresetData };
    stub.updateGlobalLlmConfig.mockResolvedValue(makeOk({ config: apiResponse }));

    const updateData = { name: 'Updated Name' };
    const result = await updateGlobalPreset('preset-123', updateData, asOwnerClient(stub));

    expect(stub.updateGlobalLlmConfig).toHaveBeenCalledWith('preset-123', updateData);
    expect(result).toEqual({
      ...mockPresetData,
      isOwned: true,
      permissions: { canEdit: true, canDelete: true },
    });
  });

  it('throws on failure with gateway error message', async () => {
    stub.updateGlobalLlmConfig.mockResolvedValue(makeErr(400, 'Context window too large'));

    await expect(updateGlobalPreset('preset-123', {}, asOwnerClient(stub))).rejects.toThrow(
      'Failed to update global preset: 400 - Context window too large'
    );
  });

  it('throws with Unknown when gateway has no error message', async () => {
    // `as never` omits the type-required `error` to exercise the `?? 'Unknown'`
    // fallback; `kind` is set so the thrown GatewayApiError carries a valid kind.
    stub.updateGlobalLlmConfig.mockResolvedValue({ ok: false, status: 500, kind: 'http' } as never);

    await expect(updateGlobalPreset('preset-123', {}, asOwnerClient(stub))).rejects.toThrow(
      'Failed to update global preset: 500 - Unknown'
    );
  });

  it('throws GatewayApiError carrying status + kind (0/timeout on client-side timeout)', async () => {
    stub.updateGlobalLlmConfig.mockResolvedValue(
      makeErr(0, 'Request timeout', undefined, 'timeout')
    );

    await expect(updateGlobalPreset('preset-123', {}, asOwnerClient(stub))).rejects.toMatchObject({
      name: 'GatewayApiError',
      status: 0,
      kind: 'timeout',
    });
  });
});

describe('createPreset', () => {
  let stub: UserClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createUserStub();
  });

  it('returns the created preset config on success', async () => {
    stub.createUserLlmConfig.mockResolvedValue(makeOk({ config: mockPresetData }));

    const result = await createPreset(
      { name: 'Foo', model: 'm', provider: 'p' },
      asUserClient(stub)
    );

    expect(result).toEqual(mockPresetData);
    expect(stub.createUserLlmConfig).toHaveBeenCalledWith({
      name: 'Foo',
      model: 'm',
      provider: 'p',
    });
  });

  it('throws GatewayApiError carrying status + code on failure', async () => {
    stub.createUserLlmConfig.mockResolvedValue(
      makeErr(400, 'You already have a config named "Foo"', 'NAME_COLLISION')
    );

    // Catch the rejection once so we can inspect class + shape without
    // re-invoking createPreset (which would re-consume the one-shot mock).
    const err = await createPreset(
      { name: 'Foo', model: 'm', provider: 'p' },
      asUserClient(stub)
    ).catch(e => e);

    expect(err).toBeInstanceOf(GatewayApiError);
    expect(err.status).toBe(400);
    expect(err.code).toBe('NAME_COLLISION');
    // kind propagates through the result→throw boundary, so try/catch callers
    // can branch on failure category just like result-based callers.
    expect(err.kind).toBe('http');
  });

  it('throws GatewayApiError with undefined code when gateway sends no sub-code', async () => {
    stub.createUserLlmConfig.mockResolvedValue(makeErr(500, 'Some other failure'));

    await expect(
      createPreset({ name: 'Foo', model: 'm', provider: 'p' }, asUserClient(stub))
    ).rejects.toMatchObject({
      status: 500,
      code: undefined,
      kind: 'http',
    });
  });
});
