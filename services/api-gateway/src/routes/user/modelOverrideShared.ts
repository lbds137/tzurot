/**
 * Shapes shared by the model-override route handlers (list/upsert/clear) —
 * extracted from model-override.ts, which rides the max-lines ceiling.
 * Slot semantics are model-specific (text vs vision FK columns), so these
 * deliberately do NOT live in the cross-route configOverrideHelpers.
 */

import type { Request, Response } from 'express';
import { parseModelSlotQueryAllowAll } from '../../utils/configRouteHelpers.js';

/**
 * Select shape shared by the override list and upsert responses. `model`
 * feeds the capability-driven supportsVision badge at both call sites.
 */
export const OVERRIDE_SUMMARY_SELECT = {
  personalityId: true,
  personality: { select: { name: true } },
  llmConfigId: true,
  llmConfig: { select: { name: true, model: true } },
  visionConfigId: true,
  visionConfig: { select: { name: true, model: true } },
} as const;

export interface ClearSlots {
  slot: 'text' | 'vision' | 'all';
  clearText: boolean;
  clearVision: boolean;
}

/**
 * Parse the allow-all `?slot=` query for the clear/delete handlers and derive
 * which FK columns the operation touches. `all` (the bot-client default when
 * no slot is chosen) clears BOTH slots; an explicit text|vision clears one.
 * Returns null after the parser has sent the error response.
 */
export function parseClearSlots(res: Response, query: Request['query']): ClearSlots | null {
  const slot = parseModelSlotQueryAllowAll(res, query);
  if (slot === null) {
    return null;
  }
  return {
    slot,
    clearText: slot === 'text' || slot === 'all',
    clearVision: slot === 'vision' || slot === 'all',
  };
}
