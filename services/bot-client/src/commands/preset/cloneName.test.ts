/**
 * Tests for Preset Clone Name Utilities
 *
 * `generateClonedName` and `createClonedPreset` (with the name-collision
 * retry driver). Kept narrow: the integration-level retry behavior is
 * already exercised through `handleCloneButton` in dashboard.test.ts —
 * this file tests the pure extraction directly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GatewayApiError } from '../../utils/userGatewayClient.js';
import type { FlattenedPresetData } from './config.js';

const mockCreatePreset = vi.fn();
vi.mock('./api.js', () => ({
  createPreset: (...args: unknown[]) => mockCreatePreset(...args),
}));

// Imported after the mock so the factory resolves before module load.
const { generateClonedName, createClonedPreset, MAX_CLONE_NAME_RETRIES } =
  await import('./cloneName.js');

// Cast: `createClonedPreset` only reads name / model / provider / description /
// visionModel off the source, but FlattenedPresetData requires ~20 fields. The
// rest are irrelevant to this test file and would add noise.
const sourceData = {
  id: 'preset-123',
  name: 'My Preset',
  model: 'anthropic/claude-sonnet-4',
  provider: 'openrouter',
  isGlobal: false,
  isOwned: true,
} as unknown as FlattenedPresetData;

beforeEach(() => {
  mockCreatePreset.mockReset();
});

describe('generateClonedName', () => {
  it('appends "(Copy)" to an unsuffixed name', () => {
    expect(generateClonedName('My Preset')).toBe('My Preset (Copy)');
  });

  it('bumps "(Copy)" to "(Copy 2)"', () => {
    expect(generateClonedName('My Preset (Copy)')).toBe('My Preset (Copy 2)');
  });

  it('bumps "(Copy N)" to "(Copy N+1)"', () => {
    expect(generateClonedName('My Preset (Copy 5)')).toBe('My Preset (Copy 6)');
  });

  it('strips multiple stacked suffixes and keeps the max seen number', () => {
    // "My Preset (Copy 5) (Copy)" — max(5, 1) = 5 → next is 6
    expect(generateClonedName('My Preset (Copy 5) (Copy)')).toBe('My Preset (Copy 6)');
  });

  it('trims trailing whitespace when stripping suffixes', () => {
    expect(generateClonedName('My Preset (Copy)   ')).toBe('My Preset (Copy 2)');
  });

  it('trims trailing whitespace on unsuffixed names before appending (Copy)', () => {
    // Latent inconsistency before PR #824 R3 fix: the no-suffix branch
    // didn't call .trim() on originalName, which produced "Preset    (Copy)"
    // for a trailing-whitespace input. Preset names are gateway-validated
    // so this never fired in practice, but the behavior is now consistent
    // with the suffix-present branch.
    expect(generateClonedName('My Preset   ')).toBe('My Preset (Copy)');
  });
});

describe('createClonedPreset', () => {
  it('returns the created preset on first-attempt success', async () => {
    const resultPreset = { id: 'new-id', name: 'My Preset (Copy)' };
    mockCreatePreset.mockResolvedValueOnce(resultPreset);

    const result = await createClonedPreset(sourceData, 'user-1');

    expect(result).toBe(resultPreset);
    expect(mockCreatePreset).toHaveBeenCalledTimes(1);
    expect(mockCreatePreset).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My Preset (Copy)' }),
      'user-1'
    );
  });

  it('bumps the suffix and retries on NAME_COLLISION', async () => {
    const resultPreset = { id: 'new-id', name: 'My Preset (Copy 2)' };
    mockCreatePreset
      .mockRejectedValueOnce(new GatewayApiError('collision', 400, 'NAME_COLLISION'))
      .mockResolvedValueOnce(resultPreset);

    const result = await createClonedPreset(sourceData, 'user-1');

    expect(result).toBe(resultPreset);
    expect(mockCreatePreset).toHaveBeenCalledTimes(2);
    expect(mockCreatePreset).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ name: 'My Preset (Copy)' }),
      'user-1'
    );
    expect(mockCreatePreset).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ name: 'My Preset (Copy 2)' }),
      'user-1'
    );
  });

  it('propagates GatewayApiErrors with no sub-code immediately', async () => {
    // Unknown gateway error path: GatewayApiError is constructed without a
    // code argument (e.g. the response body didn't include one). Must
    // propagate — don't retry.
    mockCreatePreset.mockRejectedValueOnce(new GatewayApiError('Bad request', 400));

    await expect(createClonedPreset(sourceData, 'user-1')).rejects.toThrow('Bad request');
    expect(mockCreatePreset).toHaveBeenCalledTimes(1);
  });

  it('propagates plain Errors immediately (not GatewayApiError)', async () => {
    mockCreatePreset.mockRejectedValueOnce(new Error('network blip'));

    await expect(createClonedPreset(sourceData, 'user-1')).rejects.toThrow('network blip');
    expect(mockCreatePreset).toHaveBeenCalledTimes(1);
  });

  it('rethrows the last collision error after exhausting MAX_CLONE_NAME_RETRIES', async () => {
    const collision = new GatewayApiError('still colliding', 400, 'NAME_COLLISION');
    mockCreatePreset.mockRejectedValue(collision);

    await expect(createClonedPreset(sourceData, 'user-1')).rejects.toBe(collision);
    expect(mockCreatePreset).toHaveBeenCalledTimes(MAX_CLONE_NAME_RETRIES);
  });
});
