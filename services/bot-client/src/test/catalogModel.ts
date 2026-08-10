/**
 * Shared `CatalogModel` test fixture builder.
 *
 * `CatalogModel` (the merged OpenRouter + z.ai catalog shape consumed by
 * `/models`, `/preset`, and the shared autocomplete responder) was hand-built
 * with slightly-diverged defaults in three test files. This builder is the
 * single source: `isZaiCoding` and `source` default via
 * `isZaiCodingPlanModel()` — the same GLM-family membership check production's
 * `fromOpenRouter`/z.ai-merge logic uses (a `z-ai/`-prefixed id that is not a
 * real coding-plan model computes `false`/`'openrouter'`, matching
 * production). The computed `source` is only ever `'openrouter'` or
 * `'zai-catalog'` — never `'both'`, which production's z.ai merge emits when
 * a coding-plan model is ALSO present in the OpenRouter feed (the common case
 * for real z.ai models). Callers needing `'both'`, or any other different
 * value, pass an explicit override.
 */
import { isZaiCodingPlanModel } from '@tzurot/common-types/constants/ai';
import type { CatalogModel } from '../utils/modelCatalog.js';

export function catalogModel(overrides: Partial<CatalogModel> & { id: string }): CatalogModel {
  const isZaiId = isZaiCodingPlanModel(overrides.id);
  return {
    name: overrides.id,
    contextLength: 200_000,
    supportsVision: false,
    supportsImageGeneration: false,
    supportsAudioInput: false,
    supportsAudioOutput: false,
    promptPricePerMillion: 3,
    completionPricePerMillion: 15,
    isZaiCoding: isZaiId,
    docsUrl: null,
    source: isZaiId ? 'zai-catalog' : 'openrouter',
    hasPricing: true,
    ...overrides,
  };
}
