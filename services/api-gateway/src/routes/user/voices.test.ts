/**
 * Tests for Voice Management Routes (provider-agnostic)
 *
 * The routes now fan out across all audio providers (ElevenLabs + Mistral)
 * a user has BYOK keys for. Each test case names which provider(s) the
 * mocked user has, and the fetch mock distinguishes calls by URL prefix.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createVoicesRoutes, describeProviderError } from './voices.js';
import { ErrorCode } from '../../types.js';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';

// Mock common-types
vi.mock('@tzurot/common-types/utils/encryption', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/encryption')>(
    '@tzurot/common-types/utils/encryption'
  );
  return {
    ...actual,
    decryptApiKey: vi.fn().mockImplementation(({ content }: { content: string }) => {
      // Return a different key per provider so tests can verify which key
      // got passed to which API call.
      if (content === 'el-content') return 'test-elevenlabs-key';
      if (content === 'mi-content') return 'test-mistral-key';
      return 'unknown-key';
    }),
  };
});

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

// Mock auth middleware
vi.mock('../../services/AuthMiddleware.js', () => ({
  requireUserAuth: () => (req: any, _res: any, next: any) => {
    req.userId = 'discord-user-123';
    next();
  },
  requireProvisionedUser: () => (_req: any, _res: any, next: any) => {
    next();
  },
}));

// Mock fetch — tests dispatch on URL prefix to simulate the right provider.
const mockFetch = vi.fn();
global.fetch = mockFetch;

import { AIProvider } from '@tzurot/common-types/constants/ai';
import { decryptApiKey } from '@tzurot/common-types/utils/encryption';
import { stubRouteResolvers } from '../../test/shared-route-test-utils.js';

describe('Voice Management Routes', () => {
  let app: express.Express;

  const mockPrisma = {
    user: {
      findFirst: vi.fn(),
    },
  } as unknown as PrismaClient;

  /** ElevenLabs voice list mock — only `tzurot-*` names are returned by the
   *  filter; the others test that the prefix filter works. */
  const elevenLabsVoicesResponse = {
    voices: [
      { voice_id: 'el-voice-1', name: 'tzurot-alice', category: 'cloned' },
      { voice_id: 'el-voice-2', name: 'tzurot-bob', category: 'cloned' },
      { voice_id: 'el-voice-3', name: 'my-custom-voice', category: 'cloned' },
      { voice_id: 'el-voice-4', name: 'premade-voice', category: 'premade' },
    ],
  };

  /** Mistral voice list mock — pagination shape (single page). */
  const mistralVoicesResponse = {
    items: [
      { id: 'mi-voice-1', name: 'tzurot-charlie', user_id: 'mi-user' },
      { id: 'mi-voice-2', name: 'tzurot-alice', user_id: 'mi-user' }, // same slug as elevenlabs!
      { id: 'mi-voice-3', name: 'random-other', user_id: 'mi-user' },
    ],
    total_pages: 1,
  };

  /** Helper: configure prisma mock to return a user with the given audio
   *  provider keys. Keys are encrypted-row records that decryptApiKey
   *  resolves based on `content` field (see top-level mock). */
  function userWithKeys(providers: ('elevenlabs' | 'mistral')[]): void {
    const apiKeys = providers.map(p => ({
      provider: p === 'elevenlabs' ? AIProvider.ElevenLabs : AIProvider.Mistral,
      iv: `${p.slice(0, 2)}-iv`,
      content: `${p.slice(0, 2)}-content`,
      tag: `${p.slice(0, 2)}-tag`,
    }));
    (mockPrisma.user.findFirst as any).mockResolvedValue({
      id: 'user-uuid-123',
      apiKeys,
    });
  }

  /** Helper: dispatch a fetch mock based on URL — distinguishes ElevenLabs
   *  and Mistral calls so tests don't need to count call order across
   *  providers. */
  function setProviderFetchMocks(handlers: {
    elevenlabsList?: () => Response;
    elevenlabsGetVoice?: () => Response;
    elevenlabsDelete?: () => Response;
    mistralList?: () => Response;
    mistralGetVoice?: () => Response;
    mistralDelete?: () => Response;
  }): void {
    mockFetch.mockImplementation((url: string, init: RequestInit | undefined) => {
      const isDelete = init?.method === 'DELETE';
      // ElevenLabs base ends in /v1; Mistral base ends in /v1
      const isElevenLabs = url.includes('elevenlabs');
      const isMistral = url.includes('mistral');

      if (isMistral) {
        if (isDelete) return Promise.resolve(handlers.mistralDelete?.() ?? notFoundResponse());
        if (url.includes('/voices/') && !url.includes('?')) {
          // Single voice fetch (path /voices/:id with no query string)
          return Promise.resolve(handlers.mistralGetVoice?.() ?? notFoundResponse());
        }
        return Promise.resolve(handlers.mistralList?.() ?? notFoundResponse());
      }
      if (isElevenLabs) {
        if (isDelete) return Promise.resolve(handlers.elevenlabsDelete?.() ?? notFoundResponse());
        if (url.match(/\/voices\/[^/?]+$/)) {
          // Single voice fetch (path /voices/:id, no trailing slash, no query)
          return Promise.resolve(handlers.elevenlabsGetVoice?.() ?? notFoundResponse());
        }
        return Promise.resolve(handlers.elevenlabsList?.() ?? notFoundResponse());
      }
      return Promise.resolve(notFoundResponse());
    });
  }

  function jsonOk(body: unknown): Response {
    return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response;
  }
  function notFoundResponse(): Response {
    return { ok: false, status: 404, statusText: 'Not Found' } as unknown as Response;
  }

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/voices', createVoicesRoutes({ ...stubRouteResolvers(), prisma: mockPrisma }));

    // Default: user has ElevenLabs key only (mirrors the legacy single-provider
    // setup that pre-PR-3 was the only supported configuration).
    userWithKeys(['elevenlabs']);

    setProviderFetchMocks({
      elevenlabsList: () => jsonOk(elevenLabsVoicesResponse),
      mistralList: () => jsonOk(mistralVoicesResponse),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ===== GET / ============================================================

  describe('GET / - List voices', () => {
    it('returns tzurot-prefixed voices from ElevenLabs only when only that key is configured', async () => {
      userWithKeys(['elevenlabs']);

      const res = await request(app).get('/voices');

      expect(res.status).toBe(200);
      expect(res.body.voices).toHaveLength(2);
      expect(res.body.voices[0]).toMatchObject({
        provider: 'elevenlabs',
        voiceId: 'el-voice-1',
        name: 'tzurot-alice',
        slug: 'alice',
      });
      expect(res.body.tzurotCount).toBe(2);
      expect(res.body.totalVoices).toBe(4);
    });

    it('aggregates voices across both providers when both keys are configured', async () => {
      userWithKeys(['elevenlabs', 'mistral']);

      const res = await request(app).get('/voices');

      expect(res.status).toBe(200);
      expect(res.body.tzurotCount).toBe(4); // 2 elevenlabs + 2 mistral (filtered by prefix)
      const providers = res.body.voices.map((v: any) => v.provider);
      expect(providers).toContain('elevenlabs');
      expect(providers).toContain('mistral');
    });

    it('returns just Mistral voices when only Mistral key is configured', async () => {
      userWithKeys(['mistral']);

      const res = await request(app).get('/voices');

      expect(res.status).toBe(200);
      expect(res.body.tzurotCount).toBe(2); // 2 of 3 are tzurot-*
      expect(res.body.voices.every((v: any) => v.provider === 'mistral')).toBe(true);
    });

    it('returns 404 when user has NO audio provider keys configured', async () => {
      userWithKeys([]);

      const res = await request(app).get('/voices');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
      expect(res.body.message).toContain('audio provider API key');
    });

    it('returns 404 when user does not exist', async () => {
      (mockPrisma.user.findFirst as any).mockResolvedValue(null);

      const res = await request(app).get('/voices');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
    });

    it('skips a provider gracefully when its API rejects the key, surfacing a warning', async () => {
      userWithKeys(['elevenlabs', 'mistral']);
      setProviderFetchMocks({
        elevenlabsList: () => jsonOk(elevenLabsVoicesResponse),
        mistralList: () =>
          ({ ok: false, status: 401, statusText: 'Unauthorized' }) as unknown as Response,
      });

      const res = await request(app).get('/voices');

      // ElevenLabs voices still served; Mistral surfaced as a warning
      expect(res.status).toBe(200);
      expect(res.body.voices.every((v: any) => v.provider === 'elevenlabs')).toBe(true);
      expect(res.body.warnings).toEqual([
        { provider: 'mistral', message: 'API key invalid or expired' },
      ]);
    });

    it('omits warnings field entirely when all providers loaded cleanly', async () => {
      userWithKeys(['elevenlabs']);

      const res = await request(app).get('/voices');

      expect(res.status).toBe(200);
      expect(res.body.warnings).toBeUndefined();
    });

    it('classifies INTERNAL_ERROR as "Provider temporarily unavailable"', async () => {
      userWithKeys(['elevenlabs', 'mistral']);
      setProviderFetchMocks({
        elevenlabsList: () => jsonOk(elevenLabsVoicesResponse),
        mistralList: () =>
          ({ ok: false, status: 503, statusText: 'Service Unavailable' }) as unknown as Response,
      });

      const res = await request(app).get('/voices');

      expect(res.status).toBe(200);
      expect(res.body.warnings).toEqual([
        { provider: 'mistral', message: 'Provider temporarily unavailable' },
      ]);
    });
  });

  // ===== DELETE /:provider/:voiceId =======================================

  describe('DELETE /:provider/:voiceId - Delete a voice', () => {
    it('deletes an ElevenLabs tzurot-prefixed voice via the new route shape', async () => {
      userWithKeys(['elevenlabs']);
      setProviderFetchMocks({
        elevenlabsGetVoice: () =>
          jsonOk({ voice_id: 'el-voice-1', name: 'tzurot-alice', category: 'cloned' }),
        elevenlabsDelete: () => ({ ok: true, status: 200 }) as unknown as Response,
      });

      const res = await request(app).delete('/voices/elevenlabs/el-voice-1');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        deleted: true,
        provider: 'elevenlabs',
        voiceId: 'el-voice-1',
        slug: 'alice',
      });
    });

    it('deletes a Mistral tzurot-prefixed voice via the new route shape', async () => {
      userWithKeys(['mistral']);
      setProviderFetchMocks({
        mistralGetVoice: () => jsonOk({ id: 'mi-voice-1', name: 'tzurot-charlie', user_id: 'u' }),
        mistralDelete: () => ({ ok: true, status: 200 }) as unknown as Response,
      });

      const res = await request(app).delete('/voices/mistral/mi-voice-1');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        deleted: true,
        provider: 'mistral',
        voiceId: 'mi-voice-1',
        slug: 'charlie',
      });
    });

    it('rejects unknown provider segment', async () => {
      const res = await request(app).delete('/voices/openai/some-voice');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
      expect(res.body.message).toContain('openai');
    });

    it('rejects self-hosted provider segment (not in AudioProviderId)', async () => {
      // `self-hosted` is a valid TtsProviderId but intentionally NOT in
      // AudioProviderId — users don't manage voices in a self-hosted
      // account. This test pins the design: if AudioProviderId ever grows
      // to include 'self-hosted', this assertion fails and forces a
      // deliberate decision about voice-management semantics.
      const res = await request(app).delete('/voices/self-hosted/some-voice');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
      expect(res.body.message).toContain('self-hosted');
    });

    it('rejects malformed voiceId without calling provider APIs', async () => {
      const badId = 'invalid%20voice%21%23id';
      const res = await request(app).delete(`/voices/elevenlabs/${badId}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
      expect(res.body.message).toBe('Invalid voice ID format');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('rejects deleting from a provider the user has no key for', async () => {
      userWithKeys(['elevenlabs']);

      const res = await request(app).delete('/voices/mistral/mi-voice-1');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
      expect(res.body.message).toContain('mistral API key');
    });

    it('rejects deleting a non-tzurot voice (IDOR guard)', async () => {
      userWithKeys(['elevenlabs']);
      setProviderFetchMocks({
        elevenlabsGetVoice: () =>
          jsonOk({ voice_id: 'el-voice-3', name: 'my-custom-voice', category: 'cloned' }),
      });

      const res = await request(app).delete('/voices/elevenlabs/el-voice-3');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('NOT_FOUND');
      expect(res.body.message).toBe('Tzurot-cloned voice not found');
    });

    it('returns 404 for nonexistent voice', async () => {
      userWithKeys(['elevenlabs']);
      setProviderFetchMocks({
        elevenlabsGetVoice: () => notFoundResponse(),
      });

      const res = await request(app).delete('/voices/elevenlabs/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  // ===== POST /clear ======================================================

  describe('POST /clear - Clear all tzurot voices', () => {
    it('deletes all tzurot voices across all providers the user has keys for', async () => {
      userWithKeys(['elevenlabs', 'mistral']);
      setProviderFetchMocks({
        elevenlabsList: () => jsonOk(elevenLabsVoicesResponse),
        mistralList: () => jsonOk(mistralVoicesResponse),
        elevenlabsDelete: () => ({ ok: true, status: 200 }) as unknown as Response,
        mistralDelete: () => ({ ok: true, status: 200 }) as unknown as Response,
      });

      const res = await request(app).post('/voices/clear');

      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(4); // 2 elevenlabs + 2 mistral
      expect(res.body.total).toBe(4);
      expect(res.body.errors).toBeUndefined();
    });

    it('reports when no voices to clear', async () => {
      userWithKeys(['elevenlabs']);
      setProviderFetchMocks({
        elevenlabsList: () =>
          jsonOk({ voices: [{ voice_id: 'v1', name: 'non-tzurot', category: 'premade' }] }),
      });

      const res = await request(app).post('/voices/clear');

      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(0);
      expect(res.body.message).toContain('No Tzurot voices');
    });

    it('returns 404 when user has no audio provider keys', async () => {
      userWithKeys([]);
      const res = await request(app).post('/voices/clear');
      expect(res.status).toBe(404);
      expect(res.body.message).toContain('audio provider API key');
    });

    it('reports partial failures with provider-tagged messages', async () => {
      userWithKeys(['elevenlabs']);
      let deleteCallCount = 0;
      setProviderFetchMocks({
        elevenlabsList: () => jsonOk(elevenLabsVoicesResponse),
        elevenlabsDelete: () => {
          deleteCallCount++;
          // First delete succeeds, second fails
          if (deleteCallCount === 1) return { ok: true, status: 200 } as unknown as Response;
          return { ok: false, status: 500, statusText: 'Error' } as unknown as Response;
        },
      });

      const res = await request(app).post('/voices/clear');

      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(1);
      expect(res.body.total).toBe(2);
      expect(res.body.errors).toHaveLength(1);
      // Error message tags the provider
      expect(res.body.errors[0]).toContain('elevenlabs');
    });

    it('shows actionable message for rate-limited deletions', async () => {
      userWithKeys(['elevenlabs']);
      let deleteCallCount = 0;
      setProviderFetchMocks({
        elevenlabsList: () => jsonOk(elevenLabsVoicesResponse),
        elevenlabsDelete: () => {
          deleteCallCount++;
          if (deleteCallCount === 1) return { ok: true, status: 200 } as unknown as Response;
          return { ok: false, status: 429, statusText: 'Too Many' } as unknown as Response;
        },
      });

      const res = await request(app).post('/voices/clear');

      expect(res.status).toBe(200);
      expect(res.body.errors[0]).toContain('rate limited');
      expect(res.body.errors[0]).toContain('try again shortly');
    });
  });

  // ===== Decryption failure ==============================================

  describe('decryption failure', () => {
    it('returns empty key map (and 404) when ALL keys fail to decrypt', async () => {
      userWithKeys(['elevenlabs']);
      vi.mocked(decryptApiKey).mockImplementation(() => {
        throw new Error('Decryption failed');
      });

      const res = await request(app).get('/voices');

      // Resolver logs the failure and skips the provider; map is empty → 404
      expect(res.status).toBe(404);
      expect(res.body.message).toContain('audio provider API key');
    });
  });
});

describe('describeProviderError', () => {
  const baseStamp = '2026-05-03T17:00:00.000Z';

  it('classifies UNAUTHORIZED as "API key invalid or expired"', () => {
    expect(
      describeProviderError({
        error: ErrorCode.UNAUTHORIZED,
        message: 'whatever',
        timestamp: baseStamp,
      })
    ).toBe('API key invalid or expired');
  });

  it('classifies INTERNAL_ERROR as "Provider temporarily unavailable"', () => {
    expect(
      describeProviderError({
        error: ErrorCode.INTERNAL_ERROR,
        message: 'whatever',
        timestamp: baseStamp,
      })
    ).toBe('Provider temporarily unavailable');
  });

  it('falls back to "Couldn\'t load voices" for unrecognized error codes', () => {
    // NOT_FOUND isn't reachable through the current voice clients, but the
    // fallback exists as defense-in-depth — exercises the branch directly.
    expect(
      describeProviderError({
        error: ErrorCode.NOT_FOUND,
        message: 'whatever',
        timestamp: baseStamp,
      })
    ).toBe("Couldn't load voices");
  });
});
