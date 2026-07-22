import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UserClient } from '@tzurot/clients';

const { mockPatchFn, mockResolveFn, mockMapSettingToApiUpdate } = vi.hoisted(() => ({
  mockPatchFn: vi.fn(),
  mockResolveFn: vi.fn(),
  mockMapSettingToApiUpdate: vi.fn(),
}));

const stubUserClient = {} as unknown as UserClient;

vi.mock('../../gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: stubUserClient })),
}));

vi.mock('./settingsUpdate.js', () => ({
  mapSettingToApiUpdate: mockMapSettingToApiUpdate,
}));

import {
  createSettingsUpdateHandler,
  convertCascadeToSettingsData,
  type SettingUpdateConfig,
} from './settingsUpdateFactory.js';

const TEST_CONFIG: SettingUpdateConfig = {
  patchFn: mockPatchFn,
  resolveFn: mockResolveFn,
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
  crossChannelHistoryEnabled: false,
  shareLtmAcrossPersonalities: false,
  memoryScoreThreshold: 0.7,
  memoryLimit: 10,
  showModelFooter: true,
  voiceResponseMode: 'never',
  voiceTranscriptionEnabled: false,
  sources: {
    maxMessages: 'personality',
    maxAge: 'admin',
    maxImages: 'hardcoded',
    crossChannelHistoryEnabled: 'hardcoded',
    shareLtmAcrossPersonalities: 'hardcoded',
    memoryScoreThreshold: 'hardcoded',
    memoryLimit: 'hardcoded',
    showModelFooter: 'hardcoded',
    voiceResponseMode: 'hardcoded',
    voiceTranscriptionEnabled: 'hardcoded',
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

  it('forwards the entityId and mapped body to patchFn', async () => {
    mockPatchFn.mockResolvedValueOnce({ ok: true, status: 200, data: {} });
    mockResolveFn.mockResolvedValueOnce({ ok: true, status: 200, data: fullResolvedCascade });

    const handler = createSettingsUpdateHandler(TEST_ENTITY_ID, TEST_CONFIG);
    const result = await handler(mockInteraction, mockSession, 'maxMessages', 50);

    expect(result.success).toBe(true);
    expect(mockPatchFn).toHaveBeenCalledWith(stubUserClient, TEST_ENTITY_ID, { maxMessages: 50 });
  });

  it('forwards the entityId to resolveFn on successful PATCH', async () => {
    mockPatchFn.mockResolvedValueOnce({ ok: true, status: 200, data: {} });
    mockResolveFn.mockResolvedValueOnce({ ok: true, status: 200, data: fullResolvedCascade });

    const handler = createSettingsUpdateHandler(TEST_ENTITY_ID, TEST_CONFIG);
    await handler(mockInteraction, mockSession, 'maxMessages', 50);

    expect(mockResolveFn).toHaveBeenCalledWith(stubUserClient, TEST_ENTITY_ID);
  });

  it('returns error when mapSettingToApiUpdate returns null (unknown setting)', async () => {
    mockMapSettingToApiUpdate.mockReturnValueOnce(null);

    const handler = createSettingsUpdateHandler(TEST_ENTITY_ID, TEST_CONFIG);
    const result = await handler(mockInteraction, mockSession, 'bogus-setting', 'value');

    expect(result).toEqual({ success: false, error: 'Unknown setting' });
    expect(mockPatchFn).not.toHaveBeenCalled();
    expect(mockResolveFn).not.toHaveBeenCalled();
  });

  it('returns error when PATCH call fails', async () => {
    mockPatchFn.mockResolvedValueOnce({ ok: false, status: 500, error: 'Server error' });

    const handler = createSettingsUpdateHandler(TEST_ENTITY_ID, TEST_CONFIG);
    const result = await handler(mockInteraction, mockSession, 'maxMessages', 50);

    expect(result).toEqual({ success: false, error: 'Server error' });
    // Should not have called resolve endpoint
    expect(mockResolveFn).not.toHaveBeenCalled();
  });

  it('returns error when resolve call fails after successful PATCH', async () => {
    mockPatchFn.mockResolvedValueOnce({ ok: true, status: 200, data: {} });
    mockResolveFn.mockResolvedValueOnce({ ok: false, status: 500, error: 'Resolve error' });

    const handler = createSettingsUpdateHandler(TEST_ENTITY_ID, TEST_CONFIG);
    const result = await handler(mockInteraction, mockSession, 'maxMessages', 50);

    expect(result.success).toBe(false);
    expect(result).toMatchObject({ error: 'Failed to fetch updated settings' });
  });

  it('handles unexpected exceptions thrown from patchFn', async () => {
    mockPatchFn.mockRejectedValueOnce(new Error('Network down'));

    const handler = createSettingsUpdateHandler(TEST_ENTITY_ID, TEST_CONFIG);
    const result = await handler(mockInteraction, mockSession, 'maxMessages', 50);

    expect(result).toEqual({ success: false, error: 'Failed to update setting' });
  });

  it('returns newData derived from the configured sourceTier', async () => {
    mockPatchFn.mockResolvedValueOnce({ ok: true, status: 200, data: {} });
    mockResolveFn.mockResolvedValueOnce({ ok: true, status: 200, data: fullResolvedCascade });

    const handler = createSettingsUpdateHandler(TEST_ENTITY_ID, TEST_CONFIG);
    const result = await handler(mockInteraction, mockSession, 'maxMessages', 50);

    expect(result.success).toBe(true);
    // sourceTier was 'personality', so maxMessages (source: 'personality') should be local
    expect(result.newData?.maxMessages.localValue).toBe(25);
  });
});
