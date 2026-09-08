import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLogger, mockGetCanonical } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
  mockGetCanonical: vi.fn(),
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return { ...actual, createLogger: () => mockLogger };
});

vi.mock('../../redis.js', () => ({
  visionDescriptionCache: { getCanonical: mockGetCanonical },
}));

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: { NODE_ENV: 'test' as string, LOG_CONTENT_PREVIEWS: false },
}));
vi.mock('@tzurot/common-types/config/config', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/config/config')>(
    '@tzurot/common-types/config/config'
  );
  return { ...actual, getConfig: () => mockConfig };
});

import {
  isLikelyErrorDescription,
  isValidVisionDescription,
  readValidCachedDescription,
  VISION_MIN_DESCRIPTION_LENGTH,
} from './visionDescriptionValidity.js';

describe('isLikelyErrorDescription', () => {
  it('detects provider error text returned as content', () => {
    expect(isLikelyErrorDescription('I am unable to access the image you shared.')).toBe(true);
    expect(isLikelyErrorDescription('Error loading the attachment; the URL has expired.')).toBe(
      true
    );
    expect(isLikelyErrorDescription('I was unable to fetch the image URL provided.')).toBe(true);
    expect(isLikelyErrorDescription('Sorry, I cannot access the provided URL.')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isLikelyErrorDescription('UNABLE TO VIEW the image')).toBe(true);
  });

  it('does NOT flag legitimate descriptions that mention an image URL', () => {
    // The old bare 'image url' / 'provided url' substrings mis-classified
    // real descriptions like these, negative-caching a valid result.
    expect(
      isLikelyErrorDescription('The image URL shown in this banner is styled as a hyperlink.')
    ).toBe(false);
    expect(
      isLikelyErrorDescription('A screenshot where the provided URL appears in the address bar.')
    ).toBe(false);
  });

  it('does not flag ordinary descriptions', () => {
    expect(isLikelyErrorDescription('A tabby cat sleeping on a windowsill in the sun.')).toBe(
      false
    );
  });
});

describe('isValidVisionDescription', () => {
  it('accepts a genuine description', () => {
    expect(isValidVisionDescription('A tabby cat sleeping on a windowsill.')).toBe(true);
  });

  it('rejects error-shaped content', () => {
    expect(isValidVisionDescription('I am unable to process the image at this time.')).toBe(false);
  });

  it('rejects content below the minimum length', () => {
    expect(isValidVisionDescription('a'.repeat(VISION_MIN_DESCRIPTION_LENGTH - 1))).toBe(false);
    expect(isValidVisionDescription('   short   ')).toBe(false);
  });

  it('rejects placeholder-marker content', () => {
    expect(isValidVisionDescription('[Image attachment: cat.png]')).toBe(false);
  });
});

describe('readValidCachedDescription', () => {
  const invalidCachedDescription = 'short';

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.NODE_ENV = 'test';
    mockConfig.LOG_CONTENT_PREVIEWS = false;
    mockGetCanonical.mockResolvedValue({
      description: invalidCachedDescription,
      model: 'test-model',
    });
  });

  function invalidCacheLogFields(): Record<string, unknown> {
    const call = mockLogger.warn.mock.calls[0];
    expect(call).toBeDefined();
    return call?.[0] as Record<string, unknown>;
  }

  it('returns null for an invalid cached description', async () => {
    const result = await readValidCachedDescription(
      { url: 'https://example.com/cat.png' },
      { id: 'attachment-1', name: 'cat.png' }
    );

    expect(result).toBeNull();
  });

  it('omits the preview by default, keeping the always-on cachedLength', async () => {
    await readValidCachedDescription(
      { url: 'https://example.com/cat.png' },
      { id: 'attachment-1', name: 'cat.png' }
    );

    const fields = invalidCacheLogFields();
    expect(fields.preview).toBeUndefined();
    expect(fields.cachedLength).toBe(invalidCachedDescription.length);
    expect(JSON.stringify(mockLogger.warn.mock.calls)).not.toContain(invalidCachedDescription);
  });

  it('includes the preview when content previews are enabled', async () => {
    mockConfig.NODE_ENV = 'development';
    mockConfig.LOG_CONTENT_PREVIEWS = true;

    await readValidCachedDescription(
      { url: 'https://example.com/cat.png' },
      { id: 'attachment-1', name: 'cat.png' }
    );

    const fields = invalidCacheLogFields();
    expect(fields.preview).toBe(invalidCachedDescription);
  });
});
