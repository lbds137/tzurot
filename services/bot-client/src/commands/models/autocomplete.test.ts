/**
 * Tests for /models view autocomplete.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AutocompleteInteraction } from 'discord.js';
import type { CatalogModel } from '../../utils/modelCatalog.js';

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
vi.mock('../../utils/modelCatalog.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../utils/modelCatalog.js')>();
  return {
    ...actual,
    fetchModelCatalog: (...args: unknown[]) => catalogMock.fetchModelCatalog(...args),
  };
});

import { handleAutocomplete } from './autocomplete.js';

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
    docsUrl: null,
    source: 'openrouter',
    hasPricing: true,
    ...overrides,
  };
}

function interaction(focused: string): AutocompleteInteraction {
  return {
    options: { getFocused: () => focused },
    respond: vi.fn(),
  } as unknown as AutocompleteInteraction;
}

beforeEach(() => vi.clearAllMocks());

describe('handleAutocomplete', () => {
  it('returns choices with name+value and a z.ai marker', async () => {
    catalogMock.fetchModelCatalog.mockResolvedValue([
      catalogModel({ id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' }),
      catalogModel({ id: 'z-ai/glm-5.2', name: 'GLM-5.2', contextLength: 1_000_000 }),
    ]);
    const ix = interaction('glm');
    await handleAutocomplete(ix);
    const choices = vi.mocked(ix.respond).mock.calls[0][0] as { name: string; value: string }[];
    expect(choices).toHaveLength(2);
    expect(choices[1].value).toBe('z-ai/glm-5.2');
    expect(choices[1].name).toContain('⚡');
    expect(choices[1].name).toContain('1M');
  });

  it('caps choice name/value at 100 chars', async () => {
    catalogMock.fetchModelCatalog.mockResolvedValue([
      catalogModel({ id: `vendor/${'x'.repeat(120)}`, name: 'y'.repeat(120) }),
    ]);
    const ix = interaction('');
    await handleAutocomplete(ix);
    const choices = vi.mocked(ix.respond).mock.calls[0][0] as { name: string; value: string }[];
    expect(choices[0].name.length).toBeLessThanOrEqual(100);
    expect(choices[0].value.length).toBeLessThanOrEqual(100);
  });

  it('responds with an empty list on error', async () => {
    catalogMock.fetchModelCatalog.mockRejectedValue(new Error('boom'));
    const ix = interaction('x');
    await handleAutocomplete(ix);
    expect(ix.respond).toHaveBeenCalledWith([]);
  });
});
