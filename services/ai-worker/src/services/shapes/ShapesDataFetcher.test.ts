/**
 * Tests for ShapesDataFetcher
 *
 * Tests the shapes.inc API fetcher with mocked HTTP responses.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ShapesDataFetcher } from './ShapesDataFetcher.js';
import {
  ShapesAuthError,
  ShapesNotFoundError,
  ShapesRateLimitError,
  ShapesServerError,
  ShapesFetchError,
} from './shapesErrors.js';

// Mock common-types
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

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock response factory
function createMockResponse(
  status: number,
  body: unknown,
  setCookieHeaders: string[] = []
): Response {
  const headers = new Headers();
  // Headers.getSetCookie() needs the raw set-cookie values
  const response = {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
    headers: {
      ...headers,
      getSetCookie: () => setCookieHeaders,
    },
  } as unknown as Response;
  return response;
}

// Sample data
const SAMPLE_CONFIG = {
  id: 'shape-uuid-123',
  name: 'Test Shape',
  username: 'test-shape',
  avatar: 'https://example.com/avatar.png',
  jailbreak: 'You are a test character.',
  user_prompt: 'Talk like a test.',
  personality_traits: 'friendly, helpful',
  engine_model: 'gpt-4',
  engine_temperature: 0.7,
  stm_window: 10,
  ltm_enabled: true,
  ltm_threshold: 0.5,
  ltm_max_retrieved_summaries: 5,
};

const SAMPLE_MEMORY = {
  id: 'mem-1',
  shape_id: 'shape-uuid-123',
  senders: ['user-1'],
  result: 'User discussed favorite movies.',
  metadata: {
    start_ts: 1700000000,
    end_ts: 1700001000,
    created_at: 1700001000,
    senders: ['user-1'],
  },
};

const SAMPLE_STORY = {
  id: 'story-1',
  shape_id: 'shape-uuid-123',
  story_type: 'general' as const,
  content: 'Once upon a time...',
};

const SAMPLE_USER_PERSONALIZATION = {
  backstory: 'I am a dedicated fan.',
  preferred_name: 'TestUser',
  pronouns: 'they/them',
};

describe('ShapesDataFetcher', () => {
  let fetcher: ShapesDataFetcher;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    fetcher = new ShapesDataFetcher();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchShapeData', () => {
    function setupSuccessfulFetch(): void {
      mockFetch
        // 1. Config fetch
        .mockResolvedValueOnce(createMockResponse(200, SAMPLE_CONFIG))
        // 2. Memories fetch (single page)
        .mockResolvedValueOnce(
          createMockResponse(200, {
            items: [SAMPLE_MEMORY],
            pagination: { has_next: false, page: 1 },
          })
        )
        // 3. Stories fetch
        .mockResolvedValueOnce(createMockResponse(200, [SAMPLE_STORY]))
        // 4. User personalization fetch
        .mockResolvedValueOnce(createMockResponse(200, SAMPLE_USER_PERSONALIZATION));
    }

    it('should fetch all shape data successfully', async () => {
      setupSuccessfulFetch();

      const promise = fetcher.fetchShapeData('test-shape', {
        sessionCookie: 'appSession.0=abc; appSession.1=def',
      });

      // Advance timers for delays between requests
      await vi.advanceTimersByTimeAsync(5000);
      const result = await promise;

      expect(result.config.id).toBe('shape-uuid-123');
      expect(result.config.name).toBe('Test Shape');
      expect(result.memories).toHaveLength(1);
      expect(result.stories).toHaveLength(1);
      expect(result.userPersonalization).not.toBeNull();
      expect(result.stats.memoriesCount).toBe(1);
      expect(result.stats.storiesCount).toBe(1);
    });

    it('should send session cookie in request headers', async () => {
      setupSuccessfulFetch();

      const promise = fetcher.fetchShapeData('test-shape', {
        sessionCookie: 'appSession.0=abc; appSession.1=def',
      });
      await vi.advanceTimersByTimeAsync(5000);
      await promise;

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/shapes/username/test-shape'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Cookie: 'appSession.0=abc; appSession.1=def',
          }),
        })
      );
    });

    it('should handle empty memories', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse(200, SAMPLE_CONFIG))
        .mockResolvedValueOnce(
          createMockResponse(200, {
            items: [],
            pagination: { has_next: false, page: 1 },
          })
        )
        .mockResolvedValueOnce(createMockResponse(200, [SAMPLE_STORY]))
        .mockResolvedValueOnce(createMockResponse(200, SAMPLE_USER_PERSONALIZATION));

      const promise = fetcher.fetchShapeData('test-shape', {
        sessionCookie: 'appSession.0=abc; appSession.1=def',
      });
      await vi.advanceTimersByTimeAsync(5000);
      const result = await promise;

      expect(result.memories).toHaveLength(0);
      expect(result.stats.memoriesCount).toBe(0);
    });

    it('should handle empty stories and null user personalization', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse(200, SAMPLE_CONFIG))
        .mockResolvedValueOnce(
          createMockResponse(200, { items: [], pagination: { has_next: false } })
        )
        .mockResolvedValueOnce(createMockResponse(200, []))
        .mockResolvedValueOnce(createMockResponse(200, {}));

      const promise = fetcher.fetchShapeData('test-shape', {
        sessionCookie: 'appSession.0=abc; appSession.1=def',
      });
      await vi.advanceTimersByTimeAsync(5000);
      const result = await promise;

      expect(result.stories).toHaveLength(0);
      expect(result.userPersonalization).toBeNull();
    });

    it('should paginate through multiple memory pages', async () => {
      const memory2 = { ...SAMPLE_MEMORY, id: 'mem-2', result: 'Second memory' };

      mockFetch
        .mockResolvedValueOnce(createMockResponse(200, SAMPLE_CONFIG))
        // Page 1 - has more
        .mockResolvedValueOnce(
          createMockResponse(200, {
            items: [SAMPLE_MEMORY],
            pagination: { has_next: true, page: 1 },
          })
        )
        // Page 2 - no more
        .mockResolvedValueOnce(
          createMockResponse(200, {
            items: [memory2],
            pagination: { has_next: false, page: 2 },
          })
        )
        .mockResolvedValueOnce(createMockResponse(200, []))
        .mockResolvedValueOnce(createMockResponse(200, {}));

      const promise = fetcher.fetchShapeData('test-shape', {
        sessionCookie: 'appSession.0=abc; appSession.1=def',
      });
      await vi.advanceTimersByTimeAsync(10000);
      const result = await promise;

      expect(result.memories).toHaveLength(2);
      expect(result.stats.pagesTraversed).toBe(2);
    });
  });

  describe('error handling', () => {
    it('should throw ShapesAuthError on 401', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(401, { error: 'Unauthorized' }));

      const promise = fetcher.fetchShapeData('test-shape', {
        sessionCookie: 'appSession.0=abc; appSession.1=def',
      });
      const assertion = expect(promise).rejects.toThrow(ShapesAuthError);
      await vi.advanceTimersByTimeAsync(5000);
      await assertion;
    });

    it('should throw ShapesAuthError on 403', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(403, { error: 'Forbidden' }));

      const promise = fetcher.fetchShapeData('test-shape', {
        sessionCookie: 'appSession.0=abc; appSession.1=def',
      });
      const assertion = expect(promise).rejects.toThrow(ShapesAuthError);
      await vi.advanceTimersByTimeAsync(5000);
      await assertion;
    });

    it('should throw ShapesNotFoundError on 404 for config', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(404, { error: 'Not found' }));

      const promise = fetcher.fetchShapeData('nonexistent', {
        sessionCookie: 'appSession.0=abc; appSession.1=def',
      });
      const assertion = expect(promise).rejects.toThrow(ShapesNotFoundError);
      await vi.advanceTimersByTimeAsync(5000);
      await assertion;
    });

    it('should throw ShapesRateLimitError on 429 after exhausting per-request retries', async () => {
      // 3 attempts (1 initial + 2 retries) before throwing
      mockFetch
        .mockResolvedValueOnce(createMockResponse(429, { error: 'Rate limited' }))
        .mockResolvedValueOnce(createMockResponse(429, { error: 'Rate limited' }))
        .mockResolvedValueOnce(createMockResponse(429, { error: 'Rate limited' }));

      const promise = fetcher.fetchShapeData('test-shape', {
        sessionCookie: 'appSession.0=abc; appSession.1=def',
      });
      const assertion = expect(promise).rejects.toThrow(ShapesRateLimitError);
      await vi.advanceTimersByTimeAsync(30000);
      await assertion;
    });

    it('should throw ShapesServerError on 500 after exhausting per-request retries', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse(500, { error: 'Server error' }))
        .mockResolvedValueOnce(createMockResponse(500, { error: 'Server error' }))
        .mockResolvedValueOnce(createMockResponse(500, { error: 'Server error' }));

      const promise = fetcher.fetchShapeData('test-shape', {
        sessionCookie: 'appSession.0=abc; appSession.1=def',
      });
      const assertion = expect(promise).rejects.toThrow(ShapesServerError);
      await vi.advanceTimersByTimeAsync(30000);
      await assertion;
    });

    it('should throw ShapesServerError on 502 after exhausting per-request retries', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse(502, { error: 'Bad Gateway' }))
        .mockResolvedValueOnce(createMockResponse(502, { error: 'Bad Gateway' }))
        .mockResolvedValueOnce(createMockResponse(502, { error: 'Bad Gateway' }));

      const promise = fetcher.fetchShapeData('test-shape', {
        sessionCookie: 'appSession.0=abc; appSession.1=def',
      });
      const assertion = expect(promise).rejects.toThrow(ShapesServerError);
      await vi.advanceTimersByTimeAsync(30000);
      await assertion;
    });

    it('should throw ShapesFetchError on 4xx client errors (not 401/403/404/429)', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(422, { error: 'Unprocessable' }));

      const promise = fetcher.fetchShapeData('test-shape', {
        sessionCookie: 'appSession.0=abc; appSession.1=def',
      });
      const assertion = expect(promise).rejects.toThrow(ShapesFetchError);
      await vi.advanceTimersByTimeAsync(5000);
      await assertion;
    });

    it('should treat 404 on memories as empty (not an error)', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse(200, SAMPLE_CONFIG))
        .mockResolvedValueOnce(createMockResponse(404, { error: 'Not found' }))
        .mockResolvedValueOnce(createMockResponse(200, []))
        .mockResolvedValueOnce(createMockResponse(200, {}));

      const promise = fetcher.fetchShapeData('test-shape', {
        sessionCookie: 'appSession.0=abc; appSession.1=def',
      });
      await vi.advanceTimersByTimeAsync(5000);
      const result = await promise;

      expect(result.memories).toHaveLength(0);
    });

    it('should treat 404 on stories as empty', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse(200, SAMPLE_CONFIG))
        .mockResolvedValueOnce(
          createMockResponse(200, { items: [], pagination: { has_next: false } })
        )
        .mockResolvedValueOnce(createMockResponse(404, { error: 'Not found' }))
        .mockResolvedValueOnce(createMockResponse(200, SAMPLE_USER_PERSONALIZATION));

      const promise = fetcher.fetchShapeData('test-shape', {
        sessionCookie: 'appSession.0=abc; appSession.1=def',
      });
      await vi.advanceTimersByTimeAsync(5000);
      const result = await promise;

      expect(result.stories).toHaveLength(0);
    });
  });

  describe('per-request retry', () => {
    it('should retry 429 and succeed on next attempt', async () => {
      mockFetch
        // Config: 429 then success
        .mockResolvedValueOnce(createMockResponse(429, { error: 'Rate limited' }))
        .mockResolvedValueOnce(createMockResponse(200, SAMPLE_CONFIG))
        // Memories
        .mockResolvedValueOnce(
          createMockResponse(200, { items: [], pagination: { has_next: false } })
        )
        // Stories
        .mockResolvedValueOnce(createMockResponse(200, []))
        // User personalization
        .mockResolvedValueOnce(createMockResponse(200, {}));

      const promise = fetcher.fetchShapeData('test-shape', {
        sessionCookie: 'appSession.0=abc; appSession.1=def',
      });
      await vi.advanceTimersByTimeAsync(30000);
      const result = await promise;

      expect(result.config.id).toBe('shape-uuid-123');
      expect(mockFetch).toHaveBeenCalledTimes(5);
    });

    it('should retry 500 and succeed on next attempt', async () => {
      mockFetch
        // Config: 500 then success
        .mockResolvedValueOnce(createMockResponse(500, { error: 'Server error' }))
        .mockResolvedValueOnce(createMockResponse(200, SAMPLE_CONFIG))
        // Memories
        .mockResolvedValueOnce(
          createMockResponse(200, { items: [], pagination: { has_next: false } })
        )
        // Stories
        .mockResolvedValueOnce(createMockResponse(200, []))
        // User personalization
        .mockResolvedValueOnce(createMockResponse(200, {}));

      const promise = fetcher.fetchShapeData('test-shape', {
        sessionCookie: 'appSession.0=abc; appSession.1=def',
      });
      await vi.advanceTimersByTimeAsync(30000);
      const result = await promise;

      expect(result.config.id).toBe('shape-uuid-123');
      expect(mockFetch).toHaveBeenCalledTimes(5);
    });

    it('should retry network timeout (AbortError) and succeed', async () => {
      mockFetch
        // Config: timeout then success
        .mockRejectedValueOnce(new DOMException('The operation was aborted', 'AbortError'))
        .mockResolvedValueOnce(createMockResponse(200, SAMPLE_CONFIG))
        // Memories
        .mockResolvedValueOnce(
          createMockResponse(200, { items: [], pagination: { has_next: false } })
        )
        // Stories
        .mockResolvedValueOnce(createMockResponse(200, []))
        // User personalization
        .mockResolvedValueOnce(createMockResponse(200, {}));

      const promise = fetcher.fetchShapeData('test-shape', {
        sessionCookie: 'appSession.0=abc; appSession.1=def',
      });
      await vi.advanceTimersByTimeAsync(30000);
      const result = await promise;

      expect(result.config.id).toBe('shape-uuid-123');
    });

    it('should NOT retry 401 (immediate throw, no retry)', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(401, { error: 'Unauthorized' }));

      const promise = fetcher.fetchShapeData('test-shape', {
        sessionCookie: 'appSession.0=abc; appSession.1=def',
      });
      const assertion = expect(promise).rejects.toThrow(ShapesAuthError);
      await vi.advanceTimersByTimeAsync(5000);
      await assertion;

      // Only 1 fetch call — no retries for auth errors
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should NOT retry 404 (immediate throw, no retry)', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(404, { error: 'Not found' }));

      const promise = fetcher.fetchShapeData('test-shape', {
        sessionCookie: 'appSession.0=abc; appSession.1=def',
      });
      const assertion = expect(promise).rejects.toThrow(ShapesNotFoundError);
      await vi.advanceTimersByTimeAsync(5000);
      await assertion;

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should NOT retry 422 (immediate throw, no retry)', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(422, { error: 'Unprocessable' }));

      const promise = fetcher.fetchShapeData('test-shape', {
        sessionCookie: 'appSession.0=abc; appSession.1=def',
      });
      const assertion = expect(promise).rejects.toThrow(ShapesFetchError);
      await vi.advanceTimersByTimeAsync(5000);
      await assertion;

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should exhaust all retries then throw on persistent 429', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse(429, { error: 'Rate limited' }))
        .mockResolvedValueOnce(createMockResponse(429, { error: 'Rate limited' }))
        .mockResolvedValueOnce(createMockResponse(429, { error: 'Rate limited' }));

      const promise = fetcher.fetchShapeData('test-shape', {
        sessionCookie: 'appSession.0=abc; appSession.1=def',
      });
      const assertion = expect(promise).rejects.toThrow(ShapesRateLimitError);
      await vi.advanceTimersByTimeAsync(30000);
      await assertion;

      // 3 calls: initial + 2 retries
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('cookie rotation', () => {
    it('should update cookie from set-cookie response headers', async () => {
      mockFetch
        .mockResolvedValueOnce(
          createMockResponse(200, SAMPLE_CONFIG, [
            'appSession.0=new-value-0; Path=/; HttpOnly',
            'appSession.1=new-value-1; Path=/; HttpOnly',
          ])
        )
        .mockResolvedValueOnce(
          createMockResponse(200, { items: [], pagination: { has_next: false } })
        )
        .mockResolvedValueOnce(createMockResponse(200, []))
        .mockResolvedValueOnce(createMockResponse(200, {}));

      const promise = fetcher.fetchShapeData('test-shape', {
        sessionCookie: 'appSession.0=old-0; appSession.1=old-1',
      });
      await vi.advanceTimersByTimeAsync(5000);
      await promise;

      // Second request should use updated cookie
      const secondCallHeaders = mockFetch.mock.calls[1][1].headers;
      expect(secondCallHeaders.Cookie).toContain('appSession.0=new-value-0');
      expect(secondCallHeaders.Cookie).toContain('appSession.1=new-value-1');
    });

    it('should expose updated cookie via getUpdatedCookie()', async () => {
      mockFetch
        .mockResolvedValueOnce(
          createMockResponse(200, SAMPLE_CONFIG, [
            'appSession.0=rotated-0; Path=/; HttpOnly',
            'appSession.1=rotated-1; Path=/; HttpOnly',
          ])
        )
        .mockResolvedValueOnce(
          createMockResponse(200, { items: [], pagination: { has_next: false } })
        )
        .mockResolvedValueOnce(createMockResponse(200, []))
        .mockResolvedValueOnce(createMockResponse(200, {}));

      const promise = fetcher.fetchShapeData('test-shape', {
        sessionCookie: 'appSession.0=old-0; appSession.1=old-1',
      });
      await vi.advanceTimersByTimeAsync(5000);
      await promise;

      const updatedCookie = fetcher.getUpdatedCookie();
      expect(updatedCookie).toContain('appSession.0=rotated-0');
      expect(updatedCookie).toContain('appSession.1=rotated-1');
    });
  });

  describe('stories response format handling', () => {
    it('should handle stories as array', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse(200, SAMPLE_CONFIG))
        .mockResolvedValueOnce(
          createMockResponse(200, { items: [], pagination: { has_next: false } })
        )
        .mockResolvedValueOnce(createMockResponse(200, [SAMPLE_STORY]))
        .mockResolvedValueOnce(createMockResponse(200, {}));

      const promise = fetcher.fetchShapeData('test-shape', {
        sessionCookie: 'appSession.0=abc; appSession.1=def',
      });
      await vi.advanceTimersByTimeAsync(5000);
      const result = await promise;

      expect(result.stories).toHaveLength(1);
    });

    it('should handle stories as object with items', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse(200, SAMPLE_CONFIG))
        .mockResolvedValueOnce(
          createMockResponse(200, { items: [], pagination: { has_next: false } })
        )
        .mockResolvedValueOnce(createMockResponse(200, { items: [SAMPLE_STORY] }))
        .mockResolvedValueOnce(createMockResponse(200, {}));

      const promise = fetcher.fetchShapeData('test-shape', {
        sessionCookie: 'appSession.0=abc; appSession.1=def',
      });
      await vi.advanceTimersByTimeAsync(5000);
      const result = await promise;

      expect(result.stories).toHaveLength(1);
    });
  });
});
