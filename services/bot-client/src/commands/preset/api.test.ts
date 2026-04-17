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
  createPreset,
} from './api.js';
import { GatewayApiError } from '../../utils/userGatewayClient.js';
import type { PresetData } from './config.js';

// Mock userGatewayClient. importActual preserves GatewayApiError so the
// createPreset error-path test can assert on `instanceof GatewayApiError`.
const mockCallGatewayApi = vi.fn();
vi.mock('../../utils/userGatewayClient.js', async () => {
  const actual = await vi.importActual<typeof import('../../utils/userGatewayClient.js')>(
    '../../utils/userGatewayClient.js'
  );
  return {
    ...actual,
    callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
  };
});

// Mock adminApiClient
const mockAdminFetch = vi.fn();
const mockAdminPutJson = vi.fn();
vi.mock('../../utils/adminApiClient.js', () => ({
  adminFetch: (...args: unknown[]) => mockAdminFetch(...args),
  adminPutJson: (...args: unknown[]) => mockAdminPutJson(...args),
}));

const mockPresetData: PresetData = {
  id: 'preset-123',
  name: 'Test Preset',
  description: 'A test preset',
  provider: 'openrouter',
  model: 'anthropic/claude-sonnet-4',
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch preset successfully', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { config: mockPresetData },
    });

    const result = await fetchPreset('preset-123', 'user-456');

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/llm-config/preset-123', {
      userId: 'user-456',
    });
    expect(result).toEqual(mockPresetData);
  });

  it('should return null on 404', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 404,
    });

    const result = await fetchPreset('nonexistent', 'user-456');

    expect(result).toBeNull();
  });

  it('should throw on other errors', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 500,
    });

    await expect(fetchPreset('preset-123', 'user-456')).rejects.toThrow(
      'Failed to fetch preset: 500'
    );
  });
});

describe('fetchGlobalPreset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch global preset successfully', async () => {
    // Admin endpoint returns config without isOwned/permissions
    const adminResponseConfig = { ...mockPresetData };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Simulating admin response that lacks user-scoped fields
    delete (adminResponseConfig as any).isOwned;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Simulating admin response that lacks user-scoped fields
    delete (adminResponseConfig as any).permissions;

    mockAdminFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ config: adminResponseConfig }),
    });

    const result = await fetchGlobalPreset('preset-123');

    expect(mockAdminFetch).toHaveBeenCalledWith('/admin/llm-config/preset-123');
    // fetchGlobalPreset adds isOwned: true (admin owns global presets) and permissions
    // Admin always has full permissions on global presets
    expect(result).toEqual({
      ...mockPresetData,
      isOwned: true, // Admin owns global presets
      permissions: { canEdit: true, canDelete: true },
    });
  });

  it('should return null on 404', async () => {
    mockAdminFetch.mockResolvedValue({
      ok: false,
      status: 404,
    });

    const result = await fetchGlobalPreset('nonexistent');

    expect(result).toBeNull();
  });

  it('should throw on other errors', async () => {
    mockAdminFetch.mockResolvedValue({
      ok: false,
      status: 500,
    });

    await expect(fetchGlobalPreset('preset-123')).rejects.toThrow(
      'Failed to fetch global preset: 500'
    );
  });
});

describe('updatePreset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should update preset successfully', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { config: mockPresetData },
    });

    const updateData = { name: 'Updated Name' };
    const result = await updatePreset('preset-123', updateData, 'user-456');

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/llm-config/preset-123', {
      method: 'PUT',
      userId: 'user-456',
      body: updateData,
    });
    expect(result).toEqual(mockPresetData);
  });

  it('should throw on error with message', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 400,
      error: 'Invalid data',
    });

    await expect(updatePreset('preset-123', {}, 'user-456')).rejects.toThrow(
      'Failed to update preset: 400 - Invalid data'
    );
  });

  it('should throw on error without message', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 500,
    });

    await expect(updatePreset('preset-123', {}, 'user-456')).rejects.toThrow(
      'Failed to update preset: 500 - Unknown'
    );
  });
});

describe('updateGlobalPreset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should update global preset successfully', async () => {
    // Admin API doesn't return isOwned/permissions, so function adds them
    const apiResponse = { ...mockPresetData };
    mockAdminPutJson.mockResolvedValue({
      ok: true,
      json: async () => ({ config: apiResponse }),
    });

    const updateData = { name: 'Updated Name' };
    const result = await updateGlobalPreset('preset-123', updateData);

    expect(mockAdminPutJson).toHaveBeenCalledWith('/admin/llm-config/preset-123', updateData);
    // Function adds isOwned: true (admin owns global presets) and permissions for dashboard
    expect(result).toEqual({
      ...mockPresetData,
      isOwned: true, // Admin owns global presets
      permissions: { canEdit: true, canDelete: true },
    });
  });

  it('should extract message from JSON error response', async () => {
    mockAdminPutJson.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ message: 'Context window too large' }),
    });

    await expect(updateGlobalPreset('preset-123', {})).rejects.toThrow(
      'Failed to update global preset: 400 - Context window too large'
    );
  });

  it('should extract error field from JSON error response', async () => {
    mockAdminPutJson.mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => JSON.stringify({ error: 'VALIDATION_ERROR' }),
    });

    await expect(updateGlobalPreset('preset-123', {})).rejects.toThrow(
      'Failed to update global preset: 422 - VALIDATION_ERROR'
    );
  });

  it('should fall back to raw text for non-JSON error response', async () => {
    mockAdminPutJson.mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => '<html>Bad Gateway</html>',
    });

    await expect(updateGlobalPreset('preset-123', {})).rejects.toThrow(
      'Failed to update global preset: 502 - <html>Bad Gateway</html>'
    );
  });

  it('should use Unknown when JSON has no message or error field', async () => {
    mockAdminPutJson.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ detail: 'some other field' }),
    });

    await expect(updateGlobalPreset('preset-123', {})).rejects.toThrow(
      'Failed to update global preset: 400 - Unknown'
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the created preset config on success', async () => {
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: { config: mockPresetData },
    });

    const result = await createPreset({ name: 'Foo', model: 'm', provider: 'p' }, 'user-1');

    expect(result).toBe(mockPresetData);
    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/llm-config', {
      method: 'POST',
      userId: 'user-1',
      body: { name: 'Foo', model: 'm', provider: 'p' },
    });
  });

  it('throws GatewayApiError carrying status + errorCode on failure', async () => {
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: false,
      error: 'You already have a config named "Foo"',
      status: 400,
      errorCode: 'NAME_COLLISION',
    });

    // Catch the rejection once so we can inspect class + shape without
    // re-invoking createPreset (which would re-consume the one-shot mock).
    const err = await createPreset({ name: 'Foo', model: 'm', provider: 'p' }, 'user-1').catch(
      e => e
    );

    expect(err).toBeInstanceOf(GatewayApiError);
    expect(err.status).toBe(400);
    expect(err.code).toBe('NAME_COLLISION');
  });

  it('throws GatewayApiError with undefined code when gateway sends no sub-code', async () => {
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: false,
      error: 'Some other failure',
      status: 500,
    });

    await expect(
      createPreset({ name: 'Foo', model: 'm', provider: 'p' }, 'user-1')
    ).rejects.toMatchObject({
      status: 500,
      code: undefined,
    });
  });
});
