/**
 * Tests for the model catalog merge + usability annotation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ModelAutocompleteOption } from '@tzurot/common-types/types/ai';
import { InfraError } from '@tzurot/clients';

// Mock the OpenRouter fetch layer so tests control the OpenRouter side of the
// merge; the z.ai catalog half comes from the real listZaiCodingPlanModels().
vi.mock('./modelAutocomplete.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./modelAutocomplete.js')>();
  return { ...actual, fetchModels: vi.fn() };
});

import { fetchModels } from './modelAutocomplete.js';
import {
  fetchModelCatalog,
  fetchCatalogModelById,
  annotateUsability,
  formatCapabilities,
  zaiDisplayName,
  zaiReleasedToUnix,
  type CatalogModel,
} from './modelCatalog.js';

const fetchModelsMock = vi.mocked(fetchModels);

function model(
  overrides: Partial<ModelAutocompleteOption> & { id: string }
): ModelAutocompleteOption {
  return {
    name: overrides.id,
    contextLength: 128_000,
    supportsVision: false,
    supportsImageGeneration: false,
    supportsAudioInput: false,
    supportsAudioOutput: false,
    promptPricePerMillion: 1,
    completionPricePerMillion: 2,
    ...overrides,
  };
}

beforeEach(() => {
  fetchModelsMock.mockReset();
});

describe('fetchModelCatalog', () => {
  it('merges z.ai-only models (e.g. glm-5.2) absent from OpenRouter', async () => {
    fetchModelsMock.mockResolvedValue([
      model({ id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' }),
    ]);
    const catalog = await fetchModelCatalog();
    const glm52 = catalog.find(m => m.id === 'z-ai/glm-5.2');
    expect(glm52).toBeDefined();
    expect(glm52?.source).toBe('zai-catalog');
    expect(glm52?.isZaiCoding).toBe(true);
    expect(glm52?.hasPricing).toBe(false);
    expect(glm52?.contextLength).toBe(1_000_000);
    expect(glm52?.docsUrl).toMatch(/docs\.z\.ai/);
    // Display name title-cases each dash segment, keeping GLM fully uppercase.
    expect(glm52?.name).toBe('GLM-5.2');
    // z.ai-catalog-only entries are never meta-routers.
    expect(glm52?.isRouter).toBe(false);
  });

  it('passes the OpenRouter isRouter flag through to the catalog entry', async () => {
    fetchModelsMock.mockResolvedValue([
      model({ id: 'openrouter/auto', name: 'Auto Router', isRouter: true }),
      model({ id: 'openai/gpt-5', isRouter: false }),
    ]);
    const catalog = await fetchModelCatalog();
    expect(catalog.find(m => m.id === 'openrouter/auto')?.isRouter).toBe(true);
    expect(catalog.find(m => m.id === 'openai/gpt-5')?.isRouter).toBe(false);
  });

  it('dedups a z.ai model present in both sources to source=both, keeping OpenRouter pricing', async () => {
    fetchModelsMock.mockResolvedValue([
      model({
        id: 'z-ai/glm-5',
        name: 'GLM 5',
        promptPricePerMillion: 0.5,
        completionPricePerMillion: 1.5,
      }),
    ]);
    const catalog = await fetchModelCatalog();
    const glm5 = catalog.filter(m => m.id.toLowerCase() === 'z-ai/glm-5');
    expect(glm5).toHaveLength(1); // deduped, not duplicated
    expect(glm5[0].source).toBe('both');
    expect(glm5[0].hasPricing).toBe(true);
    expect(glm5[0].promptPricePerMillion).toBe(0.5);
    expect(glm5[0].docsUrl).toMatch(/docs\.z\.ai/); // z.ai docs attached
  });

  it('annotates an OpenRouter model with isZaiCoding=false and source=openrouter', async () => {
    fetchModelsMock.mockResolvedValue([model({ id: 'openai/gpt-5' })]);
    const catalog = await fetchModelCatalog();
    const gpt = catalog.find(m => m.id === 'openai/gpt-5');
    expect(gpt?.isZaiCoding).toBe(false);
    expect(gpt?.source).toBe('openrouter');
    expect(gpt?.hasPricing).toBe(true);
  });

  it('marks negative-priced meta/auto-routers as hasPricing=false', async () => {
    // openrouter/auto et al. carry -1 pricing (cost depends on what they route to).
    fetchModelsMock.mockResolvedValue([
      model({
        id: 'openrouter/auto',
        name: 'Auto Router',
        promptPricePerMillion: -1_000_000,
        completionPricePerMillion: -1_000_000,
      }),
    ]);
    const auto = (await fetchModelCatalog()).find(m => m.id === 'openrouter/auto');
    expect(auto?.hasPricing).toBe(false);
    expect(auto?.source).toBe('openrouter');
  });

  it('excludes z.ai (text-only) models from the vision capability view', async () => {
    fetchModelsMock.mockResolvedValue([
      model({ id: 'anthropic/claude-sonnet-4', supportsVision: true }),
    ]);
    const catalog = await fetchModelCatalog({ capability: 'vision' });
    expect(catalog.some(m => m.id.startsWith('z-ai/'))).toBe(false);
    // and it requests the vision endpoint
    expect(fetchModelsMock).toHaveBeenCalledWith(expect.objectContaining({ visionOnly: true }));
  });

  it('filters z.ai models by search term', async () => {
    fetchModelsMock.mockResolvedValue([]);
    const matching = await fetchModelCatalog({ search: 'glm-5.2' });
    expect(matching.some(m => m.id === 'z-ai/glm-5.2')).toBe(true);
    const nonMatching = await fetchModelCatalog({ search: 'nonexistent-xyz' });
    expect(nonMatching.some(m => m.id.startsWith('z-ai/'))).toBe(false);
  });
});

describe('fetchCatalogModelById', () => {
  it('returns the exact-id match', async () => {
    fetchModelsMock.mockResolvedValue([
      model({ id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' }),
      model({ id: 'anthropic/claude-haiku-4' }),
    ]);
    const found = await fetchCatalogModelById('anthropic/claude-sonnet-4');
    expect(found?.name).toBe('Claude Sonnet 4');
  });

  it('finds a z.ai-only model by id', async () => {
    fetchModelsMock.mockResolvedValue([]);
    const found = await fetchCatalogModelById('z-ai/glm-5.2');
    expect(found?.contextLength).toBe(1_000_000);
  });

  it('returns null when nothing matches exactly', async () => {
    fetchModelsMock.mockResolvedValue([model({ id: 'anthropic/claude-sonnet-4' })]);
    expect(await fetchCatalogModelById('anthropic/claude')).toBeNull();
  });

  it('uses strict mode so a gateway failure surfaces as "try again", not a false "not found"', async () => {
    fetchModelsMock.mockResolvedValue([model({ id: 'anthropic/claude-sonnet-4' })]);
    await fetchCatalogModelById('anthropic/claude-sonnet-4');
    expect(fetchModelsMock).toHaveBeenCalledWith(expect.objectContaining({ strict: true }));
  });

  it('propagates an InfraError instead of swallowing it into a null "not found"', async () => {
    fetchModelsMock.mockRejectedValue(
      new InfraError({ ok: false, kind: 'timeout', error: 'timed out', status: 0 })
    );
    await expect(fetchCatalogModelById('anthropic/claude-sonnet-4')).rejects.toThrow(InfraError);
  });
});

describe('annotateUsability', () => {
  const cat = (overrides: Partial<CatalogModel> & { id: string }): CatalogModel => ({
    ...model(overrides),
    isZaiCoding: overrides.id.startsWith('z-ai/'),
    docsUrl: null,
    source: 'openrouter',
    hasPricing: true,
    ...overrides,
  });

  it('marks free models usable regardless of keys', () => {
    const [r] = annotateUsability([cat({ id: 'google/gemma:free' })], new Set());
    expect(r.usability).toBe('free');
    expect(r.canUse).toBe(true);
  });

  it('marks an OpenRouter model usable when the user has an openrouter key', () => {
    const [r] = annotateUsability(
      [cat({ id: 'anthropic/claude-sonnet-4' })],
      new Set(['openrouter'])
    );
    expect(r.usability).toBe('usable');
    expect(r.canUse).toBe(true);
  });

  it('flags needs-openrouter-key when the user has no key', () => {
    const [r] = annotateUsability([cat({ id: 'anthropic/claude-sonnet-4' })], new Set());
    expect(r.usability).toBe('needs-openrouter-key');
    expect(r.canUse).toBe(false);
  });

  it('flags needs-zai-key for a z.ai-ONLY model (zai-catalog) without a z.ai key', () => {
    const [r] = annotateUsability(
      [cat({ id: 'z-ai/glm-5.2', isZaiCoding: true, source: 'zai-catalog', hasPricing: false })],
      new Set(['openrouter']) // an OpenRouter key does NOT unlock a z.ai-only model
    );
    expect(r.usability).toBe('needs-zai-key');
    expect(r.canUse).toBe(false);
  });

  it('marks a z.ai-only model usable with a zai-coding key', () => {
    const [r] = annotateUsability(
      [cat({ id: 'z-ai/glm-5.2', isZaiCoding: true, source: 'zai-catalog', hasPricing: false })],
      new Set(['zai-coding'])
    );
    expect(r.canUse).toBe(true);
  });

  it('treats a coding-plan model on BOTH sources as usable via EITHER key', () => {
    // z-ai/glm-5 lives on OpenRouter too — an OR key (fallthrough) or a z.ai key
    // (direct) both unlock it.
    const both = cat({ id: 'z-ai/glm-5', isZaiCoding: true, source: 'both' });
    expect(annotateUsability([both], new Set(['openrouter']))[0].canUse).toBe(true);
    expect(annotateUsability([both], new Set(['zai-coding']))[0].canUse).toBe(true);
    // Neither key → name BOTH paths, not just one.
    expect(annotateUsability([both], new Set())[0].usability).toBe('needs-either-key');
  });

  it('marks non-free models unknown when keys could not be fetched (null providers)', () => {
    const [r] = annotateUsability([cat({ id: 'anthropic/claude-sonnet-4' })], null);
    expect(r.usability).toBe('unknown');
    expect(r.canUse).toBe(false);
  });

  it('keeps free models usable even when keys could not be fetched (null providers)', () => {
    const [r] = annotateUsability([cat({ id: 'google/gemma:free' })], null);
    expect(r.usability).toBe('free');
    expect(r.canUse).toBe(true);
  });

  it('a z-ai/ model NOT on the coding plan needs an OpenRouter key (routes via OR)', () => {
    // e.g. z-ai/glm-4.6 — on OpenRouter, not in the coding-plan catalog, so
    // source is plain 'openrouter' and the z-ai/ prefix must NOT imply z.ai.
    const [r] = annotateUsability(
      [cat({ id: 'z-ai/glm-4.6', isZaiCoding: false, source: 'openrouter' })],
      new Set(['zai-coding']) // a z.ai key does NOT unlock it
    );
    expect(r.usability).toBe('needs-openrouter-key');
    expect(r.canUse).toBe(false);
  });
});

describe('formatCapabilities', () => {
  it('always includes text and appends present capabilities', () => {
    const out = formatCapabilities(
      model({ id: 'x', supportsVision: true, supportsAudioInput: true })
    );
    expect(out).toContain('text');
    expect(out).toContain('vision');
    expect(out).toContain('audio-in');
    expect(out).not.toContain('image-gen');
  });
});

describe('zaiDisplayName', () => {
  it('upper-cases recognized acronyms and title-cases the rest', () => {
    expect(zaiDisplayName('glm-5.2')).toBe('GLM-5.2');
    expect(zaiDisplayName('glm-5-turbo')).toBe('GLM-5-Turbo');
    // Acronym set covers more than GLM (forward-looking for future z.ai-only slugs).
    expect(zaiDisplayName('glm-4-vl')).toBe('GLM-4-VL');
    expect(zaiDisplayName('deepseek-r1')).toBe('Deepseek-R1');
  });
});

describe('zaiReleasedToUnix', () => {
  it('converts an ISO date to Unix seconds', () => {
    expect(zaiReleasedToUnix('2026-06-13')).toBe(Math.floor(Date.parse('2026-06-13') / 1000));
  });

  it('returns undefined for a missing or malformed date (never NaN)', () => {
    expect(zaiReleasedToUnix(undefined)).toBeUndefined();
    expect(zaiReleasedToUnix('not-a-date')).toBeUndefined();
  });
});
