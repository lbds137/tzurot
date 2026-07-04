/**
 * Integration test: the vision fallback loop over REAL Redis.
 *
 * The unit suite mocks describeImage/resolveVisionAuth wholesale, and the wiring
 * test mocks the negative/positive caches — so the loop's interaction with real
 * Redis (the `(model, attachment)` negative-cache keying that makes cross-tier
 * retry safe, and positive-cache storage of the winning tier's description) has
 * no coverage anywhere else. This tier runs the REAL VisionProcessor +
 * visionAuthResolver + Redis-backed caches; the ONLY stub is the LLM network
 * boundary (`createChatModel`) plus an in-memory apiKeyResolver (the DB
 * boundary).
 *
 * Requires: `podman start tzurot-redis` (REDIS_URL from .env). Run via
 * `pnpm test:integration` — the unit config excludes this suffix.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';

// The mocked seams are the two NETWORK boundaries: the LLM client factory and
// the attachment downloader (describeImage fetches the image bytes to a data:
// URL before invoking — a real fetch of the fake test URL would hang to its
// 30s timeout). Everything else — the loop, describeImage's cache checks,
// classification, per-tier auth — runs real.
vi.mock('../ModelFactory.js', () => ({
  createChatModel: vi.fn(),
}));
vi.mock('../../utils/imageToDataUrl.js', () => ({
  downloadImageToDataUrl: vi
    .fn()
    .mockResolvedValue({ dataUrl: 'data:image/png;base64,aW1n', bytes: 3 }),
}));
// Third network boundary: checkModelVisionSupport consults the OpenRouter model
// catalog (an outbound fetch on cache miss). None of the current scenarios
// actually reach it — every personality here sets visionModel, so priority-1
// selection returns before the catalog probe — but the stub stays as a
// hang-guard: a future scenario omitting visionModel would otherwise make a
// real outbound fetch. importOriginal keeps the REAL redis singletons.
vi.mock('../../redis.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../redis.js')>()),
  checkModelVisionSupport: vi.fn().mockResolvedValue(false),
}));

import { createChatModel } from '../ModelFactory.js';
import { describeImageWithFallback } from './describeImageWithFallback.js';
import type { ResolveVisionConfigOptions } from './visionAuthResolver.js';
import { visionDescriptionCache, redisService } from '../../redis.js';

const mockCreateChatModel = vi.mocked(createChatModel);

/** Script the stubbed model client: each call shifts the next behavior. */
function scriptModelInvocations(
  behaviors: Array<{ reject?: Error; content?: string }>
): ReturnType<typeof vi.fn> {
  const invoke = vi.fn();
  for (const b of behaviors) {
    if (b.reject !== undefined) {
      invoke.mockRejectedValueOnce(b.reject);
    } else {
      invoke.mockResolvedValueOnce({ content: b.content ?? 'stub description' });
    }
  }
  mockCreateChatModel.mockImplementation(
    (modelConfig?: { modelName?: string }) =>
      ({
        model: { invoke },
        modelName: modelConfig?.modelName ?? 'stub-model',
      }) as unknown as ReturnType<typeof createChatModel>
  );
  return invoke;
}

function makePersonality(): LoadedPersonality {
  return {
    id: 'pers-integration',
    ownerId: 'owner-integration',
    name: 'IntegrationPersona',
    slug: 'integration-test',
    model: 'text-only/main-model',
    visionModel: 'itest/tier-one',
    visionFallbackModels: ['itest/tier-two'],
    systemPrompt: '',
    temperature: 0.7,
  } as unknown as LoadedPersonality;
}

/** Unique attachment per test — real Redis persists across runs, so isolation is by key. */
function makeAttachment(): AttachmentMetadata {
  return {
    id: randomUUID(),
    url: `https://cdn.example.com/${randomUUID()}.png`,
    contentType: 'image/png',
    name: 'itest.png',
    size: 1234,
  } as AttachmentMetadata;
}

/**
 * BYOK auth shape: the in-memory apiKeyResolver stands in for the DB boundary.
 * Every tier resolves the user's own key (path c), so no quota/system-key
 * branches interfere with the cache behavior under test.
 */
