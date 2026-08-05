/**
 * Tests for the shared merged-catalog autocomplete responder.
 *
 * Consumer-side wiring (dispatch, query plumbing) is pinned by the
 * models/ and preset/ autocomplete suites; this suite pins the responder's
 * own contract directly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AutocompleteInteraction } from 'discord.js';
import type { CatalogModel } from './modelCatalog.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

const catalogMock = { fetchModelCatalog: vi.fn() };
vi.mock('./modelCatalog.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./modelCatalog.js')>();
  return {
    ...actual,
    fetchModelCatalog: (...args: unknown[]) => catalogMock.fetchModelCatalog(...args),
  };
});

import { respondWithCatalogAutocomplete } from './modelCatalogAutocomplete.js';

function catalogModel(overrides: Partial<CatalogModel> & { id: string }): CatalogModel {
  return {
    name: overrides.id,
    contextLength: 200_000,
    supportsVision: false,
    supportsImageGeneration: false,
    supportsAudioInput: false,
    supportsAudioOutput: false,
    promptPricePerMillion: 3,
    completionPricePerMillion: 15,
    isZaiCoding: overrides.id.startsWith('z-ai/'),
    source: overrides.id.startsWith('z-ai/') ? 'zai-catalog' : 'openrouter',
    ...overrides,
  } as CatalogModel;
}

function mockInteraction(): AutocompleteInteraction {
  return { respond: vi.fn() } as unknown as AutocompleteInteraction;
}

function respondedChoices(ix: AutocompleteInteraction): { name: string; value: string }[] {
  return vi.mocked(ix.respond).mock.calls[0][0] as { name: string; value: string }[];
}

describe('respondWithCatalogAutocomplete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('formats catalog entries and ⚡-badges z.ai coding-plan models', async () => {
    catalogMock.fetchModelCatalog.mockResolvedValue([
      catalogModel({ id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' }),
      catalogModel({ id: 'z-ai/glm-5.2', name: 'GLM 5.2' }),
    ]);
    const ix = mockInteraction();

    await respondWithCatalogAutocomplete(ix, 'glm');

    expect(catalogMock.fetchModelCatalog).toHaveBeenCalledWith({ search: 'glm', limit: 25 });
    const choices = respondedChoices(ix);
    expect(choices[0].value).toBe('anthropic/claude-sonnet-4');
    expect(choices[1].value).toBe('z-ai/glm-5.2');
    expect(choices[1].name).toContain('⚡');
    expect(choices[0].name).not.toContain('⚡');
  });

  it('omits the search term for an empty query and re-caps at the 25-choice ceiling', async () => {
    catalogMock.fetchModelCatalog.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => catalogModel({ id: `vendor/model-${i}` }))
    );
    const ix = mockInteraction();

    await respondWithCatalogAutocomplete(ix, '');

    expect(catalogMock.fetchModelCatalog).toHaveBeenCalledWith({ search: undefined, limit: 25 });
    expect(respondedChoices(ix)).toHaveLength(25);
  });

  it('truncates an over-long model id to the 100-char Discord value limit', async () => {
    catalogMock.fetchModelCatalog.mockResolvedValue([
      catalogModel({ id: `vendor/${'x'.repeat(120)}` }),
    ]);
    const ix = mockInteraction();

    await respondWithCatalogAutocomplete(ix, 'x');

    expect(respondedChoices(ix)[0].value).toHaveLength(100);
  });

  it('responds with an empty list when the catalog fetch throws (lenient contract)', async () => {
    catalogMock.fetchModelCatalog.mockRejectedValue(new Error('gateway down'));
    const ix = mockInteraction();

    await respondWithCatalogAutocomplete(ix, 'claude');

    expect(vi.mocked(ix.respond)).toHaveBeenCalledWith([]);
  });
});
