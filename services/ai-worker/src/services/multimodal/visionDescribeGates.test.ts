/**
 * Tests for visionDescribeGates — the pre-invoke gates `describeImage` runs
 * before ever calling a vision provider (positive cache, negative cache,
 * single-flight), plus the failure-classification pieces they share with the
 * fallback loop (`VisionModelError`, the terminate/long-TTL category sets,
 * `buildFailureFallback`).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ApiErrorCategory,
  VISION_FAILURE_CACHE_POLICY,
} from '@tzurot/common-types/constants/error';
import { INTERVALS } from '@tzurot/common-types/constants/timing';
import type { AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import {
  buildFailureFallback,
  runDescribeImageGates,
  VisionModelError,
  LONG_TTL_FAILURE_CATEGORIES,
  VISION_TERMINATE_CATEGORIES,
} from './visionDescribeGates.js';
import { isLikelyErrorDescription } from './visionDescriptionValidity.js';

const mockGetFailure = vi.fn();
vi.mock('../../redis.js', () => ({
  visionDescriptionCache: {
    getFailure: (options: unknown) => mockGetFailure(options),
  },
}));

const mockReadValidCachedDescription = vi.fn();
vi.mock('./visionDescriptionValidity.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./visionDescriptionValidity.js')>();
  return {
    ...actual,
    readValidCachedDescription: (...args: unknown[]) => mockReadValidCachedDescription(...args),
  };
});

const mockEnterSingleFlight = vi.fn();
vi.mock('./visionSingleFlight.js', () => ({
  enterSingleFlight: (...args: unknown[]) => mockEnterSingleFlight(...args),
}));

describe('cache-policy / fallback-set invariant', () => {
  it('every LONG_TTL_FAILURE_CATEGORIES member must use VISION_FAILURE_TTL_LONG', () => {
    // The `LONG_TTL_FAILURE_CATEGORIES` set (in `visionDescribeGates.ts`) drives
    // the user-facing fallback message; the LONG-TTL entries in
    // `VISION_FAILURE_CACHE_POLICY` (in `error.ts`) drive the negative-cache cooldown.
    // Both encode the same "this failure is bound to the attachment, not transient
    // state" decision in different shapes — they must stay in sync. Adding a new
    // category to one structure but not the other would silently produce a TTL
    // mismatch (short cooldown when long is expected) or fallback-message mismatch
    // (generic "temporarily unavailable" when a specific label is expected).
    for (const category of LONG_TTL_FAILURE_CATEGORIES) {
      expect(VISION_FAILURE_CACHE_POLICY[category].l1TtlSeconds).toBe(
        INTERVALS.VISION_FAILURE_TTL_LONG
      );
    }
  });

  // (The FAILURE_LABELS-coverage invariant test was removed with FAILURE_LABELS
  // itself: buildFailureFallback no longer renders per-category labels — the
  // placeholder distinguishes only permanent vs transient vs auth wording.)
});

describe('terminate-set / attachment-bound-set invariant', () => {
  // `VISION_TERMINATE_CATEGORIES` (the categories where the fallback LOOP stops trying
  // other tiers) and `LONG_TTL_FAILURE_CATEGORIES` (the categories the negative
  // cache treats as image-bound for TTL purposes) encode two RELATED-but-distinct
  // decisions. The relationship is a deliberate strict subset: every "give up, the image
  // is the problem" category is also "bound to this attachment," but two categories are
  // attachment-bound for cache-TTL purposes yet are exactly what the loop routes around:
  // MODEL_NOT_FOUND (a different tier is a different model) and PROVIDER_CONTENT_REFUSED
  // (a different tier is a different provider's filter, so the chain must advance rather
  // than terminate). These tests pin that relationship so a future edit to either set
  // surfaces the divergence at PR time.

  it('VISION_TERMINATE_CATEGORIES is a strict subset of LONG_TTL_FAILURE_CATEGORIES', () => {
    for (const category of VISION_TERMINATE_CATEGORIES) {
      expect(LONG_TTL_FAILURE_CATEGORIES.has(category)).toBe(true);
    }
    // Strict (proper) subset: the attachment-bound set must have at least one member the
    // terminate set lacks (that member is asserted to be MODEL_NOT_FOUND below).
    expect(LONG_TTL_FAILURE_CATEGORIES.size).toBeGreaterThan(VISION_TERMINATE_CATEGORIES.size);
  });

  it('the set difference (attachment-bound \\ terminate) is exactly { MODEL_NOT_FOUND, PROVIDER_CONTENT_REFUSED }', () => {
    // MODEL_NOT_FOUND: a missing model won't reappear for THIS attachment on the SAME
    // model, but a different tier is a different model, so the loop advances.
    // PROVIDER_CONTENT_REFUSED: a provider's input filter won't reappear for THIS
    // attachment on the SAME provider, but a different tier is a different provider's
    // filter, so the loop must also advance rather than terminate.
    const difference = [...LONG_TTL_FAILURE_CATEGORIES].filter(
      category => !VISION_TERMINATE_CATEGORIES.has(category)
    );
    expect(new Set(difference)).toEqual(
      new Set([ApiErrorCategory.MODEL_NOT_FOUND, ApiErrorCategory.PROVIDER_CONTENT_REFUSED])
    );
  });

  it('VISION_TERMINATE_CATEGORIES does NOT contain PROVIDER_CONTENT_REFUSED — the chain must advance, not terminate', () => {
    expect(VISION_TERMINATE_CATEGORIES.has(ApiErrorCategory.PROVIDER_CONTENT_REFUSED)).toBe(false);
  });

  it('VISION_TERMINATE_CATEGORIES contains exactly CONTENT_POLICY, CENSORED, MEDIA_NOT_FOUND', () => {
    expect(new Set(VISION_TERMINATE_CATEGORIES)).toEqual(
      new Set([
        ApiErrorCategory.CONTENT_POLICY,
        ApiErrorCategory.CENSORED,
        ApiErrorCategory.MEDIA_NOT_FOUND,
      ])
    );
  });
});

describe('buildFailureFallback', () => {
  it('always starts with the [Image prefix, regardless of category/source/filename', () => {
    const combos: Array<[ApiErrorCategory, 'user' | 'system' | undefined, string | undefined]> = [
      [ApiErrorCategory.AUTHENTICATION, 'user', 'test-image.png'],
      [ApiErrorCategory.AUTHENTICATION, 'system', 'test-image.png'],
      [ApiErrorCategory.AUTHENTICATION, undefined, 'test-image.png'],
      [ApiErrorCategory.PROVIDER_CONTENT_REFUSED, 'system', 'test-image.png'],
      [ApiErrorCategory.CONTENT_POLICY, 'system', 'test-image.png'],
      [ApiErrorCategory.RATE_LIMIT, 'system', 'test-image.png'],
      [ApiErrorCategory.AUTHENTICATION, 'user', undefined],
      [ApiErrorCategory.RATE_LIMIT, 'system', undefined],
    ];
    for (const [category, source, filename] of combos) {
      const rendered = buildFailureFallback(category, source, filename);
      expect(rendered.startsWith('[Image')).toBe(true);
      // Must not match any ERROR_DESCRIPTION_PATTERNS substring — a placeholder
      // that trips the error-shape detector would poison the positive cache.
      expect(isLikelyErrorDescription(rendered)).toBe(false);
    }
  });

  it('AUTHENTICATION + user source points at /settings apikey set', () => {
    const rendered = buildFailureFallback(ApiErrorCategory.AUTHENTICATION, 'user', 'pic.png');
    expect(rendered).toContain('/settings apikey set');
    expect(rendered).toContain('"pic.png"');
  });

  it('AUTHENTICATION + system source uses the non-blaming transient wording', () => {
    const rendered = buildFailureFallback(ApiErrorCategory.AUTHENTICATION, 'system', 'pic.png');
    expect(rendered).not.toContain('/settings apikey set');
    expect(rendered).toContain('temporary problem');
  });

  it('AUTHENTICATION + undefined source falls to the same non-blaming wording as system', () => {
    const rendered = buildFailureFallback(ApiErrorCategory.AUTHENTICATION, undefined, 'pic.png');
    expect(rendered).toBe(
      buildFailureFallback(ApiErrorCategory.AUTHENTICATION, 'system', 'pic.png')
    );
  });

  it('PROVIDER_CONTENT_REFUSED renders the content-filter wording', () => {
    const rendered = buildFailureFallback(
      ApiErrorCategory.PROVIDER_CONTENT_REFUSED,
      'system',
      'pic.png'
    );
    expect(rendered).toContain('content filter declined');
  });

  it('a LONG_TTL_FAILURE_CATEGORIES member (CONTENT_POLICY) renders the permanent wording', () => {
    const rendered = buildFailureFallback(ApiErrorCategory.CONTENT_POLICY, 'system', 'pic.png');
    expect(rendered).toContain("can't see its contents");
    expect(rendered).not.toContain('may succeed later');
  });

  it('a transient (non-LONG_TTL) category renders the "may succeed later" wording', () => {
    const rendered = buildFailureFallback(ApiErrorCategory.RATE_LIMIT, 'system', 'pic.png');
    expect(rendered).toContain('may succeed later');
  });

  it('omits the quoted filename when none is given', () => {
    const withFilename = buildFailureFallback(ApiErrorCategory.RATE_LIMIT, 'system', 'pic.png');
    const withoutFilename = buildFailureFallback(ApiErrorCategory.RATE_LIMIT, 'system', undefined);
    expect(withFilename).toContain('"pic.png"');
    expect(withoutFilename).not.toContain('"');
  });
});

describe('runDescribeImageGates', () => {
  const mockAttachment: AttachmentMetadata = {
    id: '123456789012345678',
    url: 'https://cdn.discordapp.com/test-image.png',
    name: 'test-image.png',
    contentType: 'image/png',
    size: 1024,
  };
  const cacheKeyOptions = {
    attachmentId: mockAttachment.id,
    url: mockAttachment.url,
    model: 'gpt-4o',
  };

  function baseInput(overrides: Partial<Parameters<typeof runDescribeImageGates>[0]> = {}) {
    return {
      cacheKeyOptions,
      attachment: mockAttachment,
      apiKeySource: undefined as 'user' | 'system' | undefined,
      skipCache: false,
      skipNegativeCache: false,
      throwOnFailure: false,
      notifyAttribution: vi.fn(),
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    mockGetFailure.mockResolvedValue(null);
    mockReadValidCachedDescription.mockResolvedValue(null);
    mockEnterSingleFlight.mockResolvedValue({ acquired: true, coalesced: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('positive-cache hit resolves with the cached description and notifies attribution', async () => {
    mockReadValidCachedDescription.mockResolvedValue({
      description: 'A cached description',
      model: 'cached-model',
    });
    const notifyAttribution = vi.fn();

    const result = await runDescribeImageGates(baseInput({ notifyAttribution }));

    expect(result).toEqual({ kind: 'resolved', description: 'A cached description' });
    expect(notifyAttribution).toHaveBeenCalledWith({ model: 'cached-model', fromCache: true });
    expect(mockGetFailure).not.toHaveBeenCalled();
    expect(mockEnterSingleFlight).not.toHaveBeenCalled();
  });

  it('skipCache: true bypasses the positive cache entirely', async () => {
    mockReadValidCachedDescription.mockResolvedValue({
      description: 'A cached description',
      model: 'cached-model',
    });

    const result = await runDescribeImageGates(baseInput({ skipCache: true }));

    expect(mockReadValidCachedDescription).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: 'proceed', flight: { acquired: true, coalesced: null } });
  });

  it('negative-cache hit with throwOnFailure: false resolves with the buildFailureFallback render', async () => {
    mockGetFailure.mockResolvedValue({
      category: ApiErrorCategory.RATE_LIMIT,
      cachedAt: '2026-04-28T18:22:42.000Z',
    });

    const result = await runDescribeImageGates(
      baseInput({ apiKeySource: 'system', throwOnFailure: false })
    );

    expect(result).toEqual({
      kind: 'resolved',
      description: buildFailureFallback(ApiErrorCategory.RATE_LIMIT, 'system', mockAttachment.name),
    });
    expect(mockEnterSingleFlight).not.toHaveBeenCalled();
  });

  it('negative-cache hit with throwOnFailure: true throws VisionModelError carrying the cached category', async () => {
    mockGetFailure.mockResolvedValue({
      category: ApiErrorCategory.CONTENT_POLICY,
      cachedAt: '2026-04-28T18:22:42.000Z',
    });

    let caught: unknown;
    try {
      await runDescribeImageGates(baseInput({ throwOnFailure: true }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(VisionModelError);
    expect((caught as VisionModelError).category).toBe(ApiErrorCategory.CONTENT_POLICY);
    expect(mockEnterSingleFlight).not.toHaveBeenCalled();
  });

  it('skipNegativeCache: true runs checkNegativeCache with longTtlOnly: true — a SHORT-TTL failure does not short-circuit', async () => {
    // RATE_LIMIT is transient (not in LONG_TTL_FAILURE_CATEGORIES) — the reference
    // path re-attempts rather than honoring it.
    mockGetFailure.mockResolvedValue({
      category: ApiErrorCategory.RATE_LIMIT,
      cachedAt: '2026-04-28T18:22:42.000Z',
    });

    const result = await runDescribeImageGates(baseInput({ skipNegativeCache: true }));

    expect(mockGetFailure).toHaveBeenCalledWith(cacheKeyOptions);
    expect(result).toEqual({ kind: 'proceed', flight: { acquired: true, coalesced: null } });
  });

  it('skipNegativeCache: true still honors a LONG-TTL cached failure — it short-circuits', async () => {
    mockGetFailure.mockResolvedValue({
      category: ApiErrorCategory.CONTENT_POLICY,
      cachedAt: '2026-04-28T18:22:42.000Z',
    });

    const result = await runDescribeImageGates(baseInput({ skipNegativeCache: true }));

    expect(result).toEqual({
      kind: 'resolved',
      description: buildFailureFallback(
        ApiErrorCategory.CONTENT_POLICY,
        undefined,
        mockAttachment.name
      ),
    });
    expect(mockEnterSingleFlight).not.toHaveBeenCalled();
  });

  it('single-flight coalesced resolves with the winner description and notifies attribution', async () => {
    mockEnterSingleFlight.mockResolvedValue({
      acquired: false,
      coalesced: { description: 'Winner description', model: 'winner-model' },
    });
    const notifyAttribution = vi.fn();

    const result = await runDescribeImageGates(baseInput({ notifyAttribution }));

    expect(result).toEqual({ kind: 'resolved', description: 'Winner description' });
    expect(notifyAttribution).toHaveBeenCalledWith({ model: 'winner-model', fromCache: true });
  });

  it('all gates pass through to proceed, returning the single-flight handle', async () => {
    const flight = { acquired: true, coalesced: null };
    mockEnterSingleFlight.mockResolvedValue(flight);

    const result = await runDescribeImageGates(baseInput());

    expect(result).toEqual({ kind: 'proceed', flight });
    expect(mockEnterSingleFlight).toHaveBeenCalledWith(cacheKeyOptions, mockAttachment, false);
  });

  it('gate ORDER: a positive-cache hit wins over a cached failure, and single-flight is never entered', async () => {
    mockReadValidCachedDescription.mockResolvedValue({
      description: 'A cached description',
      model: 'cached-model',
    });
    mockGetFailure.mockResolvedValue({
      category: ApiErrorCategory.RATE_LIMIT,
      cachedAt: '2026-04-28T18:22:42.000Z',
    });

    const result = await runDescribeImageGates(baseInput());

    expect(result).toEqual({ kind: 'resolved', description: 'A cached description' });
    expect(mockGetFailure).not.toHaveBeenCalled();
    expect(mockEnterSingleFlight).not.toHaveBeenCalled();
  });
});
