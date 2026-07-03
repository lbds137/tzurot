/**
 * User-audience shapes.inc routes.
 *
 * BYOK integration with shapes.inc — covers credential management,
 * listing the user's owned shapes, and async import/export jobs.
 * All routes require a provisioned user.
 *
 * Import/export START handlers also require BullMQ (aiQueue in RouteDeps);
 * the handler short-circuits with 503 when the queue is unavailable.
 */

import { z } from 'zod';
import { GATEWAY_TIMEOUTS } from '@tzurot/common-types/constants/discord';
import { VALIDATION_TIMEOUTS } from '@tzurot/common-types/constants/timing';
import {
  DeleteShapesAuthResponseSchema,
  ListShapesExportJobsResponseSchema,
  ListShapesImportJobsResponseSchema,
  ListShapesResponseSchema,
  ShapesAuthStatusResponseSchema,
  StartShapesExportInputSchema,
  StartShapesExportResponseSchema,
  StartShapesImportInputSchema,
  StartShapesImportResponseSchema,
  StoreShapesAuthInputSchema,
  StoreShapesAuthResponseSchema,
} from '@tzurot/common-types/schemas/api/shapes';
import type { RouteDef } from '../types.js';

const BASE = '/shapes';

export const userShapesRoutes = {
  // ============================================================================
  // Credentials (BYOK session cookie)
  // ============================================================================

  storeShapesAuth: {
    audience: 'user',
    method: 'post',
    path: `${BASE}/auth`,
    id: 'storeShapesAuth',
    input: StoreShapesAuthInputSchema,
    output: StoreShapesAuthResponseSchema,
    requiresProvisionedUser: true,
    // Preflights the cookie against shapes.inc before persisting (handler's
    // probeShapesSession), so this POST blocks on a synchronous external
    // round-trip — same shape as listShapes. EXTERNAL_PROVIDER (40s) outwaits
    // the EXTERNAL_SHAPES_API_CALL budget; the manifest guard enforces the gap.
    timeoutMs: GATEWAY_TIMEOUTS.EXTERNAL_PROVIDER,
    externalCallBudgetMs: VALIDATION_TIMEOUTS.EXTERNAL_SHAPES_API_CALL,
  },

  deleteShapesAuth: {
    audience: 'user',
    method: 'delete',
    path: `${BASE}/auth`,
    id: 'deleteShapesAuth',
    output: DeleteShapesAuthResponseSchema,
    requiresProvisionedUser: true,
  },

  getShapesAuthStatus: {
    audience: 'user',
    method: 'get',
    path: `${BASE}/auth/status`,
    id: 'getShapesAuthStatus',
    output: ShapesAuthStatusResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
    // No timeoutMs: GET defaults to DEFERRED. The handler is a local
    // credential-row lookup (userCredential.findFirst), not an external
    // probe, so the default budget is more than enough.
  },

  // ============================================================================
  // Listing owned shapes
  // ============================================================================

  listShapes: {
    audience: 'user',
    method: 'get',
    path: `${BASE}/list`,
    id: 'listShapes',
    output: ListShapesResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
    externalCallBudgetMs: VALIDATION_TIMEOUTS.EXTERNAL_SHAPES_API_CALL,
    // The handler queries the external shapes.inc catalog (up to
    // EXTERNAL_SHAPES_API_CALL = 15s), so the client must outwait it.
    // Autocomplete callers are bounded by Discord's own 3s deadline regardless;
    // this budget serves the browse/import deferred-handler path.
    timeoutMs: GATEWAY_TIMEOUTS.EXTERNAL_PROVIDER,
  },

  // ============================================================================
  // Import jobs
  // ============================================================================

  startShapesImport: {
    audience: 'user',
    method: 'post',
    path: `${BASE}/import`,
    id: 'startShapesImport',
    input: StartShapesImportInputSchema,
    output: StartShapesImportResponseSchema,
    requiresProvisionedUser: true,
  },

  listShapesImportJobs: {
    audience: 'user',
    method: 'get',
    path: `${BASE}/import/jobs`,
    id: 'listShapesImportJobs',
    query: { slug: z.string().optional() },
    output: ListShapesImportJobsResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
    // No timeoutMs: GET defaults to DEFERRED. The handler is a local DB
    // job-status query, not an external shapes.inc call — the default budget
    // is the invariant. Adding an external enrichment call here would need an
    // explicit budget + externalCallBudgetMs (see storeShapesAuth/listShapes).
  },

  // ============================================================================
  // Export jobs
  // ============================================================================

  startShapesExport: {
    audience: 'user',
    method: 'post',
    path: `${BASE}/export`,
    id: 'startShapesExport',
    input: StartShapesExportInputSchema,
    output: StartShapesExportResponseSchema,
    requiresProvisionedUser: true,
  },

  listShapesExportJobs: {
    audience: 'user',
    method: 'get',
    path: `${BASE}/export/jobs`,
    id: 'listShapesExportJobs',
    query: { slug: z.string().optional() },
    output: ListShapesExportJobsResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
    // No timeoutMs: GET defaults to DEFERRED. The handler is a local DB
    // job-status query, not an external shapes.inc call — the default budget
    // is the invariant. Adding an external enrichment call here would need an
    // explicit budget + externalCallBudgetMs (see storeShapesAuth/listShapes).
  },
} as const satisfies Record<string, RouteDef>;
