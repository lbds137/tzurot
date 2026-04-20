/**
 * Tests for Preset Clone Driver
 *
 * `generateClonedName` lives in `@tzurot/common-types` now — its unit tests
 * are there. This file narrowly tests `createClonedPreset`: the thin wrapper
 * that asks the server to auto-bump the (Copy N) suffix on collision. The
 * server now owns the retry loop; previously this file tested a client-side
 * retry that looped up to 10 times on NAME_COLLISION, which has been removed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GatewayApiError } from '../../utils/userGatewayClient.js';
import type { GatewayUser } from '../../utils/userGatewayClient.js';
import type { FlattenedPresetData } from './config.js';

function mkUser(discordId = 'user-1'): GatewayUser {
  return { discordId, username: 'test-user', displayName: 'Test User' };
}

const mockCreatePreset = vi.fn();
vi.mock('./api.js', () => ({
  createPreset: (...args: unknown[]) => mockCreatePreset(...args),
}));

// Imported after the mock so the factory resolves before module load.
const { generateClonedName, createClonedPreset } = await import('./cloneName.js');

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

describe('generateClonedName (re-exported from common-types)', () => {
  // Narrow smoke test — the full suite lives in
  // `packages/common-types/src/utils/presetCloneName.test.ts`. This file
  // keeps a couple of cases to pin the re-export wiring.
  it('appends "(Copy)" to an unsuffixed name', () => {
    expect(generateClonedName('My Preset')).toBe('My Preset (Copy)');
  });

  it('bumps "(Copy)" to "(Copy 2)"', () => {
    expect(generateClonedName('My Preset (Copy)')).toBe('My Preset (Copy 2)');
  });
});

describe('createClonedPreset', () => {
  it('makes a SINGLE createPreset call with autoSuffixOnCollision: true', async () => {
    // Server owns the suffix-bumping loop now. Client sends one request and
    // relies on the server to pick a non-colliding name internally.
    const resultPreset = { id: 'new-id', name: 'My Preset (Copy)' };
    mockCreatePreset.mockResolvedValueOnce(resultPreset);

    const user = mkUser();
    const result = await createClonedPreset(sourceData, user);

    expect(result).toBe(resultPreset);
    expect(mockCreatePreset).toHaveBeenCalledTimes(1);
    expect(mockCreatePreset).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'My Preset (Copy)',
        autoSuffixOnCollision: true,
      }),
      user
    );
  });

  it('propagates NAME_COLLISION errors directly (no client-side retry)', async () => {
    // Name-bumping is server-owned. A NAME_COLLISION reaching the client means
    // the server already exhausted MAX_CLONE_NAME_ATTEMPTS — propagate, don't
    // retry (retrying would just re-hit the same server-side ceiling).
    const collision = new GatewayApiError('still colliding', 400, 'NAME_COLLISION');
    mockCreatePreset.mockRejectedValueOnce(collision);

    await expect(createClonedPreset(sourceData, mkUser())).rejects.toBe(collision);
    expect(mockCreatePreset).toHaveBeenCalledTimes(1);
  });

  it('propagates GatewayApiErrors with no sub-code immediately', async () => {
    mockCreatePreset.mockRejectedValueOnce(new GatewayApiError('Bad request', 400));

    await expect(createClonedPreset(sourceData, mkUser())).rejects.toThrow('Bad request');
    expect(mockCreatePreset).toHaveBeenCalledTimes(1);
  });

  it('propagates plain Errors immediately', async () => {
    mockCreatePreset.mockRejectedValueOnce(new Error('network blip'));

    await expect(createClonedPreset(sourceData, mkUser())).rejects.toThrow('network blip');
    expect(mockCreatePreset).toHaveBeenCalledTimes(1);
  });
});
