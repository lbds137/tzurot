/**
 * User-audience memory routes.
 *
 * Covers memory CRUD, batch operations, and incognito mode (temporary
 * memory-write suspension). All routes require a provisioned user.
 *
 * Currently only the incognito sub-tree is populated; the main memory
 * CRUD endpoints will land in a follow-up commit once their dynamic
 * filter/sort table is reconciled with the route-manifest pattern.
 */

import {
  EnableIncognitoRequestSchema,
  DisableIncognitoRequestSchema,
  IncognitoForgetRequestSchema,
} from '../../types/incognito.js';
import {
  GetIncognitoStatusResponseSchema,
  EnableIncognitoResponseSchema,
  DisableIncognitoResponseSchema,
  IncognitoForgetResponseSchema,
} from '../../schemas/api/index.js';
import type { RouteDef } from '../types.js';

const MEMORY_INCOGNITO_PATH = '/memory/incognito';

export const userMemoryRoutes = {
  // ============================================================================
  // Memory Incognito (per-personality memory-write suspension)
  // ============================================================================

  getIncognitoStatus: {
    audience: 'user',
    method: 'get',
    path: MEMORY_INCOGNITO_PATH,
    id: 'getIncognitoStatus',
    output: GetIncognitoStatusResponseSchema,
    requiresProvisionedUser: true,
  },

  enableIncognito: {
    audience: 'user',
    method: 'post',
    path: MEMORY_INCOGNITO_PATH,
    id: 'enableIncognito',
    input: EnableIncognitoRequestSchema,
    output: EnableIncognitoResponseSchema,
    requiresProvisionedUser: true,
  },

  // DELETE with a request body is RFC 7231 §4.3.5 valid, but some reverse
  // proxies, CDNs, and older HTTP clients strip DELETE bodies. The current
  // bot-client calls this via in-process transport so this isn't a problem
  // today; if a future SDK / CLI caller needs middlebox compatibility, the
  // DELETE-with-body shape may need a POST equivalent.
  disableIncognito: {
    audience: 'user',
    method: 'delete',
    path: MEMORY_INCOGNITO_PATH,
    id: 'disableIncognito',
    input: DisableIncognitoRequestSchema,
    output: DisableIncognitoResponseSchema,
    requiresProvisionedUser: true,
  },

  incognitoForget: {
    audience: 'user',
    method: 'post',
    path: '/memory/incognito/forget',
    id: 'incognitoForget',
    input: IncognitoForgetRequestSchema,
    output: IncognitoForgetResponseSchema,
    requiresProvisionedUser: true,
  },
} as const satisfies Record<string, RouteDef>;
