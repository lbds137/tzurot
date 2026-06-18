/**
 * Tests for Preset API Client Functions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchPreset,
  fetchGlobalPreset,
  updatePreset,
  updateGlobalPreset,
  extractApiErrorMessage,
  buildSaveErrorContent,
  PresetUpdateError,
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
  visionModel: null,
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
    stub.updateUserLlmConfig.mockResolvedValue({ ok: false, status: 500 } as never);

    await expect(updatePreset('preset-123', {}, asUserClient(stub))).rejects.toThrow(
      'Failed to update preset: 500 - Unknown'
    );
  });

  it('throws PresetUpdateError carrying the gateway status (0 on client-side timeout)', async () => {
    stub.updateUserLlmConfig.mockResolvedValue(makeErr(0, 'Request timeout'));

    await expect(updatePreset('preset-123', {}, asUserClient(stub))).rejects.toMatchObject({
      name: 'PresetUpdateError',
      status: 0,
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
    stub.updateGlobalLlmConfig.mockResolvedValue({ ok: false, status: 500 } as never);

    await expect(updateGlobalPreset('preset-123', {}, asOwnerClient(stub))).rejects.toThrow(
      'Failed to update global preset: 500 - Unknown'
    );
  });
});

describe('buildSaveErrorContent', () => {
  it('shows the honest "may still be applying" notice on a status-0 timeout', () => {
    const error = new PresetUpdateError('Failed to update preset: 0 - Request timeout', 0);
    const content = buildSaveErrorContent(error);
    expect(content).toContain('may still be applying');
    expect(content).toContain('Refresh');
    expect(content).not.toContain('❌');
  });

  it('shows the extracted gateway message on a genuine HTTP rejection', () => {
    const error = new PresetUpdateError('Failed to update preset: 400 - Context too large', 400);
    expect(buildSaveErrorContent(error)).toBe('❌ Context too large');
  });

  it('falls back to a generic failure for a non-PresetUpdateError', () => {
    expect(buildSaveErrorContent(new Error('boom'))).toBe(
      '❌ Failed to update preset. Please try again.'
    );
  });
});

describe('extractApiErrorMessage', () => {
  it('should extract API message from structured error', () => {
    const error = new Error('Failed to update preset: 400 - Context window too large');
    expect(extractApiErrorMessage(error)).toBe('Context window too large');
  });

  it('should return null for non-Error values', () => {
    expect(extractApiErrorMessage('string error')).toBeNull();
    expect(extractApiErrorMessage(null)).toBeNull();
  });

  it('should return null for errors without API format', () => {
    expect(extractApiErrorMessage(new Error('Network error'))).toBeNull();
  });

  it('should return null for non-API errors containing dashes', () => {
    expect(extractApiErrorMessage(new Error('Request timed out - after 30s'))).toBeNull();
    expect(extractApiErrorMessage(new Error('TLS handshake failed - connection reset'))).toBeNull();
  });

  it('should preserve dashes in the API message portion', () => {
    const error = new Error('Failed to update preset: 400 - limit is 4096 - not 131072');
    expect(extractApiErrorMessage(error)).toBe('limit is 4096 - not 131072');
  });

  it('should truncate very long API messages', () => {
    const longMessage = 'A'.repeat(2000);
    const error = new Error(`Failed to update preset: 400 - ${longMessage}`);
    const result = extractApiErrorMessage(error);
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(1801); // 1800 + ellipsis
    expect(result!.endsWith('…')).toBe(true);
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
    stub.createUserLlmConfig.mockResolvedValue({
      ok: false,
      error: 'You already have a config named "Foo"',
      status: 400,
      code: 'NAME_COLLISION',
    } as never);

    // Catch the rejection once so we can inspect class + shape without
    // re-invoking createPreset (which would re-consume the one-shot mock).
    const err = await createPreset(
      { name: 'Foo', model: 'm', provider: 'p' },
      asUserClient(stub)
    ).catch(e => e);

    expect(err).toBeInstanceOf(GatewayApiError);
    expect(err.status).toBe(400);
    expect(err.code).toBe('NAME_COLLISION');
  });

  it('throws GatewayApiError with undefined code when gateway sends no sub-code', async () => {
    stub.createUserLlmConfig.mockResolvedValue({
      ok: false,
      error: 'Some other failure',
      status: 500,
    } as never);

    await expect(
      createPreset({ name: 'Foo', model: 'm', provider: 'p' }, asUserClient(stub))
    ).rejects.toMatchObject({
      status: 500,
      code: undefined,
    });
  });
});
