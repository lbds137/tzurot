/**
 * Tests for Shapes Slug Autocomplete Handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AutocompleteInteraction } from 'discord.js';
import { handleShapesSlugAutocomplete } from './autocomplete.js';
import { AUTOCOMPLETE_ERROR_SENTINEL } from '../../utils/apiCheck.js';

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

// Mock autocomplete cache
const mockGetCachedShapes = vi.fn();
vi.mock('../../utils/autocomplete/autocompleteCache.js', () => ({
  getCachedShapes: (...args: unknown[]) => mockGetCachedShapes(...args),
}));

describe('handleShapesSlugAutocomplete', () => {
  const mockRespond = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
  });

  function createMockInteraction(query: string): AutocompleteInteraction {
    return {
      options: { getFocused: () => query },
      user: { id: '123456789' },
      respond: mockRespond,
    } as unknown as AutocompleteInteraction;
  }

  it('should return matching shapes by name', async () => {
    mockGetCachedShapes.mockResolvedValue({
      kind: 'ok',
      value: [
        { name: 'My Bot', username: 'my-bot' },
        { name: 'Test Shape', username: 'test-shape' },
      ],
    });

    await handleShapesSlugAutocomplete(createMockInteraction('bot'));

    expect(mockRespond).toHaveBeenCalledWith([expect.objectContaining({ value: 'my-bot' })]);
  });

  it('should return matching shapes by username', async () => {
    mockGetCachedShapes.mockResolvedValue({
      kind: 'ok',
      value: [
        { name: 'My Bot', username: 'my-bot' },
        { name: 'Test Shape', username: 'test-shape' },
      ],
    });

    await handleShapesSlugAutocomplete(createMockInteraction('test-s'));

    expect(mockRespond).toHaveBeenCalledWith([expect.objectContaining({ value: 'test-shape' })]);
  });

  it('should return all shapes when query is empty', async () => {
    mockGetCachedShapes.mockResolvedValue({
      kind: 'ok',
      value: [
        { name: 'Alpha', username: 'alpha' },
        { name: 'Beta', username: 'beta' },
      ],
    });

    await handleShapesSlugAutocomplete(createMockInteraction(''));

    expect(mockRespond).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ value: 'alpha' }),
        expect.objectContaining({ value: 'beta' }),
      ])
    );
  });

  it('should be case-insensitive', async () => {
    mockGetCachedShapes.mockResolvedValue({
      kind: 'ok',
      value: [{ name: 'My Bot', username: 'my-bot' }],
    });

    await handleShapesSlugAutocomplete(createMockInteraction('MY BOT'));

    expect(mockRespond).toHaveBeenCalledWith([expect.objectContaining({ value: 'my-bot' })]);
  });

  it('should limit results to 25', async () => {
    const shapes = Array.from({ length: 30 }, (_, i) => ({
      name: `Shape ${String(i)}`,
      username: `shape-${String(i)}`,
    }));
    mockGetCachedShapes.mockResolvedValue({ kind: 'ok', value: shapes });

    await handleShapesSlugAutocomplete(createMockInteraction(''));

    const respondArgs = mockRespond.mock.calls[0][0];
    expect(respondArgs).toHaveLength(25);
  });

  it('should return empty array on error', async () => {
    mockGetCachedShapes.mockRejectedValue(new Error('Network error'));

    await handleShapesSlugAutocomplete(createMockInteraction('test'));

    expect(mockRespond).toHaveBeenCalledWith([]);
  });

  it('should render error placeholder when cache returns { kind: "error" }', async () => {
    // Cache's own error path (transient with no stale fallback, or permanent)
    // vs. the throw path above: the handler should respond with a visible
    // placeholder so the user doesn't see an empty list that reads as
    // "you have no shapes" during a backend outage.
    mockGetCachedShapes.mockResolvedValue({ kind: 'error', error: 'Backend down' });

    await handleShapesSlugAutocomplete(createMockInteraction('test'));

    expect(mockRespond).toHaveBeenCalledWith([
      { name: '[Unable to load shapes — try again]', value: AUTOCOMPLETE_ERROR_SENTINEL },
    ]);
  });

  it('should format name with dot separator', async () => {
    mockGetCachedShapes.mockResolvedValue({
      kind: 'ok',
      value: [{ name: 'My Bot', username: 'my-bot' }],
    });

    await handleShapesSlugAutocomplete(createMockInteraction(''));

    expect(mockRespond).toHaveBeenCalledWith([
      expect.objectContaining({
        name: expect.stringContaining('\u00B7'),
        value: 'my-bot',
      }),
    ]);
  });
});
