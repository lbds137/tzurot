/**
 * Shapes.inc Data Fetcher
 *
 * Fetches personality data from the shapes.inc API including configuration,
 * memories (paginated), stories/knowledge, and user personalization.
 *
 * Key behaviors:
 * - Stateful cookie management (shapes.inc rotates cookies on each request)
 * - Rate-limited requests (1s delay between calls)
 * - Per-request retry with exponential backoff (429, 5xx, network errors)
 * - AbortController timeouts per request
 */

import {
  createLogger,
  SHAPES_BASE_URL,
  SHAPES_USER_AGENT,
  type ShapesIncPersonalityConfig,
  type ShapesIncMemory,
  type ShapesIncStory,
  type ShapesIncUserPersonalization,
  type ShapesDataFetchResult,
} from '@tzurot/common-types';
import {
  ShapesAuthError,
  ShapesFetchError,
  ShapesNotFoundError,
  ShapesRateLimitError,
  ShapesServerError,
} from './shapesErrors.js';

const logger = createLogger('ShapesDataFetcher');
const REQUEST_TIMEOUT_MS = 30_000;
const DELAY_BETWEEN_REQUESTS_MS = 1000;
const MEMORIES_PER_PAGE = 20;
const MAX_MEMORY_PAGES = 500; // Safety cap: 10,000 memories at 20/page
// 3 total attempts per request. Worst-case per request with retries:
// 30s timeout + 2s backoff + 30s timeout + 4s backoff + 30s timeout = 96s.
// This is intentional — better to wait 96s for one request than restart
// a 461-page job from page 1.
const REQUEST_RETRY_COUNT = 2;
const RETRY_BASE_DELAY_MS = 2000;

// ============================================================================
// Types
// ============================================================================

interface FetchOptions {
  /** Initial session cookie (full cookie string with both appSession parts) */
  sessionCookie: string;
  /** AbortSignal for external cancellation */
  signal?: AbortSignal;
}

interface PaginatedMemoryResponse {
  items?: ShapesIncMemory[];
  memories?: ShapesIncMemory[];
  pagination?: {
    total_pages?: number;
    has_next?: boolean;
    page?: number;
  };
}

// ============================================================================
// ShapesDataFetcher
// ============================================================================

export class ShapesDataFetcher {
  /** Mutable cookie jar - updated after each API response */
  private currentCookie = '';

  /**
   * Fetch all data for a shape by username slug.
   *
   * @param slug - shapes.inc username (e.g., "lilith")
   * @param options - Session cookie and optional abort signal
   * @returns Complete shape data including config, memories, stories, and user personalization
   */
  async fetchShapeData(slug: string, options: FetchOptions): Promise<ShapesDataFetchResult> {
    this.currentCookie = options.sessionCookie;

    logger.info({ slug }, '[ShapesDataFetcher] Starting data fetch');

    // 1. Fetch shape config (also resolves slug → UUID)
    const config = await this.fetchShapeConfig(slug, options.signal);
    const shapeId = config.id;

    logger.info(
      { slug, shapeId, name: config.name },
      '[ShapesDataFetcher] Config fetched, starting data collection'
    );

    await this.delay();

    // 2. Fetch memories (paginated)
    const { memories, pagesTraversed } = await this.fetchAllMemories(shapeId, options.signal);

    await this.delay();

    // 3. Fetch stories/knowledge
    const stories = await this.fetchStories(shapeId, options.signal);

    await this.delay();

    // 4. Fetch user personalization
    const userPersonalization = await this.fetchUserPersonalization(shapeId, options.signal);

    const result: ShapesDataFetchResult = {
      config,
      memories,
      stories,
      userPersonalization,
      stats: {
        memoriesCount: memories.length,
        storiesCount: stories.length,
        pagesTraversed,
      },
    };

    logger.info(
      {
        slug,
        memoriesCount: result.stats.memoriesCount,
        storiesCount: result.stats.storiesCount,
        pagesTraversed: result.stats.pagesTraversed,
        hasUserPersonalization: userPersonalization !== null,
      },
      '[ShapesDataFetcher] Data fetch complete'
    );

    return result;
  }

