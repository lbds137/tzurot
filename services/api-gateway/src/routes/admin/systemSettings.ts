/**
 * Admin System Settings Routes
 * Owner-only endpoints for the `admin_settings.system_settings` JSONB bag —
 * NON-CASCADING operational settings (design: admin-runtime-settings D1/D7/D9/D10).
 *
 * Endpoints:
 * - GET /admin/settings/system - Read the bag + the optimistic-concurrency token
 * - PATCH /admin/settings/system - Validated partial write
 *
 * Write pipeline: wire-schema parse → registry-driven semantic validation
 * (env-key coherence, model catalog/capability, free-route firewall) →
 * optimistic-concurrency merge (unknown keys preserved) → per-key audit log →
 * invalidation publish.
 */

import { type Request, type RequestHandler, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { getConfig } from '@tzurot/common-types/config/config';
import { isFreeModel, isZaiCodingPlanModel } from '@tzurot/common-types/constants/ai';
import { ADMIN_SETTINGS_SINGLETON_ID } from '@tzurot/common-types/schemas/api/adminSettings';
import {
  SYSTEM_SETTINGS_REGISTRY,
  UpdateSystemSettingsRequestSchema,
  UpdateSystemSettingsResponseSchema,
  GetSystemSettingsResponseSchema,
  type SystemSettings,
  type SystemSettingMeta,
} from '@tzurot/common-types/schemas/api/systemSettings';
import { type PrismaClient, type Prisma } from '@tzurot/common-types/services/prisma';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { sendError, sendCustomSuccess } from '../../utils/responseHelpers.js';
import { ErrorResponses } from '../../utils/errorResponses.js';
import { ModelCapabilityService } from '../../services/ModelCapabilityService.js';
import type { RouteDeps } from '../routeDeps.js';

const logger = createLogger('admin-system-settings-routes');

interface AuthenticatedRequest extends Request {
  userId: string;
}

/** Ensure the singleton exists and return it (same shape as the sibling route). */
async function getOrCreateSettings(
  prisma: PrismaClient
): Promise<Prisma.AdminSettingsGetPayload<object>> {
  return prisma.adminSettings.upsert({
    where: { id: ADMIN_SETTINGS_SINGLETON_ID },
    create: { id: ADMIN_SETTINGS_SINGLETON_ID },
    update: {},
  });
}

/** The stored bag as a plain object (null column → empty bag). */
function asBag(column: Prisma.JsonValue | null): Record<string, unknown> {
  return typeof column === 'object' && column !== null && !Array.isArray(column) ? column : {};
}

/** Resolve Discord ID → User UUID for the updatedBy FK */
async function resolveUserUuid(prisma: PrismaClient, discordId: string): Promise<string | null> {
  const user = await prisma.user.findFirst({
    // eslint-disable-next-line no-restricted-syntax -- Admin audit FK: route is behind requireOwnerAuth, the Discord ID comes from the X-User-Id header and the internal UUID is needed for AdminSettings.updatedBy FK attribution
    where: { discordId },
    select: { id: true },
  });
  return user?.id ?? null;
}

type PatchValidationResult = { ok: true; warnings: string[] } | { ok: false; message: string };

/**
 * D7 write-time coherence: a flag/provider write that depends on an env secret
 * is rejected when the secret is absent — the same condition the boot echo logs.
 */
function validateCoherence(patch: Partial<SystemSettings>): string | null {
  const env = getConfig();
  if (patch.zaiFreeTierEnabled === true && env.ZAI_CODING_API_KEY === undefined) {
    return 'zaiFreeTierEnabled requires ZAI_CODING_API_KEY to be configured on the service';
  }
  if (patch.extractionProvider === 'zai-coding' && env.ZAI_CODING_API_KEY === undefined) {
    return "extractionProvider 'zai-coding' requires ZAI_CODING_API_KEY to be configured on the service";
  }
  return null;
}

/**
 * D9/D10 model-field validation. Order matters: alias allowlist first (router
 * aliases may lack catalog modality tags), then the free-route firewall, then
 * catalog membership + slot capability with per-field fail mode.
 */
async function validateModelValue(
  meta: SystemSettingMeta,
  value: string,
  capabilities: ModelCapabilityService
): Promise<PatchValidationResult> {
  const model = meta.model;
  if (model === undefined) {
    return { ok: true, warnings: [] };
  }

  if (model.aliasAllowlist.includes(value)) {
    return { ok: true, warnings: [] };
  }

  if (model.freeRouteOnly && !isFreeModel(value)) {
    return {
      ok: false,
      message: `${meta.key} accepts only free-route models (openrouter/free or a ':free'-suffixed model) — the free floor must never bill the system key`,
    };
  }

  // z-ai/ models: static catalog, deterministic — a non-member is a typo, not
  // a cache problem, so it rejects regardless of fail mode.
  if (value.toLowerCase().startsWith('z-ai/') && !isZaiCodingPlanModel(value)) {
    return { ok: false, message: `${meta.key}: '${value}' is not in the z.ai coding-plan catalog` };
  }

  const resolved = await capabilities.resolve(value);
  if (resolved === null) {
    if (model.catalogFailMode === 'closed') {
      return {
        ok: false,
        message: `${meta.key}: '${value}' could not be verified against the model catalog — floor fields reject unverifiable writes`,
      };
    }
    return {
      ok: true,
      warnings: [`${meta.key}: '${value}' could not be verified against the model catalog`],
    };
  }

  if (model.slot === 'vision' && resolved.supportsVision !== true) {
    return { ok: false, message: `${meta.key}: '${value}' does not accept image input` };
  }

  return { ok: true, warnings: [] };
}

/**
 * Cross-field invariant on the MERGED bag: the fair-share window floor must
 * not exceed the ceiling (a violation silently collapses the dynamic cap to a
 * fixed value at read time). Enforced only when the write touches either side
 * of the pair — an unrelated write is never held hostage by pre-existing state.
 */
function validateWindowPair(
  patch: Partial<SystemSettings>,
  merged: Record<string, unknown>
): string | null {
  if (!('freeTierMinPerWindow' in patch) && !('freeTierMaxPerWindow' in patch)) {
    return null;
  }
  const min = merged.freeTierMinPerWindow;
  const max = merged.freeTierMaxPerWindow;
  if (typeof min === 'number' && typeof max === 'number' && min > max) {
    return `freeTierMinPerWindow (${min}) must not exceed freeTierMaxPerWindow (${max})`;
  }
  return null;
}

/** Run every semantic validation over the parsed patch. */
async function validatePatch(
  patch: Partial<SystemSettings>,
  capabilities: ModelCapabilityService
): Promise<PatchValidationResult> {
  const coherenceError = validateCoherence(patch);
  if (coherenceError !== null) {
    return { ok: false, message: coherenceError };
  }

  const warnings: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    const meta = SYSTEM_SETTINGS_REGISTRY[key as keyof SystemSettings];
    if (meta.control === 'model' && typeof value === 'string') {
      const result = await validateModelValue(meta, value, capabilities);
      if (!result.ok) {
        return result;
      }
      warnings.push(...result.warnings);
    }
  }
  return { ok: true, warnings };
}

