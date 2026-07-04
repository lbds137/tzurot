import { isFreeModel } from '@tzurot/common-types/constants/ai';

/**
 * Coarse quality tier for a resolved vision model, used by the vision-description
 * cache's monotonic promotion: a higher-or-equal-tier success may overwrite the
 * canonical entry, a lower-tier one may not — so a weak free model can never
 * clobber a strong paid model's description.
 *
 * Deliberately coarse: free models (`openrouter/free`, `*:free`) are tier 1,
 * everything else tier 2. The free-vs-paid split is exactly what drives the
 * free-tier cache-miss bug this fixes; split into finer tiers later if a real
 * quality ordering among paid models ever matters.
 */
export const VISION_MODEL_TIER = {
  FREE: 1,
  PAID: 2,
} as const;

export function visionModelTier(model: string): number {
  return isFreeModel(model) ? VISION_MODEL_TIER.FREE : VISION_MODEL_TIER.PAID;
}
