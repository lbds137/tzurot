/**
 * Tests for the BYOK access validator at /voice tts set/default.
 *
 * Locks the three branches the council called out:
 *   - self-hosted always allowed
 *   - BYOK provider with no keys → blocks
 *   - transient errors → fail-open
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeOk, makeErr, asUserClient } from '../../../test/gatewayClientStubs.js';

const stub = {
  listUserTtsConfigs: vi.fn(),
  listVoices: vi.fn(),
};

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

const { checkTtsByokAccess } = await import('./guestModeValidation.js');

function makeContext() {
  return {
    user: { id: 'discord-user-1' },
    editReply: vi.fn(),
  };
}

const baseConfig = {
  id: 'c1',
  name: 'test-config',
  description: null,
  modelId: null,
  isGlobal: true,
  isDefault: false,
  isFreeDefault: false,
  isOwned: false,
  permissions: { canEdit: false, canDelete: false },
};

describe('checkTtsByokAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stub.listUserTtsConfigs.mockReset();
    stub.listVoices.mockReset();
  });

  it('allows self-hosted configs without checking keys', async () => {
    stub.listUserTtsConfigs.mockResolvedValue(
      makeOk({
        configs: [{ ...baseConfig, provider: 'self-hosted', name: 'kyutai-self-hosted' }],
      })
    );
    const context = makeContext();

    const result = await checkTtsByokAccess(context as never, 'c1', asUserClient(stub));

    expect(result).toEqual({ blocked: false, reason: 'self-hosted' });
    // Should NOT have called listVoices since self-hosted bypasses
    expect(stub.listVoices).not.toHaveBeenCalled();
    expect(stub.listUserTtsConfigs).toHaveBeenCalled();
  });

  it('allows mistral provider without probing listVoices (per-provider-aware gate)', async () => {
    // listVoices is the ElevenLabs voices endpoint and would 404 for any
    // user without ElevenLabs setup — even users who have a Mistral key.
    // The fix loosens the gate: non-elevenlabs configs always pass at
    // command time and the ai-worker dispatcher's isAvailable() enforces
    // at synthesis. Verify the probe is NOT called for mistral.
    stub.listUserTtsConfigs.mockResolvedValue(
      makeOk({
        configs: [{ ...baseConfig, provider: 'mistral', name: 'mistral-voxtral-mini' }],
      })
    );
    const context = makeContext();

    const result = await checkTtsByokAccess(context as never, 'c1', asUserClient(stub));

    // 'check-skipped' (not 'has-key') is the correct audit-trail signal:
    // no verification ran, the decision was deferred to ai-worker's
    // isAvailable() at synthesis. Distinguishes "verified vs deferred"
    // for log analysis.
    expect(result).toEqual({ blocked: false, reason: 'check-skipped' });
    expect(stub.listVoices).not.toHaveBeenCalled();
  });

  it('blocks ElevenLabs provider when listVoices returns 404 (no key)', async () => {
    stub.listUserTtsConfigs.mockResolvedValue(
      makeOk({
        configs: [{ ...baseConfig, provider: 'elevenlabs', name: 'elevenlabs-multilingual-v2' }],
      })
    );
    stub.listVoices.mockResolvedValue(makeErr(404, 'NOT_FOUND'));
    const context = makeContext();

    const result = await checkTtsByokAccess(context as never, 'c1', asUserClient(stub));

    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('blocked-byok');
    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              description: expect.stringContaining('elevenlabs'),
            }),
          }),
        ],
      })
    );
  });

  it('fails open on transient listUserTtsConfigs error', async () => {
    stub.listUserTtsConfigs.mockResolvedValue(makeErr(500, 'INTERNAL_ERROR'));
    const context = makeContext();

    const result = await checkTtsByokAccess(context as never, 'c1', asUserClient(stub));

    expect(result).toEqual({ blocked: false, reason: 'check-failed' });
  });

  it('fails open on transient listVoices error for elevenlabs (non-404)', async () => {
    stub.listUserTtsConfigs.mockResolvedValue(
      makeOk({
        configs: [{ ...baseConfig, provider: 'elevenlabs', name: 'elevenlabs-multilingual-v2' }],
      })
    );
    stub.listVoices.mockResolvedValue(makeErr(500, 'INTERNAL_ERROR'));
    const context = makeContext();

    const result = await checkTtsByokAccess(context as never, 'c1', asUserClient(stub));

    expect(result.blocked).toBe(false);
    expect(result.reason).toBe('check-failed');
  });

  it('fails open when configId is not in the user-visible list', async () => {
    stub.listUserTtsConfigs.mockResolvedValue(makeOk({ configs: [] }));
    const context = makeContext();

    const result = await checkTtsByokAccess(context as never, 'c-missing', asUserClient(stub));

    expect(result).toEqual({ blocked: false, reason: 'no-config-found' });
  });

  it('allows elevenlabs provider when user has keys', async () => {
    stub.listUserTtsConfigs.mockResolvedValue(
      makeOk({
        configs: [{ ...baseConfig, provider: 'elevenlabs', name: 'elevenlabs-multilingual-v2' }],
      })
    );
    stub.listVoices.mockResolvedValue(makeOk({ totalVoices: 5 }));
    const context = makeContext();

    const result = await checkTtsByokAccess(context as never, 'c1', asUserClient(stub));
    expect(result).toEqual({ blocked: false, reason: 'has-key' });
  });
});
