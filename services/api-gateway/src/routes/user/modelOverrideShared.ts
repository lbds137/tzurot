/**
 * Shapes shared by the model-override route handlers (list/upsert/clear) —
 * extracted from model-override.ts, which rides the max-lines ceiling.
 * Slot semantics are model-specific (text vs vision FK columns), so these
 * deliberately do NOT live in the cross-route configOverrideHelpers.
 */

import type { Request, Response } from 'express';
import type { ModelOverrideSummary } from '@tzurot/common-types/schemas/api/model-override';
import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { parseModelSlotQueryAllowAll } from '../../utils/configRouteHelpers.js';
import type { ModelCapabilityService } from '../../services/ModelCapabilityService.js';

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

/** The row shape {@link OVERRIDE_SUMMARY_SELECT} produces. */
export interface OverrideSummaryRow {
  personalityId: string;
  personality: { name: string };
  llmConfigId: string | null;
  llmConfig: { name: string; model: string } | null;
  visionConfigId: string | null;
  visionConfig: { name: string; model: string } | null;
}

/**
 * Build one slot-tagged summary from an OVERRIDE_SUMMARY_SELECT row — the
 * single emitter behind the LIST (one row per non-null FK) and SET responses,
 * so the summary shape and its supportsVision enrichment cannot drift between
 * them. Independent per row, so LIST callers can `Promise.all` the map
 * (OpenRouterModelCache coalesces in-flight fetches — concurrent is the
 * intended shape, matching the user/llm-config list handler).
 */
export async function buildOverrideSummary(
  override: OverrideSummaryRow,
  slot: 'text' | 'vision',
  capabilities: ModelCapabilityService
): Promise<ModelOverrideSummary> {
  const isVision = slot === 'vision';
  const config = isVision ? override.visionConfig : override.llmConfig;
  return {
    personalityId: override.personalityId,
    personalityName: override.personality.name,
    configId: isVision ? override.visionConfigId : override.llmConfigId,
    configName: config?.name ?? null,
    slot,
    supportsVision: await capabilities.supportsVision(config?.model ?? ''),
  };
}

/**
 * Verify that the given LLM config exists and the user can access it (global or owned).
 * Returns the config (incl. its `model`) if accessible, null otherwise. The slot a
 * config occupies (chat vs vision) is the caller's request, NOT a property of the
 * config — so the set handlers pick the FK column from `?slot=`. `model` is returned
 * so the vision slot can be capability-gated (the model must support image input).
 */
export async function verifyConfigAccess(
  prisma: PrismaClient,
  configId: string,
  userId: string
): Promise<{ id: string; name: string; model: string } | null> {
  return prisma.llmConfig.findFirst({
    where: {
      id: configId,
      OR: [{ isGlobal: true }, { ownerId: userId }],
    },
    select: { id: true, name: true, model: true },
  });
}

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
