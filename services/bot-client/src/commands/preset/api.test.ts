/**
 * Tests for Preset API Client Functions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchPreset, fetchGlobalPreset, updatePreset, updateGlobalPreset } from './api.js';
import type { PresetData } from './config.js';

// Mock userGatewayClient
const mockCallGatewayApi = vi.fn();
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
}));

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
  maxReferencedMessages: 10,
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (adminResponseConfig as any).isOwned;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  it('should throw on error with body', async () => {
    mockAdminPutJson.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Invalid data',
    });

    await expect(updateGlobalPreset('preset-123', {})).rejects.toThrow(
      'Failed to update global preset: 400 - Invalid data'
    );
  });
});
