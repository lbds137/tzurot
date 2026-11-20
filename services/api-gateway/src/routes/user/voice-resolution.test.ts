/**
 * Tests for /user/voice-resolution route. Mocks TtsConfigResolver,
 * SttResolver, and fetchAllTzurotVoices at the boundary so we only validate
 * the route's orchestration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, RequestHandler, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { asRouteHandler, stubRouteResolvers } from '../../test/shared-route-test-utils.js';
import type { RouteDeps } from '../routeDeps.js';

vi.mock('../../services/AuthMiddleware.js', () => ({
  requireUserAuth: () => (_req: Request, _res: Response, next: () => void) => next(),
  requireProvisionedUser: () => (_req: Request, _res: Response, next: () => void) => next(),
}));
vi.mock('../../utils/asyncHandler.js', () => ({
  asyncHandler: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}));
vi.mock('../../utils/resolveProvisionedUserId.js', () => ({
  resolveProvisionedUserId: vi.fn(() => 'user-uuid-1'),
}));

const mockResolveAudioProviderKeys = vi.fn();
vi.mock('../../utils/audioProviderKeyResolver.js', () => ({
  resolveAudioProviderKeys: (...args: unknown[]) => mockResolveAudioProviderKeys(...args),
}));

const mockFetchAllTzurotVoices = vi.fn();
vi.mock('./voices.js', () => ({
  fetchAllTzurotVoices: (...args: unknown[]) => mockFetchAllTzurotVoices(...args),
}));

const mockResolveConfig = vi.fn();
const mockResolveStt = vi.fn();
const mockResolveOverrides = vi.fn();
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

vi.mock('@tzurot/config-resolver', () => {
  class FakeTtsConfigResolver {
    resolveConfig(...args: unknown[]) {
      return mockResolveConfig(...args);
    }
  }
  class FakeSttResolver {
    resolveProvider(...args: unknown[]) {
      return mockResolveStt(...args);
    }
  }
  return {
    TtsConfigResolver: FakeTtsConfigResolver,
    SttResolver: FakeSttResolver,
  };
});

const { handleGetVoiceResolution } = await import('./voice-resolution.js');

function makeMockRes() {
  const json = vi.fn();
  const status = vi.fn().mockReturnThis();
  return { res: { status, json } as unknown as Response, json, status };
}
function makeMockReq(query: Record<string, unknown> = {}): Request {
  return {
    userId: '111111111111111111',
    params: {},
    body: {},
    query,
  } as unknown as Request;
}

const VALID_PERSONALITY_ID = '11111111-1111-4111-8111-111111111111';

const mockPrisma = {
  personality: { findFirst: vi.fn() },
  user: { findUnique: vi.fn() },
};

/** Build one bare handler with the mock deps — the shape mounts.ts registers. */
function buildHandler(handler: (deps: RouteDeps) => RequestHandler) {
  const resolvers = stubRouteResolvers();
  // Route the cascade-resolver seam through the test-local mock so the
  // Voice Response Mode resolution is assertable.
  const cascadeResolver = {
    ...resolvers.cascadeResolver,
    resolveOverrides: mockResolveOverrides,
  } as unknown as RouteDeps['cascadeResolver'];
  const deps: RouteDeps = { ...resolvers, cascadeResolver, prisma: mockPrisma as never };
  return { handler: asRouteHandler(handler(deps)) };
}

