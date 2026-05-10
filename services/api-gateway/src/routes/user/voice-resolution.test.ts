/**
 * Tests for /user/voice-resolution route — exercises the inline cascade
 * computation directly. The TtsConfigResolver and fetchAllTzurotVoices
 * dependencies are mocked at the boundary so we only validate the
 * route's orchestration + cascade ordering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, Router } from 'express';
import { StatusCodes } from 'http-status-codes';

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
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  class FakeTtsConfigResolver {
    resolveConfig(...args: unknown[]) {
      return mockResolveConfig(...args);
    }
  }
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    TtsConfigResolver: FakeTtsConfigResolver,
  };
});

const { createVoiceResolutionRoutes } = await import('./voice-resolution.js');

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

interface RouterLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: (req: Request, res: Response) => Promise<void> }>;
  };
}
function extractHandler(router: Router, method: string, path: string) {
  const stack = (router as unknown as { stack: RouterLayer[] }).stack;
  const layer = stack.find(
    l => l.route?.path === path && l.route?.methods[method.toLowerCase()] === true
  );
  if (!layer?.route) throw new Error(`Handler for ${method} ${path} not found`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

const VALID_PERSONALITY_ID = '11111111-1111-4111-8111-111111111111';

const mockPrisma = {
  personality: { findFirst: vi.fn() },
  user: { findUnique: vi.fn() },
};

function buildRouter() {
  return createVoiceResolutionRoutes(mockPrisma as never);
}

describe('user/voice-resolution route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the resolved tts/stt/voices payload on the happy path', async () => {
    mockPrisma.personality.findFirst.mockResolvedValue({
      id: VALID_PERSONALITY_ID,
      name: 'Alice',
      defaultTtsConfigLink: { ttsConfigId: 'tts-1' },
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      defaultProvider: null,
      defaultSttProviderId: null,
      personalityConfigs: [],
    });
    mockResolveConfig.mockResolvedValue({
      config: { provider: 'mistral' },
      source: 'user-default',
      configName: 'mistral-default',
    });
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

    const handler = extractHandler(buildRouter(), 'get', '/');
    const { res, json, status } = makeMockRes();

    await handler(makeMockReq({ personalityId: VALID_PERSONALITY_ID }), res);

    expect(status).toHaveBeenCalledWith(StatusCodes.OK);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
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

  it('STT cascade picks user-personality (Layer 1) over everything else', async () => {
    mockPrisma.personality.findFirst.mockResolvedValue({
      id: VALID_PERSONALITY_ID,
      name: 'Alice',
      defaultTtsConfigLink: null,
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      defaultProvider: 'mistral',
      defaultSttProviderId: 'mistral',
      personalityConfigs: [{ sttProviderId: 'voice-engine' }],
    });
    mockResolveConfig.mockResolvedValue({
      config: { provider: 'mistral' },
      source: 'user-default',
    });
    mockResolveAudioProviderKeys.mockResolvedValue({ keys: new Map() });

    const handler = extractHandler(buildRouter(), 'get', '/');
    const { res, json } = makeMockRes();

    await handler(makeMockReq({ personalityId: VALID_PERSONALITY_ID }), res);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        stt: { provider: 'voice-engine', source: 'user-personality' },
      })
    );
  });

  it('STT cascade falls through to hardcoded when nothing else applies', async () => {
    mockPrisma.personality.findFirst.mockResolvedValue({
      id: VALID_PERSONALITY_ID,
      name: 'Alice',
      defaultTtsConfigLink: null,
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      defaultProvider: null,
      defaultSttProviderId: null,
      personalityConfigs: [],
    });
    mockResolveConfig.mockResolvedValue({
      config: { provider: 'self-hosted' },
      source: 'hardcoded',
    });
    mockResolveAudioProviderKeys.mockResolvedValue({ keys: new Map() });

    const handler = extractHandler(buildRouter(), 'get', '/');
    const { res, json } = makeMockRes();

    await handler(makeMockReq({ personalityId: VALID_PERSONALITY_ID }), res);

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
      defaultTtsConfigLink: null,
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      defaultProvider: null,
      defaultSttProviderId: null,
      personalityConfigs: [],
    });
    mockResolveConfig.mockResolvedValue({
      config: { provider: 'self-hosted' },
      source: 'hardcoded',
    });
    mockResolveAudioProviderKeys.mockResolvedValue({ keys: new Map() });

    const handler = extractHandler(buildRouter(), 'get', '/');
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
    mockPrisma.user.findUnique.mockResolvedValue({
      defaultProvider: null,
      defaultSttProviderId: null,
      personalityConfigs: [],
    });

    const handler = extractHandler(buildRouter(), 'get', '/');
    const { res, status } = makeMockRes();

    await handler(makeMockReq({ personalityId: VALID_PERSONALITY_ID }), res);

    expect(status).toHaveBeenCalledWith(404);
  });

  it('rejects non-uuid personalityId via Zod', async () => {
    const handler = extractHandler(buildRouter(), 'get', '/');
    const { res, status } = makeMockRes();

    await handler(makeMockReq({ personalityId: 'not-a-uuid' }), res);

    expect(status).toHaveBeenCalledWith(400);
    expect(mockPrisma.personality.findFirst).not.toHaveBeenCalled();
  });
});
