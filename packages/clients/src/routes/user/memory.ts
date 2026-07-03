/**
 * User-audience memory routes.
 *
 * Covers memory CRUD, batch operations, and incognito mode (temporary
 * memory-write suspension). All routes require a provisioned user.
 */

import { z } from 'zod';
import {
  BatchDeletePreviewResponseSchema,
  BatchDeletePreviewSchema,
  BatchDeleteResponseSchema,
  BatchDeleteSchema,
  DeleteMemoryResponseSchema,
  FocusModeSchema,
  FocusModeStatusResponseSchema,
  IssuePurgeTokenResponseSchema,
  IssuePurgeTokenSchema,
  MemoryListResponseSchema,
  MemorySearchResponseSchema,
  MemorySearchSchema,
  MemoryStatsResponseSchema,
  MemoryUpdateSchema,
  PurgeMemoriesResponseSchema,
  PurgeMemoriesSchema,
  SetFocusResponseSchema,
  SetMemoryLockSchema,
  SingleMemoryResponseSchema,
} from '@tzurot/common-types/schemas/api/memory';
import {
  DisableIncognitoResponseSchema,
  EnableIncognitoResponseSchema,
  GetIncognitoStatusResponseSchema,
  IncognitoForgetResponseSchema,
} from '@tzurot/common-types/schemas/api/memoryIncognito';
import {
  DisableIncognitoRequestSchema,
  EnableIncognitoRequestSchema,
  IncognitoForgetRequestSchema,
} from '@tzurot/common-types/types/incognito';
import type { RouteDef } from '../types.js';

const MEMORY_INCOGNITO_PATH = '/memory/incognito';
/** `/memory/:id` is reused by GET / PATCH / DELETE — extracted to satisfy
 *  sonarjs/no-duplicate-string. */
const MEMORY_BY_ID_PATH = '/memory/:id';

export const userMemoryRoutes = {
  // ============================================================================
  // Memory CRUD (single + batch)
  // ============================================================================

  getStats: {
    audience: 'user',
    method: 'get',
    path: '/memory/stats',
    id: 'getStats',
    query: { personalityId: z.string() },
    output: MemoryStatsResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
  },

  list: {
    audience: 'user',
    method: 'get',
    path: '/memory/list',
    id: 'list',
    query: {
      personalityId: z.string().optional(),
      limit: z.string().optional(),
      offset: z.string().optional(),
      sort: z.string().optional(),
      order: z.string().optional(),
    },
    output: MemoryListResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true, softDeleteAware: true },
  },

  getFocus: {
    audience: 'user',
    method: 'get',
    path: '/memory/focus',
    id: 'getFocus',
    query: { personalityId: z.string() },
    output: FocusModeStatusResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
  },

  setFocus: {
    audience: 'user',
    method: 'post',
    path: '/memory/focus',
    id: 'setFocus',
    input: FocusModeSchema,
    output: SetFocusResponseSchema,
    requiresProvisionedUser: true,
    meta: { idempotent: true },
  },

  search: {
    audience: 'user',
    method: 'post',
    path: '/memory/search',
    id: 'search',
    input: MemorySearchSchema,
    output: MemorySearchResponseSchema,
    requiresProvisionedUser: true,
    // POST for transport reasons (body too complex for query string), but
    // semantically read-only — client cache wrappers can treat as a query.
    meta: { safeRead: true },
  },

  // ---- Destructive batch (preview-token handshake) -----------------------

  batchDeletePreview: {
    audience: 'user',
    method: 'post',
    path: '/memory/delete/preview',
    id: 'batchDeletePreview',
    input: BatchDeletePreviewSchema,
    output: BatchDeletePreviewResponseSchema,
    requiresProvisionedUser: true,
    // safeRead because preview is read-only against memories (only Redis is
    // written — the token), even though the output's previewToken arms a
    // subsequent destructive call.
    meta: { safeRead: true },
  },

  batchDelete: {
    audience: 'user',
    method: 'post',
    path: '/memory/delete',
    id: 'batchDelete',
    input: BatchDeleteSchema,
    output: BatchDeleteResponseSchema,
    requiresProvisionedUser: true,
    // At-most-once: the previewToken in the body is single-use. Replaying
    // the same body after a network blip yields a 4xx token-expired error
    // even though the original mutation succeeded server-side. Retry layers
    // must NOT auto-retry — surface the original outcome to the user.
    meta: { atMostOnce: true },
  },

  issuePurgeToken: {
    audience: 'user',
    method: 'post',
    path: '/memory/purge/token',
    id: 'issuePurgeToken',
    input: IssuePurgeTokenSchema,
    output: IssuePurgeTokenResponseSchema,
    requiresProvisionedUser: true,
  },

  purge: {
    audience: 'user',
    method: 'post',
    path: '/memory/purge',
    id: 'purge',
    input: PurgeMemoriesSchema,
    output: PurgeMemoriesResponseSchema,
    requiresProvisionedUser: true,
    // Same at-most-once contract as batchDelete: purgeToken is single-use,
    // a retried body yields a 4xx even though the purge succeeded.
    meta: { atMostOnce: true },
  },

  // ---- Single memory operations ------------------------------------------

  getMemory: {
    audience: 'user',
    method: 'get',
    path: MEMORY_BY_ID_PATH,
    id: 'getMemory',
    params: { id: z.string() },
    output: SingleMemoryResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true, softDeleteAware: true },
  },

  updateMemory: {
    audience: 'user',
    method: 'patch',
    path: MEMORY_BY_ID_PATH,
    id: 'updateMemory',
    params: { id: z.string() },
    input: MemoryUpdateSchema,
    output: SingleMemoryResponseSchema,
    requiresProvisionedUser: true,
  },

  deleteMemory: {
    audience: 'user',
    method: 'delete',
    path: MEMORY_BY_ID_PATH,
    id: 'deleteMemory',
    params: { id: z.string() },
    output: DeleteMemoryResponseSchema,
    requiresProvisionedUser: true,
  },

  setMemoryLock: {
    audience: 'user',
    method: 'put',
    path: '/memory/:id/lock',
    id: 'setMemoryLock',
    params: { id: z.string() },
    input: SetMemoryLockSchema,
    output: SingleMemoryResponseSchema,
    requiresProvisionedUser: true,
    // PUT with explicit { locked } is the idempotency contract — replaying
    // the same body lands the same final state.
    meta: { idempotent: true },
  },

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
    meta: { safeRead: true },
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
