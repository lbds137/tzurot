/**
 * Tests for the BYOK access validator at /settings tts set/default.
 *
 * Locks the three branches the council called out:
 *   - self-hosted always allowed
 *   - BYOK provider with no keys → blocks
 *   - transient errors → fail-open
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCallGatewayApi } = vi.hoisted(() => ({
  mockCallGatewayApi: vi.fn(),
}));

vi.mock('../../../utils/userGatewayClient.js', () => ({
  callGatewayApi: mockCallGatewayApi,
  toGatewayUser: vi.fn(user => ({ id: user.id })),
}));

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
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
  });

  it('allows self-hosted configs without checking keys', async () => {
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: { configs: [{ ...baseConfig, provider: 'self-hosted', name: 'kyutai-self-hosted' }] },
    });
    const context = makeContext();

    const result = await checkTtsByokAccess(context as never, 'c1', {
      id: 'discord-user-1',
    } as never);

    expect(result).toEqual({ blocked: false, reason: 'self-hosted' });
    // Should NOT have called /user/voices since self-hosted bypasses
    expect(mockCallGatewayApi).toHaveBeenCalledTimes(1);
    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/tts-config', expect.any(Object));
  });

  it('allows mistral provider without probing /user/voices (per-provider-aware gate)', async () => {
    // /user/voices is the ElevenLabs voices endpoint and would 404 for any
    // user without ElevenLabs setup — even users who have a Mistral key.
    // The fix loosens the gate: non-elevenlabs configs always pass at
    // command time and the ai-worker dispatcher's isAvailable() enforces
    // at synthesis. Verify the probe is NOT called for mistral.
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: { configs: [{ ...baseConfig, provider: 'mistral', name: 'mistral-voxtral-mini' }] },
    });
    const context = makeContext();

    const result = await checkTtsByokAccess(context as never, 'c1', {
      id: 'discord-user-1',
    } as never);

    // 'check-skipped' (not 'has-key') is the correct audit-trail signal:
    // no verification ran, the decision was deferred to ai-worker's
    // isAvailable() at synthesis. Distinguishes "verified vs deferred"
    // for log analysis.
    expect(result).toEqual({ blocked: false, reason: 'check-skipped' });
    // Only the /user/tts-config call — no /user/voices probe
    expect(mockCallGatewayApi).toHaveBeenCalledTimes(1);
    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/tts-config', expect.any(Object));
  });

  it('blocks ElevenLabs provider when /user/voices returns 404 (no key)', async () => {
    mockCallGatewayApi
      .mockResolvedValueOnce({
        ok: true,
        data: {
          configs: [{ ...baseConfig, provider: 'elevenlabs', name: 'elevenlabs-multilingual-v2' }],
        },
      })
      .mockResolvedValueOnce({ ok: false, status: 404, error: 'NOT_FOUND' });
    const context = makeContext();

    const result = await checkTtsByokAccess(context as never, 'c1', {
      id: 'discord-user-1',
    } as never);

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

  it('fails open on transient /user/tts-config error', async () => {
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: false,
      status: 500,
      error: 'INTERNAL_ERROR',
    });
    const context = makeContext();

    const result = await checkTtsByokAccess(context as never, 'c1', {
      id: 'discord-user-1',
    } as never);

    expect(result).toEqual({ blocked: false, reason: 'check-failed' });
  });

  it('fails open on transient /user/voices error for elevenlabs (non-404)', async () => {
    mockCallGatewayApi
      .mockResolvedValueOnce({
        ok: true,
        data: {
          configs: [{ ...baseConfig, provider: 'elevenlabs', name: 'elevenlabs-multilingual-v2' }],
        },
      })
      .mockResolvedValueOnce({ ok: false, status: 500, error: 'INTERNAL_ERROR' });
    const context = makeContext();

    const result = await checkTtsByokAccess(context as never, 'c1', {
      id: 'discord-user-1',
    } as never);

    expect(result.blocked).toBe(false);
    expect(result.reason).toBe('check-failed');
  });

  it('fails open when configId is not in the user-visible list', async () => {
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: { configs: [] },
    });
    const context = makeContext();

    const result = await checkTtsByokAccess(context as never, 'c-missing', {
      id: 'discord-user-1',
    } as never);

    expect(result).toEqual({ blocked: false, reason: 'no-config-found' });
  });

  it('allows elevenlabs provider when user has keys', async () => {
    mockCallGatewayApi
      .mockResolvedValueOnce({
        ok: true,
        data: {
          configs: [{ ...baseConfig, provider: 'elevenlabs', name: 'elevenlabs-multilingual-v2' }],
        },
      })
      .mockResolvedValueOnce({ ok: true, data: { totalVoices: 5 } });
    const context = makeContext();

    const result = await checkTtsByokAccess(context as never, 'c1', {
      id: 'discord-user-1',
    } as never);
    expect(result).toEqual({ blocked: false, reason: 'has-key' });
  });
});
