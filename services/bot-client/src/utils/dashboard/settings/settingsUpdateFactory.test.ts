import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCallGatewayApi, mockMapSettingToApiUpdate } = vi.hoisted(() => ({
  mockCallGatewayApi: vi.fn(),
  mockMapSettingToApiUpdate: vi.fn(),
}));

vi.mock('../../userGatewayClient.js', async () => {
  const actual = await vi.importActual<typeof import('../../userGatewayClient.js')>(
    '../../userGatewayClient.js'
  );
  return {
    ...actual,
    callGatewayApi: mockCallGatewayApi,
  };
});

vi.mock('./settingsUpdate.js', () => ({
  mapSettingToApiUpdate: mockMapSettingToApiUpdate,
}));

import {
  createSettingsUpdateHandler,
  convertCascadeToSettingsData,
  type SettingUpdateConfig,
} from './settingsUpdateFactory.js';

const TEST_CONFIG: SettingUpdateConfig = {
  patchEndpoint: id => `/test/patch/${id}`,
  resolveEndpoint: id => `/test/resolve/${id}`,
  sourceTier: 'personality',
  logContext: '[Test]',
};

const TEST_ENTITY_ID = '00000000-0000-0000-0000-000000000001';
const TEST_USER_ID = 'discord-user-123';

const mockSession = {} as never;
const mockInteraction = {
  user: { id: TEST_USER_ID },
} as never;

const fullResolvedCascade = {
  maxMessages: 25,
  maxAge: 86400,
  maxImages: 5,
  focusModeEnabled: false,
  crossChannelHistoryEnabled: false,
  shareLtmAcrossPersonalities: false,
  memoryScoreThreshold: 0.7,
  memoryLimit: 10,
  showModelFooter: true,
  voiceResponseMode: 'never',
  voiceTranscriptionEnabled: false,
  elevenlabsTtsModel: 'eleven_turbo_v2_5',
  sources: {
    maxMessages: 'personality',
    maxAge: 'admin',
    maxImages: 'hardcoded',
    focusModeEnabled: 'hardcoded',
    crossChannelHistoryEnabled: 'hardcoded',
    shareLtmAcrossPersonalities: 'hardcoded',
    memoryScoreThreshold: 'hardcoded',
    memoryLimit: 'hardcoded',
    showModelFooter: 'hardcoded',
    voiceResponseMode: 'hardcoded',
    voiceTranscriptionEnabled: 'hardcoded',
    elevenlabsTtsModel: 'hardcoded',
  },
} as never;

describe('convertCascadeToSettingsData', () => {
  it('extracts fields matching the source tier as local overrides', () => {
    const result = convertCascadeToSettingsData(fullResolvedCascade, 'personality');
    expect(result.maxMessages.localValue).toBe(25);
    expect(result.maxMessages.source).toBe('personality');
  });

  it('treats non-matching source tiers as non-local', () => {
    const result = convertCascadeToSettingsData(fullResolvedCascade, 'user-personality');
    // maxMessages is 'personality', not 'user-personality', so it should NOT be a local override
    expect(result.maxMessages.localValue).toBeNull();
  });
});

describe('createSettingsUpdateHandler', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockMapSettingToApiUpdate.mockReturnValue({ maxMessages: 50 });
  });

  it('uses the configured patch endpoint', async () => {
    mockCallGatewayApi
      .mockResolvedValueOnce({ ok: true, status: 200, data: {} })
      .mockResolvedValueOnce({ ok: true, status: 200, data: fullResolvedCascade });

    const handler = createSettingsUpdateHandler(TEST_ENTITY_ID, TEST_CONFIG);
    const result = await handler(mockInteraction, mockSession, 'maxMessages', 50);

    expect(result.success).toBe(true);
    expect(mockCallGatewayApi).toHaveBeenNthCalledWith(
      1,
      `/test/patch/${TEST_ENTITY_ID}`,
      expect.objectContaining({ method: 'PATCH', body: { maxMessages: 50 } })
    );
  });

  it('uses the configured resolve endpoint on success', async () => {
    mockCallGatewayApi
      .mockResolvedValueOnce({ ok: true, status: 200, data: {} })
      .mockResolvedValueOnce({ ok: true, status: 200, data: fullResolvedCascade });

    const handler = createSettingsUpdateHandler(TEST_ENTITY_ID, TEST_CONFIG);
    await handler(mockInteraction, mockSession, 'maxMessages', 50);

    expect(mockCallGatewayApi).toHaveBeenNthCalledWith(
      2,
      `/test/resolve/${TEST_ENTITY_ID}`,
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('returns error when mapSettingToApiUpdate returns null (unknown setting)', async () => {
    mockMapSettingToApiUpdate.mockReturnValueOnce(null);

    const handler = createSettingsUpdateHandler(TEST_ENTITY_ID, TEST_CONFIG);
    const result = await handler(mockInteraction, mockSession, 'bogus-setting', 'value');

    expect(result).toEqual({ success: false, error: 'Unknown setting' });
    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });

  it('returns error when PATCH call fails', async () => {
    mockCallGatewayApi.mockResolvedValueOnce({ ok: false, status: 500, error: 'Server error' });

    const handler = createSettingsUpdateHandler(TEST_ENTITY_ID, TEST_CONFIG);
    const result = await handler(mockInteraction, mockSession, 'maxMessages', 50);

    expect(result).toEqual({ success: false, error: 'Server error' });
    // Should not have called resolve endpoint
    expect(mockCallGatewayApi).toHaveBeenCalledTimes(1);
  });

  it('returns error when resolve call fails after successful PATCH', async () => {
    mockCallGatewayApi
      .mockResolvedValueOnce({ ok: true, status: 200, data: {} })
      .mockResolvedValueOnce({ ok: false, status: 500, error: 'Resolve error' });

    const handler = createSettingsUpdateHandler(TEST_ENTITY_ID, TEST_CONFIG);
    const result = await handler(mockInteraction, mockSession, 'maxMessages', 50);

    expect(result.success).toBe(false);
    expect(result).toMatchObject({ error: 'Failed to fetch updated settings' });
  });

  it('handles unexpected exceptions', async () => {
    mockCallGatewayApi.mockRejectedValueOnce(new Error('Network down'));

    const handler = createSettingsUpdateHandler(TEST_ENTITY_ID, TEST_CONFIG);
    const result = await handler(mockInteraction, mockSession, 'maxMessages', 50);

    expect(result).toEqual({ success: false, error: 'Failed to update setting' });
  });

  it('returns newData derived from the configured sourceTier', async () => {
    mockCallGatewayApi
      .mockResolvedValueOnce({ ok: true, status: 200, data: {} })
      .mockResolvedValueOnce({ ok: true, status: 200, data: fullResolvedCascade });

    const handler = createSettingsUpdateHandler(TEST_ENTITY_ID, TEST_CONFIG);
    const result = await handler(mockInteraction, mockSession, 'maxMessages', 50);

    expect(result.success).toBe(true);
    // sourceTier was 'personality', so maxMessages (source: 'personality') should be local
    expect(result.newData?.maxMessages.localValue).toBe(25);
  });
});