  /**
   * Get the latest cookie value (may have been rotated by shapes.inc).
   * Call this after fetchShapeData() to persist the updated cookie.
   */
  getUpdatedCookie(): string {
    return this.currentCookie;
  }

  // ==========================================================================
  // Private fetch methods
  // ==========================================================================

  private async fetchShapeConfig(
    slug: string,
    signal?: AbortSignal
  ): Promise<ShapesIncPersonalityConfig> {
    const url = `${SHAPES_BASE_URL}/api/shapes/username/${encodeURIComponent(slug)}`;
    return this.makeRequest<ShapesIncPersonalityConfig>(url, signal);
  }

  private async fetchAllMemories(
    shapeId: string,
    signal?: AbortSignal
  ): Promise<{ memories: ShapesIncMemory[]; pagesTraversed: number }> {
    const allMemories: ShapesIncMemory[] = [];
    let page = 1;
    let hasNext = true;

    while (hasNext && page <= MAX_MEMORY_PAGES) {
      const url = `${SHAPES_BASE_URL}/api/memory/${encodeURIComponent(shapeId)}?page=${page}&limit=${MEMORIES_PER_PAGE}`;

      let response: PaginatedMemoryResponse;
      try {
        response = await this.makeRequest<PaginatedMemoryResponse>(url, signal);
      } catch (error) {
        // Some shapes may have no memories endpoint — treat 404 as empty
        if (error instanceof ShapesNotFoundError) {
          break;
        }
        throw error;
      }

      const pageMemories = response.items ?? response.memories ?? [];
      allMemories.push(...pageMemories);

      hasNext = response.pagination?.has_next === true;

      logger.debug(
        { shapeId, page, count: pageMemories.length, total: allMemories.length, hasNext },
        '[ShapesDataFetcher] Memory page fetched'
      );

      if (hasNext) {
        page++;
        await this.delay();
      }
    }

    return { memories: allMemories, pagesTraversed: page };
  }

  private async fetchStories(shapeId: string, signal?: AbortSignal): Promise<ShapesIncStory[]> {
    const url = `${SHAPES_BASE_URL}/api/shapes/${encodeURIComponent(shapeId)}/story`;

    try {
      const response = await this.makeRequest<ShapesIncStory[] | { items?: ShapesIncStory[] }>(
        url,
        signal
      );

      if (Array.isArray(response)) {
        return response;
      }
      return response.items ?? [];
    } catch (error) {
      // Stories are optional — 404 means no stories
      if (error instanceof ShapesNotFoundError) {
        return [];
      }
      throw error;
    }
  }

  private async fetchUserPersonalization(
    shapeId: string,
    signal?: AbortSignal
  ): Promise<ShapesIncUserPersonalization | null> {
    const url = `${SHAPES_BASE_URL}/api/shapes/${encodeURIComponent(shapeId)}/user`;

    try {
      const response = await this.makeRequest<ShapesIncUserPersonalization>(url, signal);

      // Check if the response has meaningful data
      if (response.backstory === undefined && response.preferred_name === undefined) {
        return null;
      }
      return response;
    } catch (error) {
      // User personalization is optional
      if (error instanceof ShapesNotFoundError) {
        return null;
      }
      throw error;
    }
  }

  // ==========================================================================
  // HTTP Request Layer
  // ==========================================================================