/** One structured audit line per changed key (D7) — greppable write history. */
function logAudit(
  patch: Partial<SystemSettings>,
  previousBag: Record<string, unknown>,
  updatedBy: string
): void {
  for (const [key, newValue] of Object.entries(patch)) {
    logger.info(
      { key, oldValue: previousBag[key] ?? null, newValue, updatedBy },
      'System setting written'
    );
  }
}

/** GET /api/admin/settings/system */
export const handleGetSystemSettings = (deps: RouteDeps): RequestHandler => {
  const { prisma } = deps;
  return asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
    const settings = await getOrCreateSettings(prisma);
    const response = GetSystemSettingsResponseSchema.parse({
      systemSettings: asBag(settings.systemSettings),
      updatedAt: settings.updatedAt.toISOString(),
    });
    sendCustomSuccess(res, response, StatusCodes.OK);
  });
};

/** PATCH /api/admin/settings/system */
export const handleUpdateSystemSettings = (deps: RouteDeps): RequestHandler => {
  const { prisma, systemSettingsInvalidation, modelCache } = deps;
  const capabilities = new ModelCapabilityService(modelCache);

  return asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const parsed = UpdateSystemSettingsRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(
        res,
        ErrorResponses.validationError(
          `Invalid system-settings patch: ${parsed.error.issues
            .map(issue => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ')}`
        )
      );
      return;
    }
    const { expectedUpdatedAt, patch } = parsed.data;
    const changedKeys = Object.keys(patch);
    if (changedKeys.length === 0) {
      sendError(res, ErrorResponses.validationError('Patch must set at least one setting'));
      return;
    }

    const validation = await validatePatch(patch, capabilities);
    if (!validation.ok) {
      sendError(res, ErrorResponses.validationError(validation.message));
      return;
    }

    const userUuid = await resolveUserUuid(prisma, req.userId);
    const existing = await getOrCreateSettings(prisma);
    const previousBag = asBag(existing.systemSettings);
    // Spread-merge preserves unknown keys (rolling-deploy clobber protection).
    const merged = { ...previousBag, ...patch };

    const pairError = validateWindowPair(patch, merged);
    if (pairError !== null) {
      sendError(res, ErrorResponses.validationError(pairError));
      return;
    }

    // Optimistic concurrency: the updatedAt filter makes the write conditional
    // on the row not having moved since the client read it.
    const { count } = await prisma.adminSettings.updateMany({
      where: { id: ADMIN_SETTINGS_SINGLETON_ID, updatedAt: new Date(expectedUpdatedAt) },
      data: {
        systemSettings: merged,
        updatedBy: userUuid,
      },
    });
    if (count === 0) {
      sendError(
        res,
        ErrorResponses.conflict('Settings changed underneath you — refresh and retry')
      );
      return;
    }

    logAudit(patch, previousBag, req.userId);

    if (systemSettingsInvalidation !== undefined) {
      try {
        await systemSettingsInvalidation.invalidateKeys(changedKeys);
      } catch (error) {
        logger.warn({ err: error }, 'Failed to publish system-settings invalidation');
      }
    }

    const updated = await getOrCreateSettings(prisma);
    const response = UpdateSystemSettingsResponseSchema.parse({
      systemSettings: asBag(updated.systemSettings),
      updatedAt: updated.updatedAt.toISOString(),
      warnings: validation.warnings,
    });
    sendCustomSuccess(res, response, StatusCodes.OK);
  });
};
