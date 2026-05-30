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
  StoreShapesAuthInputSchema,
  StoreShapesAuthResponseSchema,
  DeleteShapesAuthResponseSchema,
  ShapesAuthStatusResponseSchema,
  ListShapesResponseSchema,
  StartShapesImportInputSchema,
  StartShapesImportResponseSchema,
  ListShapesImportJobsResponseSchema,
  StartShapesExportInputSchema,
  StartShapesExportResponseSchema,
  ListShapesExportJobsResponseSchema,
} from '../../schemas/api/index.js';
import { GATEWAY_TIMEOUTS } from '../../constants/discord.js';
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
    // DEFERRED budget: the gateway validates the supplied
    // shapes.inc session cookie against the external service before storing,
    // so the gateway's own response is slow — well past the 2500ms default.
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
  },

  deleteShapesAuth: {
    audience: 'user',
    method: 'delete',
    path: `${BASE}/auth`,
    id: 'deleteShapesAuth',
    output: DeleteShapesAuthResponseSchema,
    requiresProvisionedUser: true,
    // DEFERRED budget: post-defer credential-management action,
    // consistent with the store/status siblings on the same /auth path.
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
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
    // Dual-context route: the browse/import flows fetch this post-defer (it
    // queries the external shapes.inc catalog and needs the longer budget),
    // while autocomplete callers are bounded by Discord's own 3s deadline
    // regardless of this value. DEFERRED serves the slower consumer.
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
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
    // DEFERRED budget: the start handler fetches shape data from
    // the external shapes.inc service before enqueueing the import job, so the
    // submit response is slow — past the 2500ms autocomplete default.
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
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
    // DEFERRED budget: export submit runs from a post-defer
    // dashboard action and may do non-trivial setup before enqueueing the
    // job — past the 2500ms autocomplete default.
    timeoutMs: GATEWAY_TIMEOUTS.DEFERRED,
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
