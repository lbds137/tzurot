/**
 * Guarded accessors for the FREE model floors (`fallbackTextModelFree` /
 * `fallbackVisionModelFree`) — the single place the billing firewall for
 * guest floor reads is enforced.
 *
 * The floors are runtime settings (admin-editable DB values). Their write
 * validator enforces free-route-only, but an out-of-band bag edit is a real
 * vector (the bag has been repaired by raw SQL), and a guest running a paid
 * model on the system OpenRouter key bills the owner. So every READ of a free
 * floor re-checks `isFreeModel` and degrades to the static free router — the
 * same belt-and-braces stance as the write validator, enforced at the last
 * moment before the value can select a model.
 *
 * Always read floors through these helpers; a bare
 * `getSystemSetting('fallback*ModelFree')` call site is a firewall bypass.
 */

import { FREE_ROUTER_MODEL, isFreeModel } from '@tzurot/common-types/constants/ai';
import { getSystemSetting } from '@tzurot/common-types/services/SystemSettingsService';

/** The guest-safe TEXT floor — free-route guaranteed. */
export function getFreeTextFloor(): string {
  const configured = getSystemSetting('fallbackTextModelFree');
  return isFreeModel(configured) ? configured : FREE_ROUTER_MODEL;
}

/** The guest-safe VISION floor — free-route guaranteed. */
export function getFreeVisionFloor(): string {
  const configured = getSystemSetting('fallbackVisionModelFree');
  return isFreeModel(configured) ? configured : FREE_ROUTER_MODEL;
}
