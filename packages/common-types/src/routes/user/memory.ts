/**
 * User-audience memory routes.
 *
 * Covers memory CRUD, batch operations, and incognito mode (temporary
 * memory-write suspension). All routes require a provisioned user.
 */

import { z } from 'zod';
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
  FocusModeSchema,
  SetMemoryLockSchema,
  MemoryUpdateSchema,
  BatchDeletePreviewSchema,
  BatchDeleteSchema,
  IssuePurgeTokenSchema,
  PurgeMemoriesSchema,
  MemorySearchSchema,
  MemoryStatsResponseSchema,
  MemoryListResponseSchema,
  FocusModeStatusResponseSchema,
  SetFocusResponseSchema,
  MemorySearchResponseSchema,
  BatchDeletePreviewResponseSchema,
  BatchDeleteResponseSchema,
  IssuePurgeTokenResponseSchema,
  PurgeMemoriesResponseSchema,
  SingleMemoryResponseSchema,
  DeleteMemoryResponseSchema,
} from '../../schemas/api/index.js';
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
    // Idempotent via single-use token: replaying the same body yields
    // 'Preview token is invalid, expired, or already used.'
    meta: { idempotent: true },
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
    // Same single-use-token idempotency as batchDelete.
    meta: { idempotent: true },
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
