/**
 * Shapes shared by the model-override route handlers (list/upsert/clear) —
 * extracted from model-override.ts, which rides the max-lines ceiling.
 * Slot semantics are model-specific (text vs vision FK columns), so these
 * deliberately do NOT live in the cross-route configOverrideHelpers.
 */

import type { Response } from 'express';
import type { ModelOverrideSummary } from '@tzurot/common-types/schemas/api/model-override';
import { ADMIN_SETTINGS_SINGLETON_ID } from '@tzurot/common-types/schemas/api/adminSettings';
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
export function parseClearSlots(res: Response, query: unknown): ClearSlots | null {
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

/** One resolved default config the cleared user falls back to, per slot. */
export interface ResolvedDefaultRef {
  id: string;
  name: string;
}

/**
 * Resolve the fallback default(s) a user lands on after clearing their user
 * default — ONE PER CLEARED SLOT (an `all` clear names both the chat AND
 * vision fallback) — picking the POINTER FAMILY by the caller's tier:
 *
 * - keyed (BYOK — has an active API key): the GLOBAL default pointers. A
 *   keyed user's resolution cascade bottoms out at the global default
 *   (PersonalityLoader's S3 tier); the free default never applies to them.
 * - guest (no active key): the FREE default pointers — the guest-mode /
 *   quota-fallback ladder is the only path that serves them.
 *
 * Reads the AdminSettings POINTER columns, never the `isFreeDefault` boolean —
 * setAsFreeDefault writes only the pointers, so the boolean is stale (would
 * show a wrong/missing fallback name after the global free default changes).
 * Per-personality overrides and personality-level defaults sit ABOVE whatever
 * this names and are unaffected by the clear.
 */
export async function resolveClearFallbackDefaults(
  prisma: PrismaClient,
  clearText: boolean,
  clearVision: boolean,
  keyed: boolean
): Promise<{ text?: ResolvedDefaultRef | null; vision?: ResolvedDefaultRef | null }> {
  const settings = await prisma.adminSettings.findUnique({
    where: { id: ADMIN_SETTINGS_SINGLETON_ID },
    select: {
      globalDefaultLlmConfigId: true,
      globalDefaultVisionConfigId: true,
      freeDefaultLlmConfigId: true,
      freeDefaultVisionConfigId: true,
    },
  });
  const pointerIds = keyed
    ? {
        text: settings?.globalDefaultLlmConfigId ?? null,
        vision: settings?.globalDefaultVisionConfigId ?? null,
      }
    : {
        text: settings?.freeDefaultLlmConfigId ?? null,
        vision: settings?.freeDefaultVisionConfigId ?? null,
      };
  const resolvePointer = async (pointerId: string | null): Promise<ResolvedDefaultRef | null> => {
    if (pointerId === null) {
      return null;
    }
    return prisma.llmConfig.findUnique({
      where: { id: pointerId },
      select: { id: true, name: true },
    });
  };
  return {
    ...(clearText ? { text: await resolvePointer(pointerIds.text) } : {}),
    ...(clearVision ? { vision: await resolvePointer(pointerIds.vision) } : {}),
  };
}