function makeAuthOptions(personality: LoadedPersonality): ResolveVisionConfigOptions {
  return {
    personality,
    mainProvider: undefined,
    mainApiKey: undefined,
    isGuestMode: false,
    userId: 'integration-user',
    apiKeyResolver: {
      resolveApiKey: vi.fn().mockResolvedValue({ apiKey: 'sk-integration', isGuestMode: false }),
      tryResolveUserKey: vi.fn().mockResolvedValue('sk-integration'),
    } as unknown as ResolveVisionConfigOptions['apiKeyResolver'],
  };
}

describe('describeImageWithFallback (integration: real Redis)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retryable tier-1 failure advances to tier 2, negative-caches tier 1, positive-caches the winner', async () => {
    const attachment = makeAttachment();
    const personality = makePersonality();
    const invoke = scriptModelInvocations([
      { reject: new Error('429 Too Many Requests: rate limit exceeded') },
      { content: 'a scenic mountain at dusk' },
    ]);

    const description = await describeImageWithFallback(
      attachment,
      personality,
      makeAuthOptions(personality)
    );

    expect(description).toBe('a scenic mountain at dusk');
    expect(invoke).toHaveBeenCalledTimes(2);

    // The negative-cache entry is keyed by (model, attachment) in REAL Redis —
    // tier 1's failure must be recorded under tier 1's model...
    const tierOneFailure = await visionDescriptionCache.getFailure({
      attachmentId: attachment.id,
      url: attachment.url,
      model: 'itest/tier-one',
    });
    expect(tierOneFailure).not.toBeNull();

    // ...and must NOT bleed onto tier 2's key (per-model keying is exactly what
    // makes cross-tier retry cache-safe).
    const tierTwoFailure = await visionDescriptionCache.getFailure({
      attachmentId: attachment.id,
      url: attachment.url,
      model: 'itest/tier-two',
    });
    expect(tierTwoFailure).toBeNull();
  });

  it('a later request honors the attachment-bound negative entry + serves the positive cache: zero LLM calls', async () => {
    // The negative cache is honored SELECTIVELY on later requests
    // (longTtlOnly): transient failures (rate-limit/server) are
    // deliberately re-attempted — they may have cleared. An attachment-bound
    // failure like MODEL_NOT_FOUND is honored (re-attempting can't recover),
    // while still being retryable WITHIN the first pass (the loop advances).
    // This test pins that full round trip against real Redis.
    const attachment = makeAttachment();
    const personality = makePersonality();

    // First pass: tier 1 fails MODEL_NOT_FOUND (attachment-bound, advances),
    // tier 2 succeeds.
    scriptModelInvocations([
      { reject: new Error('404 model not found: itest/tier-one is not a valid model ID') },
      { content: 'first-pass description' },
    ]);
    const firstPass = await describeImageWithFallback(
      attachment,
      personality,
      makeAuthOptions(personality)
    );
    expect(firstPass).toBe('first-pass description');

    // The winning tier's description landed in the positive cache under the
    // tier-2 model key (this is what makes the second pass free).
    const stored = await visionDescriptionCache.get({
      attachmentId: attachment.id,
      url: attachment.url,
      model: 'itest/tier-two',
    });
    expect(stored).toBe('first-pass description');

    // Second pass, same attachment: tier 1 short-circuits on its honored
    // negative entry (no invoke), tier 2 serves from the positive cache
    // (no invoke) — the whole request costs zero LLM calls.
    const invoke = scriptModelInvocations([{ content: 'should never be called' }]);
    const description = await describeImageWithFallback(
      attachment,
      personality,
      makeAuthOptions(personality)
    );

    expect(description).toBe('first-pass description');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('a terminate-category failure short-circuits: one LLM call, placeholder, no tier burn', async () => {
    const attachment = makeAttachment();
    const personality = makePersonality();
    const invoke = scriptModelInvocations([
      { reject: new Error('Image rejected: content policy violation — flagged content') },
    ]);

    const description = await describeImageWithFallback(
      attachment,
      personality,
      makeAuthOptions(personality)
    );

    // The image itself is the problem — no other tier would do better, so the
    // loop must NOT spend tier-2/floor calls.
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(description.startsWith('[Image')).toBe(true);
  });
});

// The module-level Redis connection keeps the process alive after the run —
// close it so vitest can exit.
afterAll(async () => {
  await redisService.close();
});
