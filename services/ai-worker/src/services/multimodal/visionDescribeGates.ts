/**
 * Vision describe-image gates.
 *
 * The three checks `describeImage` runs BEFORE ever invoking a vision provider —
 * positive cache, negative cache, single-flight — bundled behind one entry point
 * (`runDescribeImageGates`) so a gate hit resolves the description without a
 * provider call, and every gate passing hands the caller the single-flight
 * handle it must release. Also home to the failure-classification pieces the
 * gates and the fallback loop share: `VisionModelError`, the terminate/long-TTL
 * category sets, and `buildFailureFallback`.
 */

import { ApiErrorCategory } from '@tzurot/common-types/constants/error';
import { type AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import { type AttachmentDescriptionAttribution } from '@tzurot/common-types/types/diagnostic';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { visionDescriptionCache } from '../../redis.js';
import { enterSingleFlight, type SingleFlightEntry } from './visionSingleFlight.js';
import {
  VISION_PLACEHOLDER_PREFIX,
  readValidCachedDescription,
} from './visionDescriptionValidity.js';

const logger = createLogger('VisionDescribeGates');

/**
 * Typed vision-invocation failure. Carries the `ApiErrorCategory` so the fallback loop
 * (`describeImageWithFallback`) can decide terminate-vs-advance without re-parsing the
 * error. `describeImage` throws this on ANY single-model failure — a fresh API error OR
 * a negative-cache hit — and the loop is the only thing that turns it into a user-facing
 * `[Image unavailable: …]` placeholder (on a terminate category, or once all tiers exhaust).
 */
export class VisionModelError extends Error {
  /**
   * Model id the provider reported having served for the failed attempt, when
   * the response carried one (see `readRoutedModel`). Undefined whenever the
   * failure happened before a response existed — a transport error, or the
   * zero-choices guard in `invokeModelGuarded`, which throws without returning
   * a message. Carried so the fallback loop's exhausted-chain log can name the
   * model behind the last failure rather than only the requested alias.
   */
  readonly routedModel?: string;

  constructor(
    readonly category: ApiErrorCategory,
    message: string,
    options?: { cause?: unknown; routedModel?: string }
  ) {
    super(message, options);
    this.name = 'VisionModelError';
    this.routedModel = options?.routedModel;
  }
}

/**
 * Vision failure categories where the IMAGE ITSELF is the problem (a provider examined
 * it and refused, or it's unreadable) — retrying with a different model won't help, so
 * the fallback loop terminates immediately rather than burning tiers/latency/quota.
 *
 * Deliberately a STRICT SUBSET of `LONG_TTL_FAILURE_CATEGORIES`, excluding two members
 * that are attachment-bound for negative-cache-TTL purposes but are exactly what the
 * fallback loop routes AROUND rather than terminates on:
 * - `MODEL_NOT_FOUND` — a missing model won't reappear for THIS attachment on a retry
 *   of the SAME model, but a different tier is a different model.
 * - `PROVIDER_CONTENT_REFUSED` — a provider's input filter won't reappear for THIS
 *   attachment on a retry of the SAME provider, but a different tier is a different
 *   provider's filter, and lower tiers are observed describing images an upstream
 *   tier's filter refused.
 * The subset invariant (and that these two are the sole difference) is pinned by a test.
 */
// eslint-disable-next-line @tzurot/no-singleton-export -- Intentional: immutable lookup set used as a constant (mirrors LONG_TTL_FAILURE_CATEGORIES). Exported for the fallback loop + the terminate-set/attachment-bound-set invariant test in visionDescribeGates.test.ts.
export const VISION_TERMINATE_CATEGORIES: ReadonlySet<ApiErrorCategory> = new Set([
  ApiErrorCategory.CONTENT_POLICY,
  ApiErrorCategory.CENSORED,
  ApiErrorCategory.MEDIA_NOT_FOUND,
]);

/**
 * Categories whose failures are bound to attachment properties (URL, content, model
 * availability) and unlikely to recover for the same attachment. The prompt-facing
 * placeholder for these uses the permanent "can't see its contents" wording; other
 * categories (auth, quota, rate-limit, etc.) get the transient "may succeed later" wording.
 *
 * **Invariant**: every member of this set MUST also have its `l1TtlSeconds` set to
 * `INTERVALS.VISION_FAILURE_TTL_LONG` in `VISION_FAILURE_CACHE_POLICY`. The two
 * structures encode the same "this failure is attachment-bound" decision in different
 * shapes (one drives cache TTL, the other drives the user-facing message) and must
 * stay in sync. Enforced by the invariant test in `visionDescribeGates.test.ts` so that
 * adding a category to one but not the other fails CI.
 *
 * Exported for the invariant test only — EXTERNAL call sites should use
 * `buildFailureFallback` / `VISION_FAILURE_CACHE_POLICY` rather than reading this set
 * directly. (The in-module `checkNegativeCache` reads it as a membership predicate to
 * decide which cached failures the retry-loop / reference path honors.)
 */
// eslint-disable-next-line @tzurot/no-singleton-export -- Intentional: immutable lookup set used as a constant. Exported only to enable the cache-policy/fallback-set invariant test in visionDescribeGates.test.ts.
export const LONG_TTL_FAILURE_CATEGORIES: ReadonlySet<ApiErrorCategory> = new Set([
  // The axis here is CACHE LIFETIME (mirror of VISION_FAILURE_CACHE_POLICY's
  // LONG cooldowns), NOT "the image itself is doomed" — MODEL_NOT_FOUND is
  // long-cacheable per (model, attachment) yet retryable across models, which
  // is exactly why VISION_TERMINATE_CATEGORIES excludes it (invariant-tested).
  ApiErrorCategory.CONTENT_POLICY,
  ApiErrorCategory.MEDIA_NOT_FOUND,
  ApiErrorCategory.MODEL_NOT_FOUND,
  // CENSORED is also image-bound in practice — the model refuses based on what's
  // depicted, not on transient state. Mirrors the LONG cooldown classification in
  // VISION_FAILURE_CACHE_POLICY.
  ApiErrorCategory.CENSORED,
  // Attachment-bound for THIS provider's input filter (the cache key includes
  // the model), yet retryable ACROSS tiers — a different tier is a different
  // provider's filter. Same shape as MODEL_NOT_FOUND above, which is why the
  // terminate set (below) excludes both.
  ApiErrorCategory.PROVIDER_CONTENT_REFUSED,
]);

/**
 * Build the placeholder injected into the prompt when an image couldn't be described.
 *
 * Written for the LLM reading the prompt, not as a status code: the previous
 * `[Image unavailable: <reason-label>]` shape read like UI jargon and personas
 * narrated it verbatim ("the image description is still showing as unavailable").
 * The placeholder keeps the failure SIGNAL (the model should know an image was
 * there) and the filename (often has semantic content worth acknowledging), and
 * tells the model how to behave instead of reporting an internal state.
 *
 * Two load-bearing constraints on the wording:
 * - It MUST start with `[Image` — `isValidVisionDescription` uses that prefix to
 *   keep failure placeholders out of the positive description cache.
 * - It must NOT contain any `ERROR_DESCRIPTION_PATTERNS` substring (e.g. "cannot
 *   process") — those mark error-shaped text, and matching one would make cached
 *   reads treat every placeholder as a poisoned entry.
 *
 * AUTH keeps a source-aware variant: a user-key failure points at
 * `/settings apikey set`; a system-key (or unknown-source) failure uses the
 * non-blaming transient wording — the user can't act on a key they don't own.
 */
export function buildFailureFallback(
  category: ApiErrorCategory,
  apiKeySource: 'user' | 'system' | undefined,
  filename?: string
): string {
  const subject =
    filename !== undefined && filename.length > 0
      ? `${VISION_PLACEHOLDER_PREFIX} "${filename}"`
      : VISION_PLACEHOLDER_PREFIX;
  if (category === ApiErrorCategory.AUTHENTICATION) {
    if (apiKeySource === 'user') {
      return `${subject} was shared but couldn't be processed — the vision API key was rejected; it can be fixed with /settings apikey set]`;
    }
    return `${subject} was shared but couldn't be processed right now — the vision service had a temporary problem; it may work again shortly]`;
  }
  if (category === ApiErrorCategory.PROVIDER_CONTENT_REFUSED) {
    return `${subject} was shared, but the vision provider's content filter declined to describe it — you can acknowledge it, but can't see its contents]`;
  }
  if (LONG_TTL_FAILURE_CATEGORIES.has(category)) {
    return `${subject} was shared but couldn't be processed — you can acknowledge it if relevant, but can't see its contents]`;
  }
  return `${subject} was shared but couldn't be processed right now — it may succeed later; you can acknowledge it, but can't see its contents]`;
}

/**
 * Check negative cache for a previous failure.
 * Returns a fallback string if a failure is cached, or null to proceed with the API call.
 *
 * `longTtlOnly` (the retry-loop / reference path) honors ONLY failures bound to
 * the attachment itself (dead URL, removed model, content-policy, censored) — those can't
 * recover for this attachment, so re-attempting every turn the image sits in context just
 * re-storms across providers (observed adding ~100s of latency per turn). Transient
 * failures (rate-limit, quota, server) are NOT honored in this mode: they may have
 * cleared, and short-circuiting them would defeat the retry that exists to catch recovery.
 */
async function checkNegativeCache(
  cacheKeyOptions: { attachmentId?: string; url: string; model?: string },
  attachmentId: string | undefined,
  apiKeySource: 'user' | 'system' | undefined,
  options: { longTtlOnly?: boolean } = {}
): Promise<ApiErrorCategory | null> {
  const failureEntry = await visionDescriptionCache.getFailure(cacheKeyOptions);
  if (failureEntry === null) {
    return null;
  }
  if (options.longTtlOnly === true && !LONG_TTL_FAILURE_CATEGORIES.has(failureEntry.category)) {
    return null;
  }
  logger.info(
    {
      attachmentId,
      category: failureEntry.category,
      cachedAt: failureEntry.cachedAt,
      apiKeySource,
    },
    'Skipping vision API call - failure cooldown active'
  );
  // Return the CATEGORY (not the rendered string) so `describeImage` can throw a typed
  // VisionModelError and the fallback loop can decide terminate-vs-advance. The user-facing
  // `[Image unavailable: …]` render happens once, in the loop, via `buildFailureFallback`.
  return failureEntry.category;
}

/** Cache-identity options shared with VisionDescriptionCache. */
interface DescribeGateKeyOptions {
  attachmentId?: string;
  url: string;
  model?: string;
}

/** Inputs the three pre-invoke gates need, bundled to stay under `max-params`. */
export interface DescribeImageGateInput {
  cacheKeyOptions: DescribeGateKeyOptions;
  attachment: AttachmentMetadata;
  apiKeySource: 'user' | 'system' | undefined;
  skipCache: boolean;
  skipNegativeCache: boolean;
  throwOnFailure: boolean;
  notifyAttribution: (attribution: AttachmentDescriptionAttribution) => void;
}

/**
 * Either a gate already produced the answer (`resolved` — the caller returns the
 * description and makes no provider call) or every gate passed (`proceed` — the
 * caller runs the invoke path and MUST pass `flight` to `exitSingleFlight` in its
 * `finally`).
 */
export type DescribeImageGateOutcome =
  { kind: 'resolved'; description: string } | { kind: 'proceed'; flight: SingleFlightEntry };

export async function runDescribeImageGates(
  input: DescribeImageGateInput
): Promise<DescribeImageGateOutcome> {
  const {
    cacheKeyOptions,
    attachment,
    apiKeySource,
    skipCache,
    skipNegativeCache,
    throwOnFailure,
    notifyAttribution,
  } = input;

  // Check the canonical cache first — model-agnostic, so a description ANY model
  // produced (e.g. a paid model on an earlier turn) is reused here, including by
  // free-tier requests that could never produce one themselves.
  if (!skipCache) {
    const cached = await readValidCachedDescription(cacheKeyOptions, attachment);
    if (cached !== null) {
      notifyAttribution({ model: cached.model, fromCache: true });
      return { kind: 'resolved', description: cached.description };
    }
  }

  // Check the negative cache to avoid re-hammering failed images. On the retry-loop /
  // reference path (`skipNegativeCache`) we still honor ATTACHMENT-BOUND failures (a dead
  // URL / removed model won't recover for this attachment, so re-attempting every turn it
  // sits in context just re-storms across providers) but skip transient ones so the retry
  // can still catch recovery.
  const cachedCategory = await checkNegativeCache(cacheKeyOptions, attachment.id, apiKeySource, {
    longTtlOnly: skipNegativeCache,
  });
  if (cachedCategory !== null) {
    // A cached failure for this (model, attachment). The fallback loop
    // (throwOnFailure) wants the typed error so it can advance tiers / render the terminal
    // placeholder; legacy single-model callers get the rendered placeholder string as before.
    if (throwOnFailure) {
      throw new VisionModelError(cachedCategory, 'vision negative-cache hit');
    }
    return {
      kind: 'resolved',
      description: buildFailureFallback(cachedCategory, apiKeySource, attachment.name),
    };
  }

  // Single-flight: coalesce concurrent describes of the same image (see
  // visionSingleFlight.ts — multi-character fan-out burns N provider calls
  // without it). Coalesced → return the winner's description, zero calls.
  const flight = await enterSingleFlight(cacheKeyOptions, attachment, skipCache);
  if (flight.coalesced !== null) {
    notifyAttribution({ model: flight.coalesced.model, fromCache: true });
    return { kind: 'resolved', description: flight.coalesced.description };
  }
  return { kind: 'proceed', flight };
}