  /**
   * Make an authenticated request with per-request retry.
   *
   * Retries up to REQUEST_RETRY_COUNT times (3 total attempts) on transient
   * errors (429, 5xx, network timeout, fetch failure) with exponential backoff.
   * Non-retryable errors (401, 403, 404, other 4xx) are thrown immediately.
   * This prevents a single transient failure from restarting the entire BullMQ
   * job (which would re-fetch all pages).
   */
  private async makeRequest<T>(url: string, externalSignal?: AbortSignal): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      // Respect external cancellation across retries
      if (externalSignal?.aborted === true) {
        throw externalSignal.reason;
      }
      try {
        return await this.executeSingleRequest<T>(url, externalSignal);
      } catch (error) {
        // Node.js/undici throws TypeError('fetch failed') for network errors.
        // We check the message to avoid retrying programming TypeErrors
        // (null dereference, etc.) which should fail fast.
        const retryable =
          error instanceof ShapesRateLimitError ||
          error instanceof ShapesServerError ||
          (error instanceof Error && error.name === 'AbortError') ||
          (error instanceof TypeError && error.message.includes('fetch'));
        if (!retryable || attempt >= REQUEST_RETRY_COUNT) {
          throw error;
        }
        const backoff = RETRY_BASE_DELAY_MS * 2 ** attempt;
        logger.warn(
          {
            url,
            attempt,
            backoff,
            errorType: error instanceof Error ? error.constructor.name : 'unknown',
          },
          '[ShapesDataFetcher] Request failed, retrying'
        );
        await this.delay(backoff);
      }
    }
  }

  /**
   * Execute a single authenticated HTTP request to shapes.inc.
   * Updates the cookie jar from set-cookie response headers.
   */
  private async executeSingleRequest<T>(url: string, externalSignal?: AbortSignal): Promise<T> {
    const controller = new AbortController();

    // Combine external signal with timeout
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    if (externalSignal !== undefined) {
      externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    try {
      const response = await fetch(url, {
        headers: {
          Cookie: this.currentCookie,
          'User-Agent': SHAPES_USER_AGENT,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      // Update cookie from response headers
      this.updateCookieFromResponse(response);

      if (response.ok) {
        return (await response.json()) as T;
      }

      // Handle specific error codes
      if (response.status === 401 || response.status === 403) {
        throw new ShapesAuthError(
          `Authentication failed (${response.status}). Session cookie may have expired.`
        );
      }

      if (response.status === 404) {
        throw new ShapesNotFoundError(url);
      }

      if (response.status === 429) {
        throw new ShapesRateLimitError();
      }

      if (response.status >= 500) {
        throw new ShapesServerError(
          response.status,
          `Shapes.inc server error: HTTP ${response.status} from ${url}`
        );
      }

      throw new ShapesFetchError(
        response.status,
        `Shapes.inc API error: HTTP ${response.status} from ${url}`
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Parse set-cookie headers and update the cookie jar with fresh session values.
   * Shapes.inc rotates the appSession cookie on every API call.
   */
  private updateCookieFromResponse(response: Response): void {
    const setCookieHeaders = response.headers.getSetCookie();
    if (setCookieHeaders.length === 0) {
      return;
    }

    // Parse current cookies into a map
    const cookieMap = new Map<string, string>();
    for (const part of this.currentCookie.split(';')) {
      const trimmed = part.trim();
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        cookieMap.set(trimmed.substring(0, eqIdx), trimmed.substring(eqIdx + 1));
      }
    }

    // Update with new cookies from response
    for (const header of setCookieHeaders) {
      // set-cookie: name=value; Path=/; ...
      const cookiePart = header.split(';')[0].trim();
      const eqIdx = cookiePart.indexOf('=');
      if (eqIdx > 0) {
        const name = cookiePart.substring(0, eqIdx);
        const value = cookiePart.substring(eqIdx + 1);
        cookieMap.set(name, value);
      }
    }

    // Rebuild cookie string
    const parts: string[] = [];
    for (const [name, value] of cookieMap) {
      parts.push(`${name}=${value}`);
    }
    this.currentCookie = parts.join('; ');
  }

  private delay(ms = DELAY_BETWEEN_REQUESTS_MS): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