describe('user/voice-resolution route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default cascade resolution: hardcoded tier supplies the voice mode.
    mockResolveOverrides.mockResolvedValue({
      voiceResponseMode: 'always',
      sources: { voiceResponseMode: 'hardcoded' },
    });
  });

  it('returns the resolved tts/stt/voices payload on the happy path', async () => {
    mockPrisma.personality.findFirst.mockResolvedValue({
      id: VALID_PERSONALITY_ID,
      name: 'Alice',
      voiceEnabled: true,
    });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-uuid-1' });
    mockResolveConfig.mockResolvedValue({
      config: { provider: 'mistral' },
      source: 'user-default',
      configName: 'mistral-default',
    });
    mockResolveStt.mockResolvedValue({ provider: 'mistral', source: 'tts-derived' });
    mockResolveAudioProviderKeys.mockResolvedValue({
      keys: new Map([['mistral', 'sk-test']]),
    });
    mockFetchAllTzurotVoices.mockResolvedValue({
      voices: [
        { provider: 'mistral', voiceId: 'v1', name: 'tzu_alice', slug: 'alice' },
        { provider: 'mistral', voiceId: 'v2', name: 'tzu_bob', slug: 'bob' },
      ],
      totalVoicesByProvider: new Map([['mistral', 5]]),
      warnings: [],
    });

    const { handler } = buildHandler(handleGetVoiceResolution);
    const { res, json, status } = makeMockRes();

    await handler(makeMockReq({ personalityId: VALID_PERSONALITY_ID }), res);

    expect(status).toHaveBeenCalledWith(StatusCodes.OK);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        voiceEnabled: true,
        voiceResponseMode: { value: 'always', source: 'hardcoded' },
        tts: expect.objectContaining({ provider: 'mistral', source: 'user-default' }),
        stt: expect.objectContaining({ provider: 'mistral', source: 'tts-derived' }),
        voices: expect.objectContaining({
          tzurotCount: 2,
          totalVoices: 5,
          previewSlugs: ['alice', 'bob'],
        }),
      })
    );
  });

  it('resolves Voice Response Mode through the cascade resolver, honoring channelId', async () => {
    mockPrisma.personality.findFirst.mockResolvedValue({
      id: VALID_PERSONALITY_ID,
      name: 'Alice',
      voiceEnabled: false,
    });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-uuid-1' });
    mockResolveOverrides.mockResolvedValue({
      voiceResponseMode: 'voice-only',
      sources: { voiceResponseMode: 'channel' },
    });

    const { handler } = buildHandler(handleGetVoiceResolution);
    const { res, json } = makeMockRes();

    await handler(
      makeMockReq({ personalityId: VALID_PERSONALITY_ID, channelId: '222222222222222222' }),
      res
    );

    expect(mockResolveOverrides).toHaveBeenCalledWith(
      '111111111111111111',
      VALID_PERSONALITY_ID,
      '222222222222222222'
    );
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        voiceEnabled: false,
        voiceResponseMode: { value: 'voice-only', source: 'channel' },
      })
    );
  });

  it('rejects a non-snowflake channelId before the handler (manifest query validation)', async () => {
    // The manifest is the ONLY validation layer for this query — the def's
    // channelId regex runs in withManifestInput, so a malformed id 400s
    // without touching Prisma.
    const { handler } = buildHandler(handleGetVoiceResolution);
    const { res, json, status } = makeMockRes();

    await handler(
      makeMockReq({ personalityId: VALID_PERSONALITY_ID, channelId: 'not-a-snowflake' }),
      res
    );

    expect(status).toHaveBeenCalledWith(StatusCodes.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('channelId') })
    );
    expect(mockPrisma.personality.findFirst).not.toHaveBeenCalled();
  });

  it('STT resolution is delegated to SttResolver (returns whatever it returns)', async () => {
    mockPrisma.personality.findFirst.mockResolvedValue({
      id: VALID_PERSONALITY_ID,
      name: 'Alice',
      voiceEnabled: true,
    });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-uuid-1' });
    mockResolveConfig.mockResolvedValue({
      config: { provider: 'self-hosted' },
      source: 'hardcoded',
    });
    mockResolveStt.mockResolvedValue({ provider: 'voice-engine', source: 'hardcoded' });
    mockResolveAudioProviderKeys.mockResolvedValue({ keys: new Map() });

    const { handler } = buildHandler(handleGetVoiceResolution);
    const { res, json } = makeMockRes();

    await handler(makeMockReq({ personalityId: VALID_PERSONALITY_ID }), res);

    expect(mockResolveStt).toHaveBeenCalledWith('111111111111111111');
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        stt: { provider: 'voice-engine', source: 'hardcoded' },
      })
    );
  });

  it('returns empty voice summary when user has no audio provider keys', async () => {
    mockPrisma.personality.findFirst.mockResolvedValue({
      id: VALID_PERSONALITY_ID,
      name: 'Alice',
      voiceEnabled: true,
    });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-uuid-1' });
    mockResolveConfig.mockResolvedValue({
      config: { provider: 'self-hosted' },
      source: 'hardcoded',
    });
    mockResolveStt.mockResolvedValue({ provider: 'voice-engine', source: 'hardcoded' });
    mockResolveAudioProviderKeys.mockResolvedValue({ keys: new Map() });

    const { handler } = buildHandler(handleGetVoiceResolution);
    const { res, json } = makeMockRes();

    await handler(makeMockReq({ personalityId: VALID_PERSONALITY_ID }), res);

    expect(mockFetchAllTzurotVoices).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        voices: { tzurotCount: 0, totalVoices: 0, previewSlugs: [] },
      })
    );
  });

  it('returns 404 when personality is missing', async () => {
    mockPrisma.personality.findFirst.mockResolvedValue(null);

    const { handler } = buildHandler(handleGetVoiceResolution);
    const { res, status } = makeMockRes();

    await handler(makeMockReq({ personalityId: VALID_PERSONALITY_ID }), res);

    expect(status).toHaveBeenCalledWith(404);
  });

  it('rejects non-uuid personalityId via Zod', async () => {
    const { handler } = buildHandler(handleGetVoiceResolution);
    const { res, status } = makeMockRes();

    await handler(makeMockReq({ personalityId: 'not-a-uuid' }), res);

    expect(status).toHaveBeenCalledWith(400);
    expect(mockPrisma.personality.findFirst).not.toHaveBeenCalled();
  });
});
