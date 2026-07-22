/**
 * User-audience memory routes.
 *
 * Covers memory CRUD, batch operations, and the two memory modes —
 * incognito (temporary memory-write suspension) and fresh (temporary
 * memory-read suspension). All routes require a provisioned user.
 */

import { z } from 'zod';
import {
  BatchDeletePreviewResponseSchema,
  BatchDeletePreviewSchema,
  BatchDeleteResponseSchema,
  BatchDeleteSchema,
  DeleteMemoryResponseSchema,
  IssuePurgeTokenResponseSchema,
  IssuePurgeTokenSchema,
  MemoryListResponseSchema,
  MemorySearchResponseSchema,
  MemorySearchSchema,
  MemoryStatsResponseSchema,
  MemoryUpdateSchema,
  PurgeMemoriesResponseSchema,
  PurgeMemoriesSchema,
  SetMemoryLockSchema,
  SingleMemoryResponseSchema,
} from '@tzurot/common-types/schemas/api/memory';
import {
  DisableMemoryModeResponseSchema,
  EnableMemoryModeResponseSchema,
  GetMemoryModeStatusResponseSchema,
  IncognitoForgetResponseSchema,
} from '@tzurot/common-types/schemas/api/memoryModes';
import {
  DisableMemoryModeRequestSchema,
  EnableMemoryModeRequestSchema,
  IncognitoForgetRequestSchema,
} from '@tzurot/common-types/types/memory-modes';
import type { RouteDef } from '../types.js';

const MEMORY_INCOGNITO_PATH = '/memory/incognito';
const MEMORY_FRESH_PATH = '/memory/fresh';
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
    query: { personalityId: z.string().optional() },
    output: GetMemoryModeStatusResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
  },

  enableIncognito: {
    audience: 'user',
    method: 'post',
    path: MEMORY_INCOGNITO_PATH,
    id: 'enableIncognito',
    input: EnableMemoryModeRequestSchema,
    output: EnableMemoryModeResponseSchema,
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
    input: DisableMemoryModeRequestSchema,
    output: DisableMemoryModeResponseSchema,
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

  // ============================================================================
  // Memory Fresh (per-personality memory-read suspension — memories are kept,
  // just not used; mirrors the incognito session shape)
  // ============================================================================

  getFreshStatus: {
    audience: 'user',
    method: 'get',
    path: MEMORY_FRESH_PATH,
    id: 'getFreshStatus',
    query: { personalityId: z.string().optional() },
    output: GetMemoryModeStatusResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
  },

  enableFresh: {
    audience: 'user',
    method: 'post',
    path: MEMORY_FRESH_PATH,
    id: 'enableFresh',
    input: EnableMemoryModeRequestSchema,
    output: EnableMemoryModeResponseSchema,
    requiresProvisionedUser: true,
  },

  // Same DELETE-with-body caveat as disableIncognito above.
  disableFresh: {
    audience: 'user',
    method: 'delete',
    path: MEMORY_FRESH_PATH,
    id: 'disableFresh',
    input: DisableMemoryModeRequestSchema,
    output: DisableMemoryModeResponseSchema,
    requiresProvisionedUser: true,
  },
} as const satisfies Record<string, RouteDef>;
