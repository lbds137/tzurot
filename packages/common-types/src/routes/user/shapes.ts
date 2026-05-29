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
    // Pin to the 3s Discord autocomplete budget at the manifest level so a
    // future transport.ts default change can't silently shift it. Called
    // only from autocomplete via getCachedShapes.
    timeoutMs: GATEWAY_TIMEOUTS.AUTOCOMPLETE,
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
  },
} as const satisfies Record<string, RouteDef>;
