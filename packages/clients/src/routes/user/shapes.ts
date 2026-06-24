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
import {
  DeleteShapesAuthResponseSchema,
  GATEWAY_TIMEOUTS,
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
  VALIDATION_TIMEOUTS,
} from '@tzurot/common-types';

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
    // DEFERRED budget: the status check probes the external
    // shapes.inc session for validity, so the upstream round-trip can exceed
    // the 2500ms autocomplete default.
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
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
    // DEFERRED budget: post-defer job-status poll in the import
    // dashboard, consistent with the import-start budget.
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
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
    // DEFERRED budget: post-defer job-status poll in the export
    // dashboard, consistent with the export-start budget.
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
  },
} as const satisfies Record<string, RouteDef>;
